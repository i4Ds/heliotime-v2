import asyncio
import warnings
from asyncio import Future, Semaphore
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone, time
from pathlib import Path
from typing import Callable, TypeVar, Any, Union

import numpy as np
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


def _month_start(date: datetime) -> datetime:
    return date.replace(day=1, hour=0, minute=0, second=0, microsecond=0)


def _next_month_start(date: datetime) -> datetime:
    return _month_start(date.replace(day=1) + timedelta(days=32))


def _previous_value(series: pd.Series) -> pd.Series:
    # Must use rolling() instead of shift() because timeseries points are not always uniformly distributed.
    return series.rolling(timedelta(seconds=5), closed='left').mean()


def _top_percentile(series: pd.Series, percentage: float) -> float:
    """
    :return: The value at nth percentile of the series. Median would be 0.5.
    """
    trim_size = round(len(series) * percentage)
    max_partition = np.argpartition(series.to_numpy(), -trim_size)
    return series.iloc[max_partition[-trim_size]]


def _clean_flux(flux: Flux) -> Flux:
    # Remove obviously incorrect values
    flux = flux.replace((0, np.inf, -np.inf), np.nan).dropna()

    with np.errstate(invalid='ignore'):
        # Value range is exponential so find outliers with log
        log_flux = np.log10(flux)

    # Calculate flux value acceleration (speed of change)
    prev_flux = _previous_value(log_flux)
    last_velocity = prev_flux - _previous_value(prev_flux)
    current_velocity = log_flux - prev_flux
    acceleration = current_velocity - last_velocity

    # Mark measurements that introduce excessive acceleration
    abs_acceleration = acceleration.abs()
    top_acceleration = _top_percentile(abs_acceleration.dropna(), percentage=0.005)
    is_outlier = abs_acceleration > max(top_acceleration, 0.1)

    # Remove and split at marked
    group_id = is_outlier.cumsum()[~is_outlier]
    groups = flux[~is_outlier].groupby(group_id)

    with np.errstate(invalid='ignore'):
        return groups.filter(
            lambda group:
            # Filter flat groups (probably the satellites value border)
            np.log10(group).std() > 0.001 and
            # Filter short groups
            group.index[-1] - group.index[0] > timedelta(minutes=2)
        )


def _from_timeseries(timeseries: TimeSeries) -> Flux:
    df = timeseries.to_dataframe()

    # Remove bad quality measurements according to:
    # https://www.ncei.noaa.gov/data/goes-space-environment-monitor/access/science/xrs/GOES_1-15_XRS_Science-Quality_Data_Readme.pdf
    # Data from GOES 1-7 don't have the xrsb_quality flag yet.
    if 'xrsb_quality' in df.columns:
        df = df[df.xrsb_quality == 0]

    # Format data into a Flux series
    index = df.index.tz_localize(timezone.utc).rename(FLUX_INDEX_NAME)
    flux = df.set_index(index).xrsb.rename(FLUX_VALUE_NAME)

    # Remove any sensor errors
    return _clean_flux(flux)


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

    async def _load_files(self, files: Union[Results, str]) -> Flux:
        return await self._run_in_executor(
            lambda: _from_timeseries(TimeSeries(files, concatenate=True))
        )

    async def _delete_files(self, files: Results):
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
                _month_start(start), datetime.now(timezone.utc),
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
            flux_dfs = deque()
            try:
                flux_dfs.append(await self._load_files(files))
            except KeyboardInterrupt as e:
                raise e
            except:  # noqa
                self._logger.warning(
                    'Failed to load file batch into memory. Retrying each file individually',
                    exc_info=True
                )
                for file in files:
                    try:
                        flux_dfs.append(await self._load_files(file))
                    except KeyboardInterrupt as e:
                        raise e
                    except:  # noqa
                        self._logger.exception(f'Failed to load {file} into memory. Skipping')
            await self._import(pd.concat(flux_dfs).loc[start:])
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
