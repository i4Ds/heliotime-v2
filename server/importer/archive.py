import asyncio
import warnings
from asyncio import Future, Semaphore
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time
from pathlib import Path
from typing import Callable, TypeVar, Any, Union, Iterable

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
from data.flux.spec.data import FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux
from data.flux.spec.source import FluxSource
from ._base import Importer, ImporterProcess

warnings.filterwarnings(
    'ignore',
    message='This download has been started in a thread which is not the main thread. '
            'You will not be able to interrupt the download.'
)


def _select_best_source(results: QueryResponse) -> QueryResponseRow:
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


def _month_start(date: datetime) -> datetime:
    return date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month_start(date: datetime) -> datetime:
    return _month_start(date.replace(day=1) + timedelta(days=32))


def _from_timeseries(df: pd.DataFrame, band: FrequencyBand) -> Flux:
    name = 'xrsa' if band == FrequencyBand.SHORT else 'xrsb'

    # Remove bad quality measurements according to:
    # https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/science/xrs/GOES_1-15_XRS_Science-Quality_Data_Readme.pdf
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
    """

    max_download_tries: int = 5
    download_backoff: timedelta = timedelta(seconds=30)

    _executor: ThreadPoolExecutor

    def __init__(self, connection: Connection, executor: ThreadPoolExecutor):
        super().__init__(FluxSource.ARCHIVE, connection)
        self._executor = executor

    def _run_in_executor(self, function: Callable[..., _TReturn], *args: Any) -> Future[_TReturn]:
        return asyncio.get_event_loop().run_in_executor(self._executor, function, *args)

    async def _search_month(
            self,
            year: int, month: int,
            limit_start: datetime,
            search_semaphore: Semaphore,
    ) -> dict[int, UnifiedResponse]:
        start = max(limit_start, datetime(year, month, 1, tzinfo=timezone.utc))
        end = _next_month_start(start)
        async with search_semaphore:
            results = await self._run_in_executor(
                lambda: Fido.search(
                    attrs.Time(
                        start,
                        # Search treats end as inclusive
                        end - timedelta(milliseconds=1)
                    ),
                    attrs.Instrument("XRS")
                )
            )
        return {} if len(results) == 0 else {
            sat_results[0]['SatelliteNumber']: UnifiedResponse(*(
                _select_best_source(day_results)
                for day_results in sat_results.group_by('Start Time').groups
            )) for sat_results in results[0].group_by('SatelliteNumber').groups
        }

    async def _download_results(self, results: UnifiedResponse) -> Results:
        for i_try in range(self.max_download_tries):
            files = await self._run_in_executor(
                lambda: Fido.fetch(
                    results,
                    # Download everything at once (max days in a month).
                    max_conn=31,
                    progress=False,
                    # The files are deleted after import so leftover files
                    # are probably corrupt from a previous crash.
                    overwrite=True
                )
            )
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

    async def _load_timeseries(self, files: Union[Results, str]) -> pd.DataFrame:
        return await self._run_in_executor(
            lambda: TimeSeries(files, concatenate=True).to_dataframe()
        )

    async def _delete_files(self, files: Iterable[str]):
        await asyncio.gather(*(
            self._run_in_executor(lambda p: Path(p).unlink(), path)
            for path in files
        ))

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Import from the archive as efficiently as possible.
        Only the search is easily parallelize-able because download uses
        the full bandwidth and the database insert locks the GIL too much.

        TODO: optimize again (estimated full import takes 9 days)
        """
        search_semaphore = Semaphore(2)
        result_months = [
            asyncio.create_task(self._search_month(
                date.year, date.month,
                start, search_semaphore
            ))
            for date in pd.date_range(
                _month_start(start), datetime.now(timezone.utc),
                freq='MS'
            )
        ]
        for results in result_months:
            results = await results

            channels: dict[FluxChannel, Flux] = {}
            used_files = deque()
            for satellite, satellite_results in results.items():
                # Download all files
                files = await self._download_results(satellite_results)
                if len(files) == 0:
                    continue

                # Load all files into memory
                timeseries = await self._load_timeseries(files)

                # Convert each band
                for band in (FrequencyBand.SHORT, FrequencyBand.LONG):
                    channels[FluxChannel(satellite, band, False)] = \
                        _from_timeseries(timeseries, band).loc[start:]

                # Register files for deletion
                used_files.extend(files)

            await self._import(channels)
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
