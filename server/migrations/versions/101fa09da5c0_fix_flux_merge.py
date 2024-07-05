"""
Fix flux merge

Revision ID: 101fa09da5c0
Revises: b6c5d29b72af
Create Date: 2024-07-05 07:36:51.447113
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '101fa09da5c0'
down_revision: Union[str, None] = 'b6c5d29b72af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _replace_merge(
        view_name: str,
        archive_source: str,
        live_source: str
) -> str:
    return f"""
        CREATE OR REPLACE VIEW {view_name} AS
        SELECT *
        FROM {archive_source}
        UNION ALL
        SELECT *
        FROM {live_source}
        WHERE (SELECT MAX(time) FROM flux_archive) IS NULL
           OR (SELECT MAX(time) FROM {archive_source}) < time
    """


def upgrade() -> None:
    op.execute(_replace_merge(
        view_name='flux',
        archive_source='flux_archive',
        live_source='flux_live'
    ))
    op.execute(_replace_merge(
        view_name='flux_10s',
        archive_source='flux_archive_10s',
        live_source='flux_live'
    ))
    op.execute(_replace_merge(
        view_name='flux_1m',
        archive_source='flux_archive_1m',
        live_source='flux_live'
    ))
    op.execute(_replace_merge(
        view_name='flux_10m',
        archive_source='flux_archive_10m',
        live_source='flux_live_10m'
    ))
    op.execute(_replace_merge(
        view_name='flux_1h',
        archive_source='flux_archive_1h',
        live_source='flux_live_1h'
    ))
    op.execute(_replace_merge(
        view_name='flux_12h',
        archive_source='flux_archive_12h',
        live_source='flux_live_12h'
    ))
    op.execute(_replace_merge(
        view_name='flux_5d',
        archive_source='flux_archive_5d',
        live_source='flux_live_5d'
    ))


def downgrade() -> None:
    pass
