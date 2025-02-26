"""
Separate flux additionally by:
 - source satellite (GOES 1-18 or combined)
 - frequency band
 - raw and cleaned data

Revision ID: ffe208ef6408
Revises: 91f30f8d4289
Create Date: 2025-02-05 16:29:18.146715
"""
from datetime import timedelta
from typing import Sequence, Union

from alembic import op

from config import DATABASE_MEMORY_GB

# revision identifiers, used by Alembic.
revision: str = 'ffe208ef6408'
down_revision: Union[str, None] = '91f30f8d4289'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _drop_aggregate(view_name: str) -> str:
    return f'DROP MATERIALIZED VIEW {view_name}'


def _alter_table(table_name: str) -> str:
    return f'''
ALTER TABLE {table_name}
    ADD COLUMN satellite smallint       NOT NULL DEFAULT 0,
    ADD COLUMN band      frequency_band NOT NULL DEFAULT 'long',
    ADD COLUMN is_clean  boolean        NOT NULL DEFAULT true,
    ALTER COLUMN flux TYPE real, -- NOOA also doesn't use double precision
    ADD PRIMARY KEY (satellite, band, is_clean, time);
ALTER TABLE {table_name}
    ALTER COLUMN satellite DROP DEFAULT,
    ALTER COLUMN band DROP DEFAULT,
    ALTER COLUMN is_clean DROP DEFAULT;
'''


def _create_aggregate(
        view_name: str,
        parent_name: str,
        bucket_size: str,
        is_parent_table: bool,
) -> str:
    min_max_count = (
        'MIN(flux), MAX(flux), COUNT(flux)::integer'
        if is_parent_table else
        'MIN(flux_min), MAX(flux_max), SUM(count)::integer'
    )
    return f'''
CREATE MATERIALIZED VIEW {view_name}
            (time, satellite, band, is_clean, flux_min, flux_max, count) 
            WITH (timescaledb.continuous)
AS
SELECT time_bucket(INTERVAL '{bucket_size}', time) AS bucket,
       satellite,
       band,
       is_clean,
       {min_max_count}
FROM {parent_name}
GROUP BY bucket, satellite, band, is_clean
ORDER BY bucket
WITH NO DATA 
'''  # ^ With no data to first set the chunk size


# All active chunks should fill 25% of memory as recommended:
# https://docs.timescale.com/use-timescale/latest/hypertables/about-hypertables#best-practices-for-time-partitioning
# Average byte sizes per row:
# - Table: 115, compressed: 4.4 (26x smaller)
# - Aggregate: 124, compressed 8.4 (15x smaller)
_COMPRESSED_CHUNK_BYTES = min(max(
    DATABASE_MEMORY_GB * pow(10, 9)  # bytes of memory
    * 0.25  # 25%
    / (  # Estimated maximum number of active chunks
            (26 * 2) +  # One uncompressed chunk (26x bigger) per hypertable (archive and live)
            (15 * 10) +  # One uncompressed chunk (15x bigger) per aggregate (10 in total)
            20  # 20 compressed chunks
    ),
    pow(10, 6) * 8.4),  # Compressed chunks should hold at least 1 million rows
    pow(10, 9) / 26  # Uncompressed chunks shouldn't exceed 1GB
)


def _change_chunk_size(relation: str, interval: timedelta, is_table: bool) -> str:
    row_count = int(_COMPRESSED_CHUNK_BYTES / (4.4 if is_table else 8.4))
    chunk_interval = row_count * interval
    return f"SELECT set_chunk_time_interval('{relation}', INTERVAL '{chunk_interval.total_seconds()}s')"


def _enable_compression(relation: str, is_table: bool) -> str:
    noun = 'TABLE' if is_table else 'MATERIALIZED VIEW'
    return (
        # Compression policies require a continuous aggregate policy which:
        # - covers at least two buckets (and 5d is the largest bucket -> 10d range)
        # - doesn't intersect the compressed region (starts at 30d -> 29d cutoff).
        '' if is_table else f'''
SELECT add_continuous_aggregate_policy(
    '{relation}',
    start_offset => INTERVAL '29d',
    end_offset => INTERVAL '19d',
    schedule_interval => INTERVAL '1d'
);
'''
    ) + f'''
ALTER {noun} {relation}
    SET (timescaledb.compress,
         timescaledb.compress_orderby = 'time',
         timescaledb.compress_segmentby = 'satellite, band, is_clean');
SELECT add_compression_policy('{relation}', compress_after => INTERVAL '30d');
'''  # ^ The data streams have 30 days to catch up to avoid compressed inserts. (archive usually lags ~7 days)


def _refresh_aggregate(view_name: str) -> str:
    return f'CALL refresh_continuous_aggregate(\'{view_name}\', null, null)'


def upgrade() -> None:
    # Drop all aggregates to change the query and types (CASCADE doesn't work)
    op.execute(_drop_aggregate('flux_archive_5d'))
    op.execute(_drop_aggregate('flux_archive_12h'))
    op.execute(_drop_aggregate('flux_archive_1h'))
    op.execute(_drop_aggregate('flux_archive_10m'))
    op.execute(_drop_aggregate('flux_archive_1m'))
    op.execute(_drop_aggregate('flux_archive_10s'))
    op.execute(_drop_aggregate('flux_live_5d'))
    op.execute(_drop_aggregate('flux_live_12h'))
    op.execute(_drop_aggregate('flux_live_1h'))
    op.execute(_drop_aggregate('flux_live_10m'))

    # Add metadata columns
    op.execute('CREATE TYPE frequency_band AS ENUM (\'short\', \'long\')')
    op.execute(_alter_table('flux_archive'))
    op.execute(_alter_table('flux_live'))

    # Recreate all aggregates without real-time (one insert per minute is fine)
    op.execute(_create_aggregate(
        'flux_archive_10s', 'flux_archive', '00:00:10', True
    ))
    op.execute(_create_aggregate(
        'flux_archive_1m', 'flux_archive_10s', '00:01:00', False
    ))
    op.execute(_create_aggregate(
        'flux_archive_10m', 'flux_archive_1m', '00:10:00', False
    ))
    op.execute(_create_aggregate(
        'flux_archive_1h', 'flux_archive_10m', '01:00:00', False
    ))
    op.execute(_create_aggregate(
        'flux_archive_12h', 'flux_archive_1h', '12:00:00', False
    ))
    op.execute(_create_aggregate(
        'flux_archive_5d', 'flux_archive_12h', '5 days', False
    ))
    op.execute(_create_aggregate(
        'flux_live_10m', 'flux_live', '00:10:00', True
    ))
    op.execute(_create_aggregate(
        'flux_live_1h', 'flux_live_10m', '01:00:00', False
    ))
    op.execute(_create_aggregate(
        'flux_live_12h', 'flux_live_1h', '12:00:00', False
    ))
    op.execute(_create_aggregate(
        'flux_live_5d', 'flux_live_12h', '5 days', False
    ))

    # Enable compression
    op.execute(_enable_compression('flux_archive', True))
    op.execute(_enable_compression('flux_archive_10s', False))
    op.execute(_enable_compression('flux_archive_1m', False))
    op.execute(_enable_compression('flux_archive_10m', False))
    op.execute(_enable_compression('flux_archive_1h', False))
    op.execute(_enable_compression('flux_archive_12h', False))
    op.execute(_enable_compression('flux_archive_5d', False))
    op.execute(_enable_compression('flux_live', True))
    op.execute(_enable_compression('flux_live_10m', False))
    op.execute(_enable_compression('flux_live_1h', False))
    op.execute(_enable_compression('flux_live_12h', False))
    op.execute(_enable_compression('flux_live_5d', False))

    # Update all chunk sizes to account for compression and new row size.
    # Final chunk sizes are similar to previous ones, so no need to drop all chunks.
    op.execute(_change_chunk_size('flux_archive', timedelta(seconds=1), True))
    op.execute(_change_chunk_size('flux_archive_10s', timedelta(seconds=10), False))
    op.execute(_change_chunk_size('flux_archive_1m', timedelta(minutes=1), False))
    op.execute(_change_chunk_size('flux_archive_10m', timedelta(minutes=10), False))
    op.execute(_change_chunk_size('flux_archive_1h', timedelta(hours=1), False))
    op.execute(_change_chunk_size('flux_archive_12h', timedelta(hours=12), False))
    op.execute(_change_chunk_size('flux_archive_5d', timedelta(days=5), False))
    op.execute(_change_chunk_size('flux_live', timedelta(minutes=1), True))
    op.execute(_change_chunk_size('flux_live_10m', timedelta(minutes=10), False))
    op.execute(_change_chunk_size('flux_live_1h', timedelta(hours=1), False))
    op.execute(_change_chunk_size('flux_live_12h', timedelta(hours=12), False))
    op.execute(_change_chunk_size('flux_live_5d', timedelta(days=5), False))

    # Remove the retention policy entirely, because at 1m resolution one chunk will stay for ~14 years.
    op.execute('SELECT remove_retention_policy(\'flux_live\')')

    # Fill up all aggregates with data
    with op.get_context().autocommit_block():
        op.execute(_refresh_aggregate('flux_archive_10s'))
        op.execute(_refresh_aggregate('flux_archive_1m'))
        op.execute(_refresh_aggregate('flux_archive_10m'))
        op.execute(_refresh_aggregate('flux_archive_1h'))
        op.execute(_refresh_aggregate('flux_archive_12h'))
        op.execute(_refresh_aggregate('flux_archive_5d'))
        op.execute(_refresh_aggregate('flux_live_10m'))
        op.execute(_refresh_aggregate('flux_live_1h'))
        op.execute(_refresh_aggregate('flux_live_12h'))
        op.execute(_refresh_aggregate('flux_live_5d'))


def downgrade() -> None:
    pass
