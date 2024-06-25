import asyncio
import math
import re
from asyncio import Future, Semaphore
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time
from multiprocessing import Process
from pathlib import Path
from typing import Optional, Generator, Callable, TypeVar, Any

import pandas as pd
from aiohttp import ClientSession
from aiolimiter import AsyncLimiter
from asyncpg import Connection
from parfive import Results
from sunpy.net import Fido, attrs
from sunpy.net.base_client import QueryResponseRow
from sunpy.net.dataretriever import QueryResponse
from sunpy.net.fido_factory import UnifiedResponse
from sunpy.timeseries import TimeSeries

from config import IMPORT_START
from data.db import connect_db
from data.flux import Flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME, import_flux, fetch_last_flux_timestamp

_LIVE_BASE_URL = 'https://services.swpc.noaa.gov/json/goes/primary/'
_LIVE_ENERGY = '0.1-0.8nm'


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


def _parse_live_json(start: datetime, json: list[dict]) -> Generator[tuple[datetime, float], None, None]:
    for record in json:
        timestamp = datetime.fromisoformat(record['time_tag'])
        if record['energy'] != _LIVE_ENERGY or timestamp < start:
            continue
        yield timestamp, record['flux']


def _select_live_url(start: datetime) -> Optional[str]:
    now = datetime.now(timezone.utc)
    if now - timedelta(hours=6) <= start:
        return _LIVE_BASE_URL + 'xrays-6-hour.json'
    if now - timedelta(days=1) <= start:
        return _LIVE_BASE_URL + 'xrays-1-day.json'
    if now - timedelta(days=3) <= start:
        return _LIVE_BASE_URL + 'xrays-3-day.json'
    return _LIVE_BASE_URL + 'xrays-7-day.json'


def _next_month_start(date: datetime) -> datetime:
    return (date.replace(day=1) + timedelta(days=32)).replace(day=1)


def _from_timeseries(timeseries: TimeSeries) -> Flux:
    df = timeseries.to_dataframe()
    return df.set_index(
        df.index.tz_localize(timezone.utc).rename(FLUX_INDEX_NAME)
    ).xrsb.dropna().rename(FLUX_VALUE_NAME)


def _from_live_json(json: list[dict], start: datetime) -> Flux:
    def _parse() -> Generator[tuple[datetime, float], None, None]:
        # From newest to oldest entries to allow early exit
        for record in reversed(json):
            timestamp = datetime.fromisoformat(record['time_tag'])
            if record['energy'] != _LIVE_ENERGY:
                continue
            if timestamp < start:
                break
            flux = record['flux']
            if math.isnan(flux):
                break
            yield timestamp, flux

    return pd.DataFrame(
        reversed(list(_parse())),
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME]


_TReturn = TypeVar('_TReturn')
_archive_search_rate_limit = AsyncLimiter(10, 30)
_archive_download_rate_limit = AsyncLimiter(5, 30)


class Importer:
    max_download_retries: int = 4
    download_backoff: timedelta = timedelta(seconds=30)

    _connection: Connection
    _session: ClientSession
    _pool: ThreadPoolExecutor

    def __init__(
            self,
            connection: Connection,
            session: ClientSession,
            pool: ThreadPoolExecutor
    ):
        self._connection = connection
        self._session = session
        self._pool = pool

    def _run_in_executor(self, function: Callable[..., _TReturn], *args: Any) -> Future[_TReturn]:
        return asyncio.get_event_loop().run_in_executor(self._pool, function, *args)

    async def _search_month_in_archive(
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

    async def _download_from_archive(self, results: UnifiedResponse) -> Results:
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

    async def _import_archive(self, start: datetime):
        """
        Import from the archive as efficiently as possible.
        Only the search is easily parallelize-able because download uses
        the full bandwidth and the database insert locks the GIL too much.
        """
        search_semaphore = Semaphore(2)
        result_months = [
            asyncio.create_task(self._search_month_in_archive(
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
            files = await self._download_from_archive(results)
            if len(files) == 0:
                continue
            flux = await self._load_files(files)
            await import_flux(self._connection, flux.loc[start:])
            await self._delete_files(files)

    async def start_archive_import(self):
        while True:
            last_timestamp = await fetch_last_flux_timestamp(self._connection)
            await self._import_archive(
                IMPORT_START if last_timestamp is None else
                last_timestamp + timedelta(milliseconds=1)
            )
            await asyncio.sleep(24 * 60 * 60)

    async def _import_live(self, start: datetime) -> timedelta:
        """
        Will not fall back to secondary live source in case primary does not get updated.
        Will not raise any error if some of the range is no longer available
        but just import the available part.

        :return: Timedelta until new data should be available.
        """
        async with self._session.get(_select_live_url(start)) as response:
            await import_flux(self._connection, _from_live_json(
                await response.json(), start
            ))

            # Calculate time until new data arrives
            cache_header = response.headers.get('cache-control')
            max_age = 60
            if cache_header is not None:
                match = re.search(r'max-age=(\d+)', cache_header)
                if match is not None:
                    max_age = int(match.group(1))
            age_header = response.headers.get('age')
            age = 0
            if age_header is not None:
                age = int(age_header)
            # Add one second to account for potential timing inaccuracies
            return timedelta(seconds=max_age - age + 1)

    async def start_live_import(self):
        while True:
            last_timestamp = await fetch_last_flux_timestamp(self._connection)
            start = IMPORT_START if last_timestamp is None else \
                last_timestamp + timedelta(milliseconds=1)
            new_data_delta = await self._import_live(start)
            await asyncio.sleep(new_data_delta.total_seconds())


async def _start_import():
    connection = await connect_db()
    try:
        async with ClientSession() as session:
            with ThreadPoolExecutor() as pool:
                importer = Importer(connection, session, pool)
                await importer.start_archive_import()
    finally:
        await connection.close()


def _start_import_sync():
    """
    Must be a module level function to be usable as process target.
    """
    asyncio.run(_start_import())


class ImporterProcess(Process):
    def __init__(self):
        super().__init__(
            name='Heliotime Importer',
            target=_start_import_sync,
            daemon=True
        )


if __name__ == '__main__':
    _start_import_sync()
