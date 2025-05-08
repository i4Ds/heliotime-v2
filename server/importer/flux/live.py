import re
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, datetime, timezone
from typing import Optional, Generator

import asyncpg
import pandas as pd
from aiohttp import ClientSession

from data.db import create_db_pool
from data.flux.access import import_flux
from data.flux.spec.channel import FrequencyBand, FluxChannel
from data.flux.spec.data import Flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME
from data.flux.spec.source import FluxSource
from utils.range import DateTimeRange
from ._base import Importer, ImporterProcess, log_import
from ._prepare import prepare_flux_channels

_LIVE_BASE_URL = 'https://services.swpc.noaa.gov/json/goes/'
_FREQUENCY_TO_ENERGY = {
    FrequencyBand.SHORT: '0.05-0.4nm',
    FrequencyBand.LONG: '0.1-0.8nm',
}


def _select_live_url(primary: bool, start: datetime) -> Optional[str]:
    now = datetime.now(timezone.utc)
    url = _LIVE_BASE_URL + ('primary/' if primary else 'secondary/')
    if now - timedelta(hours=6) <= start:
        return url + 'xrays-6-hour.json'
    if now - timedelta(days=1) <= start:
        return url + 'xrays-1-day.json'
    if now - timedelta(days=3) <= start:
        return url + 'xrays-3-day.json'
    return url + 'xrays-7-day.json'


def _from_live_json(json: list[dict], frequency: FrequencyBand, start: datetime) -> tuple[Flux, Optional[int]]:
    satellite = None
    energy = _FREQUENCY_TO_ENERGY[frequency]

    def _parse() -> Generator[tuple[datetime, float], None, None]:
        nonlocal satellite
        # From newest to oldest entries to allow early exit
        for record in reversed(json):
            timestamp = datetime.fromisoformat(record['time_tag'])
            if record['energy'] != energy:
                continue
            if satellite is None:
                satellite = record['satellite']
            elif record['satellite'] != satellite:
                raise ValueError('Unexpected multiple satellites in live data')
            if timestamp < start:
                break
            flux = record['flux']
            if not 0 < flux < 1:
                continue
            yield timestamp, flux

    return pd.DataFrame(
        reversed(list(_parse())),
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME], satellite


class LiveImporter(Importer):
    _thread_executor: ThreadPoolExecutor | None
    _session: ClientSession | None

    def __init__(self, connection: asyncpg.Pool):
        super().__init__(FluxSource.LIVE, connection)
        self._thread_executor = None
        self._session = None

    async def __aenter__(self):
        self._thread_executor = ThreadPoolExecutor()
        self._session = ClientSession()
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._thread_executor:
            self._thread_executor.shutdown(wait=True)
        if self._session:
            await self._session.close()

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Will not fall back to secondary live source in case primary does not get updated.
        Will not raise any error if some of the range is no longer available
        (older than a week) but just import the available part.
        """
        if not self._thread_executor or not self._session:
            raise RuntimeError("LiveImporter must be used as a context manager.")

        channels: dict[FluxChannel, Flux] = {}
        min_wait = timedelta(seconds=60)
        for primary in (True, False):
            async with self._session.get(_select_live_url(primary, start)) as response:
                json = await response.json()
                for band in FrequencyBand:
                    flux, satellite = _from_live_json(json, band, start)
                    if flux.empty or satellite is None:
                        continue
                    channels[FluxChannel(satellite, band, False)] = flux

                # Calculate time until new data arrives
                cache_header = response.headers.get('cache-control')
                max_age = 60
                if cache_header is not None:
                    match = re.search(r'max-age=(\d+)', cache_header)
                    if match is not None:
                        max_age = int(match.group(1))
                age_header = response.headers.get('age')
                age = 0 if age_header is None else int(age_header)
                wait = timedelta(seconds=max_age - age)
                if wait < min_wait:
                    min_wait = wait

        prepared_channels = await prepare_flux_channels(
            self._thread_executor, self._connection, self.source,
            channels, DateTimeRange(start, datetime.now(timezone.utc))
        )

        log_import(self._logger, prepared_channels)
        async with self._connection.acquire() as connection:
            await import_flux(connection, self.source, prepared_channels)

        # Add one second to account for potential timing inaccuracies
        return min_wait + timedelta(seconds=1)


async def start_live_import():
    async with create_db_pool() as connection:
        async with LiveImporter(connection) as importer:
            await importer.start_import()


class LiveImporterProcess(ImporterProcess):
    def __init__(self):
        super().__init__(FluxSource.LIVE, start_live_import)
