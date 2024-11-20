import re
from datetime import timedelta, datetime, timezone
from typing import Optional, Generator

import pandas as pd
from aiohttp import ClientSession
from asyncpg import Connection

from data.db import connect_db
from data.flux.source import FluxSource
from data.flux.spec import Flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME
from ._base import Importer, ImporterProcess

_LIVE_BASE_URL = 'https://services.swpc.noaa.gov/json/goes/primary/'
_LIVE_ENERGY = '0.1-0.8nm'


def _select_live_url(start: datetime) -> Optional[str]:
    now = datetime.now(timezone.utc)
    if now - timedelta(hours=6) <= start:
        return _LIVE_BASE_URL + 'xrays-6-hour.json'
    if now - timedelta(days=1) <= start:
        return _LIVE_BASE_URL + 'xrays-1-day.json'
    if now - timedelta(days=3) <= start:
        return _LIVE_BASE_URL + 'xrays-3-day.json'
    return _LIVE_BASE_URL + 'xrays-7-day.json'


def _from_live_json(json: list[dict]) -> Flux:
    def _parse() -> Generator[tuple[datetime, float], None, None]:
        for record in json:
            timestamp = datetime.fromisoformat(record['time_tag'])
            if record['energy'] != _LIVE_ENERGY:
                continue
            flux = record['flux']
            if not 0 < flux < 1:
                continue
            yield timestamp, flux

    return pd.DataFrame(
        _parse(),
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME]


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
        async with self._session.get(_select_live_url(start)) as response:
            flux = _from_live_json(await response.json())
            start_index = flux.index.get_indexer([start], method='backfill')[0]
            # Shift start backwards because _import uses already cleaned data for recleaning,
            # and we don't know if this causes problems if only a single value gets added.
            # TODO: make _import safe the raw data before cleaning
            start_index = max(0, start_index - 240)
            await self._import(flux[start_index:])

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
