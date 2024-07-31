from datetime import datetime, timedelta, timezone
from enum import Enum
from typing import Optional

import numpy as np
import pandas as pd
from asyncpg import Connection

Flux = pd.Series

FLUX_INDEX_NAME = 'time'
FLUX_VALUE_NAME = 'flux'


def empty_flux() -> Flux:
    """
    Creates an empty flux dataframe with correct form.
    """
    return pd.Series(
        name=FLUX_VALUE_NAME,
        dtype=np.float64,
        index=pd.DatetimeIndex((), name=FLUX_INDEX_NAME),
    )


# Amount of time subtracted form the auto refresh horizon to account for timing inaccuracies
_AUTO_REFRESH_SLACK = timedelta(minutes=2)


class _Resolution(Enum):
    # Add R_ prefix because identifiers cannot start with a number
    R_10S = '10s', timedelta(seconds=10)
    R_1M = '1m', timedelta(minutes=1)
    R_10M = '10m', timedelta(minutes=10)
    R_1H = '1h', timedelta(hours=1)
    R_12H = '12h', timedelta(hours=12)
    R_5D = '5d', timedelta(days=5)

    suffix: str
    size: timedelta

    def __init__(self, name: str, size: timedelta):
        self.suffix = '_' + name
        self.size = size


_ALL_RESOLUTIONS = (
    _Resolution.R_10S,
    _Resolution.R_1M,
    _Resolution.R_10M,
    _Resolution.R_1H,
    _Resolution.R_12H,
    _Resolution.R_5D,
)


class FluxSource(Enum):
    ARCHIVE = (
        'flux_archive',
        {res: timedelta() for res in _ALL_RESOLUTIONS}
    )
    LIVE = (
        'flux_live',
        {
            _Resolution.R_10M: timedelta(days=8),
            _Resolution.R_1H: timedelta(days=8),
            _Resolution.R_12H: timedelta(days=8),
            _Resolution.R_5D: timedelta(days=15),
        }
    )

    table_name: str
    auto_refresh_horizons: dict[_Resolution, timedelta]

    def __init__(
            self,
            table_name: str,
            auto_refresh_horizons: dict[_Resolution, timedelta]
    ):
        """
        :param auto_refresh_horizons: How far back the resolutions get auto-refreshed.
             Must be ordered form smallest to biggest resolution.
        """
        self.table_name = table_name
        self.auto_refresh_horizons = auto_refresh_horizons


_MERGED_SOURCE = 'flux'
_MERGED_RESOLUTIONS = _ALL_RESOLUTIONS


def _select_merged_source(interval: timedelta) -> str:
    for resolution in reversed(_MERGED_RESOLUTIONS):
        if interval >= resolution.size:
            return _MERGED_SOURCE + resolution.suffix
    return _MERGED_SOURCE


async def fetch_flux(
        connection: Connection,
        resolution: int,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None,
        timeout: Optional[timedelta] = None,
) -> Flux:
    if start is None:
        start = await fetch_first_flux_timestamp(connection)
        if start is None:
            # If there is no first timestamp there isn't any data at all.
            return empty_flux()
    if end is None:
        end = datetime.now(timezone.utc)

    interval = (end - start) / resolution
    # TODO: select time of first bucket entry
    # TODO: add timeout
    records = await connection.fetch(
        f'''
            SELECT time_bucket($1, time) AS bucket, MAX(flux)
            FROM {_select_merged_source(interval)}
            WHERE $2 <= time AND time < $3
            GROUP BY bucket
            ORDER BY bucket
        ''',
        interval, start, end,
        timeout=None if timeout is None else timeout.total_seconds()
    )
    return empty_flux() if len(records) == 0 else pd.DataFrame(
        records,
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME]


async def import_flux(connection: Connection, source: FluxSource, flux: Flux):
    if len(flux) == 0:
        return
    await connection.copy_records_to_table(
        source.table_name, records=flux.items()
    )

    # Aggregate refresh cannot be run within transaction
    now = datetime.now(timezone.utc)
    start = flux.index[0]
    end = flux.index[-1]
    for resolution, auto_refresh_horizon in source.auto_refresh_horizons.items():
        if now - auto_refresh_horizon + _AUTO_REFRESH_SLACK < start:
            # Skip manual refresh because it will be soon automatically refreshed
            continue
        await connection.execute(
            f"""
                CALL refresh_continuous_aggregate(
                    '{source.table_name}{resolution.suffix}', 
                    $1::TIMESTAMPTZ, $2::TIMESTAMPTZ
                )
            """,
            # Extend update range to include the buckets at the edge
            start - resolution.size, end + resolution.size
        )


async def fetch_first_flux_timestamp(connection: Connection) -> Optional[datetime]:
    # Can be extremely slow if there are a lot of chunks
    # See: https://github.com/timescale/timescaledb/issues/5102
    return await connection.fetchval('SELECT MIN(time) FROM flux')


async def fetch_last_flux_timestamp(connection: Connection, source: FluxSource | None = None) -> Optional[datetime]:
    table_name = 'flux' if source is None else source.table_name
    return await connection.fetchval(f'SELECT MAX(time) FROM {table_name}')
