import asyncio
import warnings
from asyncio import Future, Semaphore
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time
from pathlib import Path
from typing import Callable, TypeVar, Any

import pandas as pd
from asyncpg import Connection
from parfive import Results
from sunpy.net import Fido, attrs
from sunpy.net.base_client import QueryResponseRow
from sunpy.net.dataretriever import QueryResponse
from sunpy.net.fido_factory import UnifiedResponse
from sunpy.timeseries import TimeSeries

from data.db import connect_db
from data.flux import Flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME, FluxSource
from ._base import Importer, ImporterProcess

warnings.filterwarnings(
    'ignore',
    message='This download has been started in a thread which is not the main thread. '
            'You will not be able to interrupt the download.'
)


def _select_best_source(day_result: QueryResponse) -> QueryResponseRow:
    # Assert that all intervals always go an entire day
    assert day_result[0]['Start Time'].to_datetime().time() == time(0, 0, 0, 0)
    end_times = set(day_result['End Time'])
    assert len(end_times) == 1
    assert end_times.pop().to_datetime().time() == time(23, 59, 59, 999000)

    # Select newest satellite
    day_result.sort('SatelliteNumber', reverse=True)
    max_sat_number = day_result[0]['SatelliteNumber']
    day_result = day_result[day_result['SatelliteNumber'] == max_sat_number]
    if 'Resolution' not in day_result.keys():
        return day_result[0]

    # Select highest resolution
    high_res = day_result[day_result['Resolution'] == 'flx1s']
    return high_res[0] if len(high_res) >= 1 else day_result[0]


def _next_month_start(date: datetime) -> datetime:
    return (date.replace(day=1) + timedelta(days=32)).replace(day=1)


def _from_timeseries(timeseries: TimeSeries) -> Flux:
    df = timeseries.to_dataframe()
    return df.set_index(
        df.index.tz_localize(timezone.utc).rename(FLUX_INDEX_NAME)
    ).xrsb.dropna().rename(FLUX_VALUE_NAME)


_TReturn = TypeVar('_TReturn')


class ArchiveImporter(Importer):
    max_download_retries: int = 4
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
    ) -> UnifiedResponse:
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
        if len(results[0]) == 0:
            return UnifiedResponse()
        return UnifiedResponse(*(
            _select_best_source(days_result)
            for days_result in results[0].group_by('Start Time').groups
        ))

    async def _download_results(self, results: UnifiedResponse) -> Results:
        for i_try in range(self.max_download_retries + 1):
            files = await self._run_in_executor(
                lambda: Fido.fetch(
                    results,
                    # Download everything at once (max days in a month).
                    max_conn=31,
                    progress=False
                )
            )
            if len(files.errors) == 0:
                break
            # Errors probably because of rate limits. Back off
            await asyncio.sleep(
                self.download_backoff.total_seconds() * (i_try + 1)
            )
        return files  # noqa

    async def _load_files(self, files: Results) -> Flux:
        return await self._run_in_executor(
            lambda: _from_timeseries(TimeSeries(files, concatenate=True))
        )

    async def _delete_files(self, files):
        await asyncio.gather(*(
            self._run_in_executor(lambda p: Path(p).unlink(), path)
            for path in files
        ))

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Import from the archive as efficiently as possible.
        Only the search is easily parallelize-able because download uses
        the full bandwidth and the database insert locks the GIL too much.
        """
        search_semaphore = Semaphore(2)
        result_months = [
            asyncio.create_task(self._search_month(
                date.year, date.month,
                start, search_semaphore
            ))
            for date in pd.date_range(
                start, datetime.now(timezone.utc),
                freq='MS'
            )
        ]
        for results in result_months:
            results = await results
            if results is None:
                continue
            files = await self._download_results(results)
            if len(files) == 0:
                continue
            flux = await self._load_files(files)
            await self._import(flux.loc[start:])
            await self._delete_files(files)
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
