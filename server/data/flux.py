from datetime import datetime, timedelta, timezone
from typing import Optional

import numpy as np
import pandas as pd
from asyncpg import Connection

Flux = pd.Series

FLUX_INDEX_NAME = 'time'
FLUX_VALUE_NAME = 'flux'

_RAW_TABLE = 'flux'
_10S_VIEW = 'flux_10s'
_1M_VIEW = 'flux_1m'
_10M_VIEW = 'flux_10m'
_1H_VIEW = 'flux_1h'
_12H_VIEW = 'flux_12h'
_5D_VIEW = 'flux_5d'
_ALL_VIEWS = (
    _10S_VIEW,
    _1M_VIEW,
    _10M_VIEW,
    _1H_VIEW,
    _12H_VIEW,
    _5D_VIEW,
)
_VIEW_SIZES = {
    _10S_VIEW: timedelta(seconds=10),
    _1M_VIEW: timedelta(minutes=1),
    _10M_VIEW: timedelta(minutes=10),
    _1H_VIEW: timedelta(hours=1),
    _12H_VIEW: timedelta(hours=12),
    _5D_VIEW: timedelta(days=5),
}
_AUTO_REFRESH_HORIZONS = {
    _10S_VIEW: timedelta(days=7),
    _1M_VIEW: timedelta(days=7),
    _10M_VIEW: timedelta(days=7),
    _1H_VIEW: timedelta(days=7),
    _12H_VIEW: timedelta(days=7),
    _5D_VIEW: timedelta(days=30),
}


def _select_source(interval: timedelta) -> str:
    for view in reversed(_ALL_VIEWS):
        if interval > _VIEW_SIZES[view]:
            return view
    return _RAW_TABLE


def empty_flux() -> Flux:
    return pd.Series(
        name=FLUX_VALUE_NAME,
        index=pd.Series(dtype=np.int64, name=FLUX_INDEX_NAME)
    )


async def fetch_flux(connection: Connection, start: datetime, end: datetime, resolution: int) -> Flux:
    interval = (end - start) / resolution
    records = await connection.fetch(
        f'''
            SELECT time_bucket($1, time) AS bucket, MAX(flux)
            FROM {_select_source(interval)}
            WHERE $2 <= time AND time < $3
            GROUP BY bucket
            ORDER BY bucket
        ''',
        interval, start, end
    )
    return empty_flux() if len(records) == 0 else pd.DataFrame(
        records,
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME]


async def import_flux(connection: Connection, flux: Flux):
    if len(flux) == 0:
        return
    await connection.copy_records_to_table(
        _RAW_TABLE, records=flux.items()
    )
    start = flux.index[0].to_pydatetime()
    end = flux.index[-1].to_pydatetime()
    for view in _ALL_VIEWS:
        if _AUTO_REFRESH_HORIZONS[view] + datetime.now(timezone.utc) < start:
            continue
        view_size = _VIEW_SIZES[view]
        await connection.execute(
            f"CALL refresh_continuous_aggregate('{view}', $1::TIMESTAMPTZ, $2::TIMESTAMPTZ)",
            # Extend update range to include the buckets at the edge
            start - view_size, end + view_size
        )


async def fetch_last_flux_timestamp(connection: Connection) -> Optional[datetime]:
    return await connection.fetchval('SELECT MAX(time) FROM flux')
