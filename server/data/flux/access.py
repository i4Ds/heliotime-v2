from datetime import timedelta, datetime
from typing import Optional, Awaitable, Callable, cast

import pandas as pd
from asyncpg import Connection, Pool

from data.flux.spec.channel import FluxChannel
from data.flux.spec.data import empty_flux, FLUX_INDEX_NAME, FLUX_VALUE_NAME, Flux, RawFlux
from data.flux.spec.source import FluxSource
from utils.range import DateTimeRange


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
                    SELECT time_bucket($1, time) AS bucket, {max_column} AS flux
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


async def import_flux(
        connection: Connection, source: FluxSource,
        channels: dict[FluxChannel, tuple[Flux, DateTimeRange]]
):
    """
    Removes and reinserts all measurements in the of each provided channel
    and refreshes the aggregates for all channels in the combined time range.

    All channels of a time range should ideally be imported at once
    to avoid refreshing the aggregates multiple times.
    """
    if len(channels) == 0:
        return

    async with connection.transaction():
        for channel, (flux, time_range) in channels.items():
            # Delete old entries if they exist
            await connection.execute(
                f'''
                    DELETE FROM {source.table_name}
                    WHERE satellite = $1 AND band = $2 AND is_clean = $3
                      AND $4 <= time AND time < $5;
                ''',
                channel.satellite, channel.band, channel.is_clean, time_range.start, time_range.end
            )
            if len(flux) == 0:
                continue
            # Insert new entries
            await connection.copy_records_to_table(
                source.table_name,
                records=(
                    (time, value, channel.satellite, channel.band, channel.is_clean)
                    for time, value in flux.items()
                )
            )

    # refresh_continuous_aggregate() cannot be run within transactions
    start = min(time_range.start for _, time_range in channels.values())
    end = max(time_range.end for _, time_range in channels.values())
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


async def fetch_available_channels(
        connection: Connection, source: FluxSource, time_range: DateTimeRange = None
) -> set[FluxChannel]:
    """
    Retrieve a list of all flux channels with at least one stored measurement within a specified time range.

    :param connection: Database connection to use for the query
    :param source: Flux source containing table information
    :param time_range: Optional time range. If None, the entire time range is queried.
    :return: List of available flux channels
    """
    raw_channels = await connection.fetch(
        f'SELECT DISTINCT satellite, band, is_clean FROM {source.table_name}'
    ) if time_range is None else await connection.fetch(
        f'SELECT DISTINCT satellite, band, is_clean FROM {source.table_name} WHERE $1 <= time AND time < $2',
        time_range.start, time_range.end
    )
    return set(FluxChannel(*channel) for channel in raw_channels)
