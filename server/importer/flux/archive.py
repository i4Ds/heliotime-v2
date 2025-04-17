import asyncio
import warnings
from asyncio import Semaphore
from collections import deque
from concurrent.futures.thread import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time
from pathlib import Path
from typing import Union, Iterable, TypeVar

import pandas as pd
from asyncpg import Connection
from parfive import Results
from sunpy.net import Fido, attrs
from sunpy.net.base_client import QueryResponseRow
from sunpy.net.dataretriever import QueryResponse
from sunpy.net.fido_factory import UnifiedResponse
from sunpy.timeseries import TimeSeries

from data.db import connect_db
from data.flux.spec.channel import FluxChannel, FrequencyBand
from data.flux.spec.data import FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux, empty_flux
from data.flux.spec.source import FluxSource
from utils.range import DateTimeRange
from ._base import Importer, ImporterProcess

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


def _month_start(date: datetime) -> datetime:
    return date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month_start(date: datetime) -> datetime:
    return _month_start(date.replace(day=1) + timedelta(days=32))


def _from_timeseries(df: pd.DataFrame, band: FrequencyBand) -> Flux:
    name = 'xrsa' if band == FrequencyBand.SHORT else 'xrsb'

    # Remove bad quality measurements.
    # Data from GOES 1-7 don't have the quality flag yet.
    quality_flag = f'{name}_quality'
    if quality_flag in df.columns:
        df = df[df[quality_flag] == 0]

    # Format data into a Flux series
    index = df.index.tz_localize(timezone.utc).rename(FLUX_INDEX_NAME)
    return df.set_index(index)[name].rename(FLUX_VALUE_NAME)


_TReturn = TypeVar('_TReturn')


class ArchiveImporter(Importer):
    """
    Imports highest resolution data (1s-3s) from the data archives:
    https://www.ngdc.noaa.gov/stp/satellite/goes-r.html

    Data guides:
    - https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/science/xrs/GOES_1-15_XRS_Science-Quality_Data_Readme.pdf
    - https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes/goes16/l2/docs/GOES-R_XRS_L2_Data_Users_Guide.pdf
    """

    max_download_tries: int = 5
    download_backoff: timedelta = timedelta(seconds=30)

    def __init__(
            self, connection: Connection,
            thread_executor: ThreadPoolExecutor
    ):
        super().__init__(FluxSource.ARCHIVE, connection, thread_executor)

    async def _search(
            self,
            time_range: DateTimeRange,
            search_semaphore: Semaphore,
    ) -> dict[int, UnifiedResponse]:
        async with search_semaphore:
            results = await self._run_in_thread(
                lambda: Fido.search(
                    attrs.Time(
                        time_range.start,
                        # Search treats end as inclusive
                        time_range.end - timedelta(milliseconds=1)
                    ),
                    attrs.Instrument("XRS")
                )
            )
        return {} if len(results[0]) == 0 else {
            sat_results[0]['SatelliteNumber']: _select_best_sources(sat_results)
            for sat_results in results[0].group_by('SatelliteNumber').groups
        }

    async def _download_results(self, results: UnifiedResponse) -> Results:
        for i_try in range(self.max_download_tries):
            files = await self._run_in_thread(lambda: Fido.fetch(
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
            if i_try < self.max_download_tries - 1:
                # Errors probably because of rate limits. Back off
                wait = self.download_backoff * (i_try + 1)
                self._logger.warning(
                    f'Download of {len(files.errors)} files failed (of {len(results)}, try {i_try + 1}). '
                    f'Retrying in {wait}',
                    files.errors
                )
                await asyncio.sleep(wait.total_seconds())
            else:
                self._logger.error(
                    f'Download of {len(files.errors)} files failed. '
                    f'Giving up after {self.max_download_tries} tries'
                )
        return files  # noqa

    async def _load_timeseries(self, files: Union[Results, str]) -> pd.DataFrame | None:
        if len(files) == 0:
            return None
        return await self._run_in_thread(
            lambda: TimeSeries(files, concatenate=True).to_dataframe()
        )

    async def _delete_files(self, files: Iterable[str]):
        await asyncio.gather(*(
            self._run_in_thread(lambda: Path(path).unlink(missing_ok=True))
            for path in files
        ))

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Import from the archive as efficiently as possible.
        Only the search is easily parallelize-able because download uses
        the full bandwidth and the database insert locks the GIL too much.
        """
        # Search for files in parallel monthly batches
        search_semaphore = Semaphore(2)
        now = datetime.now(timezone.utc)
        months = pd.date_range(
            _month_start(start), now,
            freq='MS'
        )
        searches = deque()
        for date in months:
            month_start = datetime(date.year, date.month, 1, tzinfo=timezone.utc)
            time_range = DateTimeRange(
                max(start, month_start),
                min(_next_month_start(month_start), now)
            )
            search_future = asyncio.create_task(self._search(
                time_range, search_semaphore
            ))
            searches.append((search_future, time_range))

        # Download and import the results sequentially
        for search_future, time_range in searches:
            search_results = await search_future
            total_found_files = sum(len(r) for r in search_results.values())
            self._logger.info(
                f'Found {total_found_files} files from {len(search_results)} satellites for {time_range}'
            )

            # Download sequentially and load into memory concurrently
            used_files = deque()
            timeseries_tasks = {}
            for satellite, satellite_results in search_results.items():
                files = await self._download_results(satellite_results)
                timeseries_tasks[satellite] = asyncio.create_task(self._load_timeseries(files))
                used_files.extend(files)

            # Collect and convert all timeseries
            channels: dict[FluxChannel, Flux] = {}
            for satellite, timeseries_future in timeseries_tasks.items():
                timeseries = await timeseries_future
                for band in (FrequencyBand.SHORT, FrequencyBand.LONG):
                    if timeseries is None:
                        flux = empty_flux()
                    else:
                        flux = _from_timeseries(timeseries, band)
                        if len(flux) != 0 and flux.index[0] < start:
                            flux = flux.loc[start:]
                    channels[FluxChannel(satellite, band, False)] = flux

            # Import the data and clean up
            await self._import(channels, time_range)
            await self._delete_files(used_files)
        return timedelta(hours=1)


async def start_archive_import():
    connection = await connect_db()
    try:
        with ThreadPoolExecutor() as executor:
            importer = ArchiveImporter(connection, executor)
            await importer.start_import()
    finally:
        await connection.close()


class ArchiveImporterProcess(ImporterProcess):
    def __init__(self):
        super().__init__(FluxSource.ARCHIVE, start_archive_import)
