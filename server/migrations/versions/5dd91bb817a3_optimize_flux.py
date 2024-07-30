"""
Optimize Flux by
- Making the right aggregates real time
- Setting optimized chunk sizes

Revision ID: 5dd91bb817a3
Revises: 101fa09da5c0
Create Date: 2024-07-30 08:10:09.977904
"""
from typing import Sequence, Union

from alembic import op
from asyncpg.pgproto.pgproto import timedelta

from config import FLUX_MAX_RESOLUTION

# revision identifiers, used by Alembic.
revision: str = '5dd91bb817a3'
down_revision: Union[str, None] = '101fa09da5c0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _change_real_time(view: str, real_time: bool) -> str:
    return f'ALTER MATERIALIZED VIEW {view} SET ( timescaledb.materialized_only = {str(not real_time).lower()} )'


def _change_chunk_size(relation: str, interval: timedelta, upper_interval: timedelta) -> str:
    size = interval * FLUX_MAX_RESOLUTION * (upper_interval / interval)
    return f"SELECT set_chunk_time_interval('{relation}', INTERVAL '{size.total_seconds()}s')"


def _drop_all_chunks(relation: str) -> str:
    # No chunk will be created before 1970 so this effectively drops all chunks
    return f"SELECT drop_chunks('{relation}', created_after := to_timestamp(0))"


def upgrade() -> None:
    # Was applied incorrectly previously
    op.execute(_change_real_time('flux_archive_10s', True))
    op.execute(_change_real_time('flux_archive_1m', True))
    op.execute(_change_real_time('flux_archive_10m', True))
    op.execute(_change_real_time('flux_archive_1h', False))
    op.execute(_change_real_time('flux_archive_12h', False))
    op.execute(_change_real_time('flux_archive_5d', False))
    op.execute(_change_real_time('flux_live_10m', True))
    op.execute(_change_real_time('flux_live_1h', False))
    op.execute(_change_real_time('flux_live_12h', False))
    op.execute(_change_real_time('flux_live_5d', False))

    # Optimize that each chunk is as large as the largest allowed fetch
    op.execute(_change_chunk_size('flux_archive', timedelta(seconds=1), timedelta(seconds=10)))
    op.execute(_change_chunk_size('flux_archive_10s', timedelta(seconds=10), timedelta(minutes=1)))
    op.execute(_change_chunk_size('flux_archive_1m', timedelta(minutes=1), timedelta(minutes=10)))
    op.execute(_change_chunk_size('flux_archive_10m', timedelta(minutes=10), timedelta(hours=1)))
    op.execute(_change_chunk_size('flux_archive_1h', timedelta(hours=1), timedelta(hours=12)))
    op.execute(_change_chunk_size('flux_archive_12h', timedelta(hours=12), timedelta(days=5)))
    op.execute(_change_chunk_size('flux_archive_5d', timedelta(days=5), timedelta(days=20)))
    op.execute(_change_chunk_size('flux_live', timedelta(minutes=1), timedelta(minutes=10)))
    op.execute(_change_chunk_size('flux_live_10m', timedelta(minutes=10), timedelta(hours=1)))
    op.execute(_change_chunk_size('flux_live_1h', timedelta(hours=1), timedelta(hours=12)))
    op.execute(_change_chunk_size('flux_live_12h', timedelta(hours=12), timedelta(days=5)))
    op.execute(_change_chunk_size('flux_live_5d', timedelta(days=5), timedelta(days=20)))

    # Drop all chunks to make timescale use the new setting.
    # Will also delete all date, triggering an import.
    op.execute(_drop_all_chunks('flux_archive'))
    op.execute(_drop_all_chunks('flux_archive_10s'))
    op.execute(_drop_all_chunks('flux_archive_1m'))
    op.execute(_drop_all_chunks('flux_archive_10m'))
    op.execute(_drop_all_chunks('flux_archive_1h'))
    op.execute(_drop_all_chunks('flux_archive_12h'))
    op.execute(_drop_all_chunks('flux_archive_5d'))
    op.execute(_drop_all_chunks('flux_live'))
    op.execute(_drop_all_chunks('flux_live_10m'))
    op.execute(_drop_all_chunks('flux_live_1h'))
    op.execute(_drop_all_chunks('flux_live_12h'))
    op.execute(_drop_all_chunks('flux_live_5d'))


def downgrade() -> None:
    pass
