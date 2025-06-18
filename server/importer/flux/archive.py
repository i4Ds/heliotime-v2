import asyncio
import multiprocessing
import multiprocessing.pool
import warnings
from collections import deque
from concurrent.futures.thread import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time, date
from logging import Logger
from multiprocessing.managers import SyncManager
from pathlib import Path

import asyncpg
import pandas as pd
from parfive import Results
from sunpy.net import Fido, attrs
from sunpy.net.base_client import QueryResponseRow
from sunpy.net.dataretriever import QueryResponse
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

_MAX_DOWNLOAD_TRIES = 5
_DOWNLOAD_BACKOFF = timedelta(seconds=30)
_BATCH_SIZE_DAYS = 30
# The task's main bottleneck is the database import, so more workers will just be waiting.
_WORKER_COUNT = 2

warnings.filterwarnings(
    'ignore',
    message='This download has been started in a thread which is not the main thread. '
            'You will not be able to interrupt the download.'
)


def _select_best_day_source(results: QueryResponse) -> QueryResponseRow:
    # Assert that all intervals always go an entire day (start is the same for all)
    assert results[0]['Start Time'].to_datetime().time() == time(0, 0, 0, 0)
    end_times = set(results['End Time'])
    assert len(end_times) == 1
    assert end_times.pop().to_datetime().time() == time(23, 59, 59, 999000)

    if 'Resolution' not in results.keys():
        return results[0]
    # Select highest resolution
    high_res = results[results['Resolution'] == 'flx1s']
    return high_res[0] if len(high_res) >= 1 else results[0]


def _select_best_sources(results: QueryResponse) -> UnifiedResponse:
    return UnifiedResponse(*(
        _select_best_day_source(day_results)
        for day_results in results.group_by('Start Time').groups
    ))


async def _search(time_range: DateTimeRange) -> dict[int, UnifiedResponse]:
    results = Fido.search(
        attrs.Time(
            time_range.start,
            # Search treats end as inclusive
            time_range.end - timedelta(milliseconds=1)
        ),
        attrs.Instrument("XRS")
    )
    return {} if len(results[0]) == 0 else {
        sat_results[0]['SatelliteNumber']: _select_best_sources(sat_results)
        for sat_results in results[0].group_by('SatelliteNumber').groups
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

    # Format data into a Flux series
    index = df.index.tz_localize(timezone.utc).rename(FLUX_INDEX_NAME)
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
        with log_time(logger, f'Recompress before {time_range.end}'):
            async with pool.acquire() as connection:
                # Only recompress chunks before this range because the next import might modify this range again.
                await recompress_chunks(connection, source, time_range.start)
    database_event.set()

    # Delete the used files
    with log_time(logger, f'Cleanup {time_range}'):
        await asyncio.gather(*(
            run_in_executor(executor, lambda: Path(path).unlink(missing_ok=True))
            for path in used_files
        ))


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
    Imports highest resolution data (1s-3s) from the data archives:
    https://www.ngdc.noaa.gov/stp/satellite/goes-r.html

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
