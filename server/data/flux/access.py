from datetime import timedelta, datetime, timezone
from typing import Optional

import pandas as pd
from asyncpg import Connection, Pool

from data.flux.source import AUTO_REFRESH_SLACK, FluxSource
from data.flux.spec import empty_flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux


async def fetch_flux(
        connection: Connection | Pool,
        source: FluxSource,
        interval: timedelta,
        start: datetime,
        end: datetime,
        timeout: Optional[timedelta] = None,
) -> Flux:
    timeout_seconds = None if timeout is None else timeout.total_seconds()
    records = await (
        connection.fetch(
            f'''
            SELECT time, flux
            FROM {source.table_name}
            WHERE $1 <= time AND time < $2
            ORDER BY time
        ''',
            start, end,
            timeout=timeout_seconds
        )
        if interval < source.raw_resolution else
        connection.fetch(
            f'''
            SELECT time_bucket($1, time) AS bucket, MAX(flux)
            FROM {source.select_relation(interval)}
            WHERE $2 <= time AND time < $3
            GROUP BY bucket
            ORDER BY bucket
        ''',
            interval, start, end,
            timeout=timeout_seconds
        )
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

    # refresh_continuous_aggregate() cannot be run within transaction
    now = datetime.now(timezone.utc)
    start = flux.index[0]
    end = flux.index[-1]
    for resolution, auto_refresh_horizon in source.auto_refresh_horizons.items():
        if now - auto_refresh_horizon + AUTO_REFRESH_SLACK < start:
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


async def fetch_flux_timestamp_range(connection: Connection, source: FluxSource) -> tuple[datetime, datetime] | None:
    """
    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    start, end = await connection.fetchrow(f'SELECT MIN(time), MAX(time) FROM {source.table_name}')
    return None if start is None else (start, end)


async def fetch_first_flux_timestamp(connection: Connection, source: FluxSource) -> Optional[datetime]:
    """
    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    return await connection.fetchval(f'SELECT MIN(time) FROM {source.table_name}')


async def fetch_last_flux_timestamp(connection: Connection, source: FluxSource) -> Optional[datetime]:
    """
    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    return await connection.fetchval(f'SELECT MAX(time) FROM {source.table_name}')
