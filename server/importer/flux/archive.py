import asyncio
import logging
import multiprocessing
import multiprocessing.pool
import os
import re
import socket
import warnings
from collections import deque
from concurrent.futures.thread import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import timedelta, datetime, timezone, time, date
from logging import Logger
from multiprocessing.managers import SyncManager

import asyncpg
import pandas as pd
from astropy.table import vstack
from parfive import Results
from sunpy.net import Fido, attrs
from sunpy.net.base_client import QueryResponseRow
from sunpy.net.dataretriever import QueryResponse
from sunpy.net.dataretriever.sources.goes import XRSClient
from sunpy.net.fido_factory import UnifiedResponse
from sunpy.timeseries import TimeSeries

from data.db import create_db_pool, DbPoolFactory
from data.flux.access import import_flux, recompress_chunks
from data.flux.spec.channel import FluxChannel, FrequencyBand
from data.flux.spec.data import FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux, empty_flux
from data.flux.spec.source import FluxSource
from utils.asyncio import run_in_executor
from utils.logging import log_time, configure_logging
from utils.range import DateTimeRange
from ._base import Importer, ImporterProcess, log_import
from ._prepare import prepare_flux_channels

_logger = logging.getLogger('importer.archive')

_MAX_DOWNLOAD_TRIES = 5
_DOWNLOAD_BACKOFF = timedelta(seconds=30)
_BATCH_SIZE_DAYS = 30
# The task's main bottleneck is the database import, so more workers will just be waiting.
_WORKER_COUNT = 2
# Older SDAC FITS URLs look like go07950601.fits (satellite 07).
_OLD_GOES_URL_SAT = re.compile(r'/go(\d{2})\d{6}\.fits(?:$|\?)', re.IGNORECASE)
# SunPy only queries umbra.nascom.nasa.gov before this instant, and that host
# accepts the TCP connection then never responds. NOAA science-quality files
# already cover GOES 8+ from 1995, which is the archive gap after 1997-07-06.
_LEGACY_SDAC_END = datetime(2001, 3, 1, tzinfo=timezone.utc)
_NOAA_COVERAGE_START = datetime(1995, 1, 1, tzinfo=timezone.utc)
_GOES_8_15_END = datetime(2020, 3, 5, tzinfo=timezone.utc)
_GOES_R_START = datetime(2017, 2, 7, tzinfo=timezone.utc)
_SEARCH_TIMEOUT_SECONDS = 20
# SunPy formats {SatelliteNumber:2d}, which is "g 8" for GOES 8/9 and misses g08/g09.
_NOAA_8_15_PATTERN = (
    "https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/science/xrs/"
    "goes{SatelliteNumber:02d}/{filename_res}-l2-{Resolution}_science/"
    "{{year:4d}}/{{month:2d}}/"
    "sci_{filename_res}-l2-{Resolution}_g{SatelliteNumber:02d}_d{{year:4d}}{{month:2d}}{{day:2d}}_{{}}.nc"
)
_NOAA_8_15_PRODUCTS = (
    ("xrsf", "avg1m"),
    ("gxrs", "irrad"),
)
_skip_legacy_sdac = False
_xrs_client: XRSClient | None = None

warnings.filterwarnings(
    'ignore',
    message='This download has been started in a thread which is not the main thread. '
            'You will not be able to interrupt the download.'
)


def _satellite_number_from_url(url: str) -> int | None:
    match = _OLD_GOES_URL_SAT.search(str(url))
    return int(match.group(1)) if match else None


def _satellite_number_value(value) -> int | None:
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in {'', '--', 'none', 'nan', 'masked'}:
        return None
    try:
        number = int(text)
    except ValueError:
        return None
    return number if number > 0 else None


def _ensure_satellite_number(results: QueryResponse) -> QueryResponse:
    """Fill SatelliteNumber, including legacy SDAC rows that omit it."""
    urls = [str(url) for url in results['url']]
    if 'SatelliteNumber' in results.colnames:
        existing = list(results['SatelliteNumber'])
    else:
        existing = [None] * len(urls)
    satellites = []
    missing = []
    for value, url in zip(existing, urls):
        number = _satellite_number_value(value) or _satellite_number_from_url(url)
        if number is None:
            missing.append(url)
        satellites.append(number)
    if missing:
        raise ValueError(
            'Could not determine SatelliteNumber for archive results; '
            f'unparsed urls={missing[:5]}'
        )
    results = results.copy()
    results['SatelliteNumber'] = satellites
    return results


def _source_rank(row: QueryResponseRow) -> int:
    """Prefer 3-second FITS, then high-cadence netCDF, then 1-minute averages."""
    url = str(row['url']).lower()
    if '.fits' in url:
        return 0
    if 'irrad' in url or 'flx1s' in url:
        return 1
    return 2


def _select_best_day_source(results: QueryResponse) -> QueryResponseRow:
    # One file per satellite per day. High cadence wins when a day has both.
    return min(results, key=_source_rank)


def _select_best_sources(results: QueryResponse) -> UnifiedResponse:
    return UnifiedResponse(*(
        _select_best_day_source(day_results)
        for day_results in results.group_by('Start Time').groups
    ))


def _xrs() -> XRSClient:
    global _xrs_client
    if _xrs_client is None:
        _xrs_client = XRSClient()
    return _xrs_client


def _empty_results() -> QueryResponse:
    return QueryResponse([], client=_xrs())


@contextmanager
def _search_socket_timeout():
    """urlopen has no timeout unless the process default is set. Umbra never answers."""
    previous = socket.getdefaulttimeout()
    socket.setdefaulttimeout(_SEARCH_TIMEOUT_SECONDS)
    try:
        yield
    finally:
        socket.setdefaulttimeout(previous)


def _search_noaa_science(time_range: DateTimeRange) -> QueryResponse:
    """Science-quality XRS on NCEI, including dates before SunPy's 2001-03-01 cutoff."""
    client = _xrs()
    matchdict = client._get_match_dict(
        attrs.Time(
            time_range.start,
            # Search treats end as inclusive
            time_range.end - timedelta(milliseconds=1)
        ),
        attrs.Instrument("XRS"),
    )
    metalist = []
    satellites = [int(sat) for sat in matchdict['SatelliteNumber']]
    if time_range.start < _GOES_8_15_END:
        for satellite in satellites:
            if not 8 <= satellite <= 15:
                continue
            for filename_res, resolution in _NOAA_8_15_PRODUCTS:
                metalist.extend(client._get_metalist_fn(
                    matchdict, _NOAA_8_15_PATTERN,
                    SatelliteNumber=satellite,
                    filename_res=filename_res,
                    Resolution=resolution,
                ))
    if time_range.end > _GOES_R_START:
        for satellite in satellites:
            if satellite < 16:
                continue
            for resolution in ('flx1s', 'avg1m'):
                metalist.extend(client._get_metalist_fn(
                    matchdict, client.pattern_r,
                    SatelliteNumber=satellite,
                    Resolution=resolution,
                ))
    if len(metalist) == 0:
        return _empty_results()
    return QueryResponse(metalist, client=client)


def _search_legacy_sdac(time_range: DateTimeRange) -> QueryResponse:
    """GOES 2-7 daily FITS. SunPy reads these from umbra.nascom.nasa.gov."""
    global _skip_legacy_sdac
    if _skip_legacy_sdac or time_range.start >= _LEGACY_SDAC_END:
        return _empty_results()
    end = min(time_range.end, _LEGACY_SDAC_END)
    if time_range.start >= end:
        return _empty_results()
    try:
        results = Fido.search(
            attrs.Time(time_range.start, end - timedelta(milliseconds=1)),
            attrs.Instrument("XRS"),
        )
    except Exception as exc:
        # One dead listing would otherwise be retried for every 30-day batch.
        _skip_legacy_sdac = True
        _logger.warning(
            'Legacy SDAC archive is unreachable; continuing with NOAA science data '
            f'when it covers this range: {exc}'
        )
        return _empty_results()
    if len(results) == 0 or len(results[0]) == 0:
        return _empty_results()
    return results[0]


def _combine_results(tables: list[QueryResponse]) -> QueryResponse:
    nonempty = [table for table in tables if len(table) > 0]
    if len(nonempty) == 0:
        return _empty_results()
    if len(nonempty) == 1:
        return nonempty[0]
    return vstack(nonempty, metadata_conflicts='silent')


async def _search(time_range: DateTimeRange) -> dict[int, UnifiedResponse]:
    with _search_socket_timeout():
        try:
            noaa = _search_noaa_science(time_range)
            noaa_error = None
        except Exception as exc:
            noaa = None
            noaa_error = exc
            _logger.warning(f'NOAA science search failed for {time_range}: {exc}')
        # umbra.nascom.nasa.gov never answers. Don't wait on it when NOAA already
        # has this batch; a hung listing is what froze the importer at 1997-07-06.
        if noaa is not None and len(noaa) > 0:
            legacy = _empty_results()
        else:
            legacy = _search_legacy_sdac(time_range)

    if noaa_error is not None and (legacy is None or len(legacy) == 0):
        raise RuntimeError(f'Archive search failed for {time_range}') from noaa_error
    if (
            len(legacy) == 0
            and (noaa is None or len(noaa) == 0)
            and time_range.start < _NOAA_COVERAGE_START
            and _skip_legacy_sdac
    ):
        # GOES 2-7 lives only on the legacy archive. Skipping would punch a permanent hole.
        raise RuntimeError(
            f'Legacy SDAC archive is unreachable and NOAA has no science files for {time_range}'
        )

    tables = [table for table in (noaa, legacy) if table is not None and len(table) > 0]
    if len(tables) == 0:
        return {}
    table = _ensure_satellite_number(_combine_results(tables))
    return {
        int(sat_results[0]['SatelliteNumber']): _select_best_sources(sat_results)
        for sat_results in table.group_by('SatelliteNumber').groups
    }


async def _download_results(executor: ThreadPoolExecutor, logger: Logger, results: UnifiedResponse) -> Results:
    for i_try in range(_MAX_DOWNLOAD_TRIES):
        files = await run_in_executor(executor, lambda: Fido.fetch(
            results,
            # Download everything at once (max days in a month).
            max_conn=31,
            progress=False,
            # The files are deleted after import so leftover files
            # are probably corrupt from a previous crash.
            overwrite=True
        ))
        if len(files.errors) == 0:
            break
        if i_try < _MAX_DOWNLOAD_TRIES - 1:
            # Errors probably because of rate limits. Back off
            wait = _DOWNLOAD_BACKOFF * (i_try + 1)
            logger.warning(
                f'Download of {len(files.errors)} files failed (of {len(results)}, try {i_try + 1}). '
                f'Retrying in {wait}. Errors: {files.errors}'
            )
            await asyncio.sleep(wait.total_seconds())
        else:
            logger.error(
                f'Download of {len(files.errors)} files failed. '
                f'Giving up after {_MAX_DOWNLOAD_TRIES} tries'
            )
    return files  # noqa


def _from_timeseries(df: pd.DataFrame, band: FrequencyBand) -> Flux:
    name = 'xrsa' if band == FrequencyBand.SHORT else 'xrsb'

    # Remove bad quality measurements.
    # Data from GOES 1-7 don't have the quality flag yet.
    quality_flag = f'{name}_quality'
    if quality_flag in df.columns:
        df = df[df[quality_flag] == 0]

    # Format data into a Flux series. FITS indexes are naive; netCDF may already be UTC.
    index = df.index
    if getattr(index, 'tz', None) is None:
        index = index.tz_localize(timezone.utc)
    else:
        index = index.tz_convert(timezone.utc)
    index = index.rename(FLUX_INDEX_NAME)
    return df[name] \
        .set_axis(index)[~index.duplicated()].sort_index() \
        .rename(FLUX_VALUE_NAME).dropna()


def _load_channels(logger: Logger, satellite: int, time_range: DateTimeRange, files: Results) \
        -> dict[FluxChannel, Flux]:
    try:
        timeseries = TimeSeries(files, concatenate=True).to_dataframe()
    except Exception as e:
        logger.error(
            f'Failed to load all files from satellite {satellite} for {time_range}. Retrying individually: {e}')
        sections = deque()
        for file in files:
            try:
                sections.append(TimeSeries(file).to_dataframe())
            except Exception as e2:
                logger.error(f'Failed to load file {file} for satellite {satellite} for {time_range}: {e2}')
        if len(sections) == 0:
            logger.warning(f'No files could be loaded from satellite {satellite} for {time_range}. Skipping import.')
            return {}
        if len(sections) != len(files):
            logger.warning(
                f'Failed to load {len(files) - len(sections)}/{len(files)} files '
                f'from satellite {satellite} for {time_range}. Skipping files and continuing import.')
        timeseries = pd.concat(sections)

    channels: dict[FluxChannel, Flux] = {}
    for band in (FrequencyBand.SHORT, FrequencyBand.LONG):
        if timeseries is None:
            flux = empty_flux()
        else:
            flux = _from_timeseries(timeseries, band)
            if len(flux) != 0 and (
                    flux.index[0] < time_range.start or flux.index[-1] > time_range.end
            ):
                flux = flux.loc[time_range.start:time_range.end - timedelta(milliseconds=1)]
        channels[FluxChannel(satellite, band, False)] = flux
    return channels


async def _process_import_async(
        logger: Logger,
        executor: ThreadPoolExecutor,
        source: FluxSource,
        time_range: DateTimeRange,
        last_search_event: multiprocessing.Event,
        search_event: multiprocessing.Event,
        last_download_event: multiprocessing.Event,
        download_event: multiprocessing.Event,
        last_database_event: multiprocessing.Event,
        database_event: multiprocessing.Event,
        db_pool_factory: DbPoolFactory,
):
    # Search for files
    last_search_event.wait()
    with log_time(logger, f'Search {time_range}'):
        search_results = await _search(time_range)
    search_event.set()

    # Log the search results
    if len(search_results) == 0:
        logger.info(f'Found no files for {time_range}')
        return
    total_found_files = sum(len(r) for r in search_results.values())
    logger.info(
        f'Found {total_found_files} files from {len(search_results)} satellites for {time_range}'
    )

    # Download partially concurrently and load into memory concurrently
    last_download_event.wait()
    with log_time(logger, f'Download {time_range}'):
        download_semaphore = asyncio.Semaphore(2)
        used_files = deque()
        channel_futures = deque()

        async def _download(index: int, satellite: int, results: UnifiedResponse):
            if index > 0:
                # Add a small delay to stagger the downloads a bit
                await asyncio.sleep(5)
            async with download_semaphore:
                files = await _download_results(executor, logger, results)
            channel_futures.append(
                run_in_executor(executor, _load_channels, logger, satellite, time_range, files)
            )
            used_files.extend(files)

        await asyncio.wait((
            asyncio.create_task(_download(index, satellite, satellite_results))
            for index, (satellite, satellite_results) in enumerate(search_results.items())
        ))
    download_event.set()

    # Collect and prepare channels
    with log_time(logger, f'Collect {time_range}'):
        channels = {}
        for channel_dict in await asyncio.gather(*channel_futures):
            channels.update(channel_dict)
        if total_found_files > 0 and len(channels) == 0:
            # Importing nothing would let the next batch move the cursor past this range.
            raise RuntimeError(
                f'Found {total_found_files} archive files for {time_range} but none could be read'
            )

    # Processing uses data from the previous import, so must wait for it to finish.
    last_database_event.wait()
    async with db_pool_factory() as pool:
        # Process the channels
        with log_time(logger, f'Prepare {time_range}'):
            channels = await prepare_flux_channels(executor, pool, source, channels, time_range)

        # Import the channels
        log_import(logger, channels)
        with log_time(logger, f'Import {time_range}'):
            async with pool.acquire() as connection:
                await import_flux(connection, source, channels)

        # Workaround for TimescaleDB not recompressing modified chunks automatically.
        with log_time(logger, f'Recompress before {time_range.start}'):
            async with pool.acquire() as connection:
                # Only recompress chunks before this range because the next import might modify this range again.
                await recompress_chunks(connection, source, time_range.start)
    database_event.set()

    # Delete the used files
    with log_time(logger, f'Cleanup {time_range}'):
        results = await asyncio.gather(*(
            run_in_executor(executor, os.remove, path)
            for path in used_files
        ), return_exceptions=True)
        errors = {
            path: res
            for path, res in zip(used_files, results)
            if res is not None
        }
        if len(errors) > 0:
            logger.warning(f'Failed to delete {len(errors)}/{len(used_files)} files for {time_range}: {errors}')


def _process_import_files(
        logger: Logger,
        source: FluxSource,
        time_range: DateTimeRange,
        last_search_event: multiprocessing.Event,
        search_event: multiprocessing.Event,
        last_download_event: multiprocessing.Event,
        download_event: multiprocessing.Event,
        last_database_event: multiprocessing.Event,
        database_event: multiprocessing.Event,
        db_pool_factory: DbPoolFactory,
):
    with ThreadPoolExecutor() as executor:
        asyncio.run(_process_import_async(
            logger, executor, source, time_range,
            last_search_event, search_event,
            last_download_event, download_event,
            last_database_event, database_event,
            db_pool_factory
        ))
    # Set all the events as done in case the function early returns.
    # If there was an exception, they shouldn't and won't be set.
    search_event.set()
    download_event.set()
    database_event.set()


class ArchiveImporter(Importer):
    """
    Imports the highest cadence available from the data archives:
    https://www.ngdc.noaa.gov/stp/satellite/goes-r.html

    GOES 8 and later come from NOAA science-quality netCDF (1-minute before
    high-cadence files exist, then 1s-3s). GOES 2-7 still come from the legacy
    SDAC FITS archive when that host answers.

    Data guides:
    - https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/science/xrs/GOES_1-15_XRS_Science-Quality_Data_Readme.pdf
    - https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes/goes16/l2/docs/GOES-R_XRS_L2_Data_Users_Guide.pdf
    """

    _db_pool_factory: DbPoolFactory

    def __init__(
            self, connection: asyncpg.Pool,
            db_pool_factory: DbPoolFactory,
    ):
        super().__init__(FluxSource.ARCHIVE, connection)
        self._db_pool_factory = db_pool_factory

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Import from the archive as efficiently as possible.
        """
        # Pool needs to be per call to allow pool termination on error.
        pool = multiprocessing.pool.Pool(
            _WORKER_COUNT,
            initializer=configure_logging,
            maxtasksperchild=1
        )
        manager = SyncManager()
        manager.start()
        try:
            now = datetime.now(timezone.utc)
            days = pd.date_range(start.date(), date.today(), freq='D')

            # Create events for the first batch
            search_event = manager.Event()
            download_event = manager.Event()
            database_event = manager.Event()
            search_event.set()
            download_event.set()
            database_event.set()
            # Hold all events to prevent their garbage collection.
            # Pool does not keep references to events of pending tasks.
            events = deque((search_event, download_event, database_event))

            # Submit all batches
            async_results = deque()
            for start_date in days[::_BATCH_SIZE_DAYS]:
                start_datetime = datetime.combine(start_date, time(), timezone.utc)
                time_range = DateTimeRange(
                    max(start, start_datetime),
                    min(start_datetime + timedelta(days=_BATCH_SIZE_DAYS), now)
                )

                # Create events for the next batch
                next_search_event = manager.Event()
                next_download_event = manager.Event()
                next_database_event = manager.Event()
                events.extend((next_search_event, next_download_event, next_database_event))

                # Submit this batch
                async_results.append(pool.apply_async(
                    _process_import_files,
                    args=(
                        self._logger, self.source, time_range,
                        search_event, next_search_event,
                        download_event, next_download_event,
                        database_event, next_database_event,
                        self._db_pool_factory
                    )
                ))

                # Replace events for next batch
                search_event = next_search_event
                download_event = next_download_event
                database_event = next_database_event

            # Wait for all batches to finish
            try:
                for res in async_results:
                    res.get()
            except Exception:
                pool.terminate()
                raise
        finally:
            pool.close()
            pool.join()
            manager.shutdown()
        return timedelta(hours=1)


async def start_archive_import():
    async with create_db_pool() as connection:
        importer = ArchiveImporter(connection, create_db_pool)
        await importer.start_import()


class ArchiveImporterProcess(ImporterProcess):
    def __init__(self):
        super().__init__(FluxSource.ARCHIVE, start_archive_import)
