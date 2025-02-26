from datetime import timedelta, datetime
from typing import Optional, Awaitable, Callable, cast

import pandas as pd
from asyncpg import Connection, Pool

from data.flux.spec.channel import FluxChannel
from data.flux.spec.data import empty_flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux, RawFlux
from data.flux.spec.source import FluxSource


def _select_flux(
        connection: Connection | Pool,
        time_component: Callable[[str], str],
        source: FluxSource,
        channel: FluxChannel,
        interval: timedelta,
        start: datetime,
        end: datetime,
        timeout: Optional[timedelta] = None,
) -> Awaitable[list]:
    timeout_seconds = None if timeout is None else timeout.total_seconds()
    if interval <= source.raw_resolution:
        return connection.fetch(
            f'''
                SELECT {time_component('time')} AS time, flux
                FROM {source.table_name}
                WHERE satellite = $1 AND band = $2 AND is_clean = $3 AND $4 <= time AND time < $5
                ORDER BY time
            ''',
            channel.satellite, channel.band, channel.is_clean, start, end,
            timeout=timeout_seconds
        )
    relation = source.select_relation(interval)
    # Temporary workaround until aggregated flux is fully implemented
    max_column = 'MAX(flux)' if relation == source.table_name else 'MAX(flux_max)'
    return connection.fetch(
        f'''
                WITH downscale AS(
                    SELECT time_bucket($1, time) AS bucket, ${max_column} AS flux
                    FROM {relation}
                    WHERE satellite = $2 AND band = $3 AND is_clean = $4 AND $5 <= time AND time < $6
                    GROUP BY bucket
                ) 
                SELECT {time_component('bucket')} AS time, flux
                FROM downscale
                ORDER BY bucket
            ''',
        interval, channel.satellite, channel.band, channel.is_clean, start, end,
        timeout=timeout_seconds
    )


async def fetch_flux(
        connection: Connection | Pool,
        source: FluxSource,
        channel: FluxChannel,
        interval: timedelta,
        start: datetime,
        end: datetime,
        timeout: Optional[timedelta] = None,
) -> Flux:
    records = await _select_flux(
        connection,
        lambda column: column,
        source, channel, interval, start, end, timeout
    )
    return empty_flux() if len(records) == 0 else pd.DataFrame(
        records,
        columns=[FLUX_INDEX_NAME, FLUX_VALUE_NAME]
    ).set_index(FLUX_INDEX_NAME)[FLUX_VALUE_NAME]


async def fetch_raw_flux(
        connection: Connection | Pool,
        source: FluxSource,
        channel: FluxChannel,
        interval: timedelta,
        start: datetime,
        end: datetime,
        timeout: Optional[timedelta] = None,
) -> RawFlux:
    records = await _select_flux(
        connection,
        lambda column: f'(EXTRACT(EPOCH FROM {column}) * 1000)::BIGINT',
        source, channel, interval, start, end, timeout
    )
    return cast(RawFlux, map(tuple, records))


async def import_flux(connection: Connection, source: FluxSource, channels: dict[FluxChannel, Flux]):
    """
    Inserts or replaces all measurements in the time range of each provided channel
    and refreshes the aggregates for all channels in the combined time range.

    Multiple channels can be imported at once and should ideally overlap in time
    to avoid refreshing the aggregates multiple times.
    """
    # Clean empty channels
    channels = {
        channel: flux
        for channel, flux in channels.items()
        if len(flux) > 0
    }
    if len(channels) == 0:
        return

    async with connection.transaction():
        for channel, flux in channels.items():
            # Delete old entries if they exist
            await connection.execute(
                f'''
                    DELETE FROM {source.table_name}
                    WHERE satellite = $1 AND band = $2 AND is_clean = $3
                      AND $4 <= time AND time <= $5;
                ''',
                channel.satellite, channel.band, channel.is_clean, flux.index[0], flux.index[-1]
            )
            # Insert new entries
            await connection.copy_records_to_table(
                source.table_name,
                records=(
                    (time, value, channel.satellite, channel.band, channel.is_clean)
                    for time, value in flux.items()
                )
            )

    # refresh_continuous_aggregate() cannot be run within transaction
    start = min(flux.index[0] for flux in channels.values())
    end = max(flux.index[-1] for flux in channels.values())
    for resolution in source.resolutions:
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


async def fetch_flux_timestamp_range(
        connection: Connection, source: FluxSource, channel: FluxChannel
) -> tuple[datetime, datetime] | None:
    """
    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    start, end = await connection.fetchrow(
        f'SELECT MIN(time), MAX(time) FROM {source.table_name} '
        f'WHERE satellite = $1 AND band = $2 AND is_clean = $3',
        channel.satellite, channel.band, channel.is_clean
    )
    return None if start is None else (start, end)


async def fetch_last_flux_timestamp(connection: Connection, source: FluxSource) -> Optional[datetime]:
    """
    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    return await connection.fetchval(f'SELECT MAX(time) FROM {source.table_name}')
