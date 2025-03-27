import re
from datetime import timedelta, datetime, timezone
from typing import Optional, Generator

import pandas as pd
from aiohttp import ClientSession
from asyncpg import Connection

from data.db import connect_db
from data.flux.spec.channel import FrequencyBand, FluxChannel
from data.flux.spec.source import FluxSource
from data.flux.spec.data import Flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME
from utils.range import DateTimeRange
from ._base import Importer, ImporterProcess

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
    _session: ClientSession

    def __init__(self, connection: Connection, session: ClientSession):
        super().__init__(FluxSource.LIVE, connection)
        self._session = session

    async def _import_from(self, start: datetime) -> timedelta:
        """
        Will not fall back to secondary live source in case primary does not get updated.
        Will not raise any error if some of the range is no longer available
        (older than a week) but just import the available part.
        """
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

        await self._import(channels, DateTimeRange(start, datetime.now(timezone.utc)))
        # Add one second to account for potential timing inaccuracies
        return min_wait + timedelta(seconds=1)


async def start_live_import():
    connection = await connect_db()
    try:
        async with ClientSession() as session:
            importer = LiveImporter(connection, session)
            await importer.start_import()
    finally:
        await connection.close()


class LiveImporterProcess(ImporterProcess):
    def __init__(self):
        super().__init__(FluxSource.LIVE, start_live_import)
