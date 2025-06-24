from collections import deque
from datetime import timedelta, datetime
from io import BytesIO, TextIOWrapper
from typing import Optional, Awaitable, Callable, cast

import pandas as pd
from asyncpg import Connection, Pool

from data.flux.spec.channel import FluxChannel, SATELLITE_COMBINED_ID
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

    # Disable the tuple decompression limit per DML transaction
    # to allow importing past data without hitting the default limit.
    await connection.execute("SET timescaledb.max_tuples_decompressed_per_dml_transaction TO 0")

    async with connection.transaction():
        # Delete existing entries in the time range
        delete_conditions = deque()
        delete_params = deque()
        for channel, (_, time_range) in channels.items():
            param_index = len(delete_params) + 1
            delete_conditions.append(
                f"(satellite = ${param_index} AND band = ${param_index + 1} AND is_clean = ${param_index + 2} "
                f"AND ${param_index + 3} <= time AND time < ${param_index + 4})"
            )
            delete_params.extend([
                channel.satellite, channel.band, channel.is_clean,
                time_range.start, time_range.end
            ])
        await connection.execute(
            f'''
                DELETE FROM {source.table_name}
                WHERE {" OR ".join(delete_conditions)}
                ''',
            *delete_params
        )

        # Insert new entries with fast to_csv & copy
        with BytesIO() as buffer:
            wrapper = TextIOWrapper(buffer, encoding='utf-8')
            for index, (channel, (flux, _)) in enumerate(channels.items()):
                if len(flux) == 0:
                    continue
                if index > 0:
                    # Reset buffer before reuse
                    buffer.seek(0)
                    buffer.truncate()

                # Should already be NaN-free, but just in case.
                flux.dropna().to_frame().assign(
                    satellite=channel.satellite,
                    band=channel.band.value,
                    is_clean=int(channel.is_clean),
                ).to_csv(
                    wrapper, header=False, sep='\t',
                    # 9 digits preserves float32 precision
                    float_format="%.9g"
                )
                wrapper.flush()
                buffer.seek(0)
                await connection.copy_to_table(source.table_name, source=buffer)

    # Refresh the continuous aggregates for all channels.
    # refresh_continuous_aggregate() cannot be run within transactions.
    time_range = DateTimeRange.which_includes([r for _, r in channels.values()])
    for resolution in source.resolutions:
        await connection.execute(
            f"""
                CALL refresh_continuous_aggregate(
                    '{source.table_name}{resolution.suffix}', 
                    $1::TIMESTAMPTZ, $2::TIMESTAMPTZ
                )
            """,
            # Extend update range to include the buckets at the edge
            time_range.start - resolution.size, time_range.end + resolution.size
        )


async def fetch_flux_timestamp_range(
        connection: Connection | Pool, source: FluxSource, channel: FluxChannel
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


async def fetch_last_non_combined_flux_timestamp(
        connection: Connection | Pool, source: FluxSource
) -> Optional[datetime]:
    """
    Only queries non-combined flux measurements to ignore old combined measurements
    from older server versions.

    Can be extremely slow if there are a lot of chunks.
    See: https://github.com/timescale/timescaledb/issues/5102
    """
    return await connection.fetchval(
        f'SELECT MAX(time) FROM {source.table_name} ' +
        f'WHERE satellite != {SATELLITE_COMBINED_ID}'
    )


async def fetch_available_channels(
        connection: Connection | Pool, source: FluxSource, time_range: DateTimeRange = None
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


async def recompress_chunks(
        connection: Connection,
        source: FluxSource,
        before: datetime,
        recompression_threshold: float = 1.2
):
    """
    Compress or recompresses chunks of a hypertable before a specified datetime.

    A chunk is considered for recompression if it meets one of the following criteria:
    - The chunk is not currently compressed.
    - The chunk's current disk size is larger than its size immediately after
      its last compression by the given threshold.

    Changes to already compressed chunks do not get compressed automatically and
    require a manual recompression to keep the size small.

    :param connection: The database connection.
    :param source: The flux source specifying the hypertable.
    :param before: A datetime indicating that only chunks fully before this
                   time should be considered.
    :param recompression_threshold: The factor by which the current size must
                                    exceed the post-compression size to trigger
                                    a recompression (e.g., 1.1 for 10% larger).
    """
    chunks = await connection.fetch(
        f"""
            SELECT
              c.chunk_schema,
              c.chunk_name,
              cs.after_compression_total_bytes,
              s.total_bytes
            FROM timescaledb_information.chunks c
            LEFT JOIN chunk_compression_stats('{source.table_name}') cs ON c.chunk_schema = cs.chunk_schema AND c.chunk_name = cs.chunk_name
            LEFT JOIN chunks_detailed_size('{source.table_name}') s ON c.chunk_schema = s.chunk_schema AND c.chunk_name = s.chunk_name
            WHERE c.hypertable_name = $1 AND c.range_end < $2
            ORDER BY c.range_start
        """,
        source.table_name, before
    )

    for chunk in chunks:
        after_compression_bytes = chunk['after_compression_total_bytes']
        current_bytes = chunk['total_bytes']
        needs_recompression = (
                after_compression_bytes is None or
                (current_bytes is not None and current_bytes > after_compression_bytes * recompression_threshold)
        )

        if needs_recompression:
            qualified_chunk_name = f'"{chunk["chunk_schema"]}"."{chunk["chunk_name"]}"'
            # Complete decompression and recompression is necessary to force a proper recompression.
            await connection.execute(f"SELECT decompress_chunk('{qualified_chunk_name}')")
            await connection.execute(f"SELECT compress_chunk('{qualified_chunk_name}')")
