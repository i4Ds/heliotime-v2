"""
Remove merged views

Revision ID: 91f30f8d4289
Revises: 5dd91bb817a3
Create Date: 2024-08-07 15:01:10.880917
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '91f30f8d4289'
down_revision: Union[str, None] = '5dd91bb817a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute('DROP VIEW flux')
    op.execute('DROP VIEW flux_10s')
    op.execute('DROP VIEW flux_1m')
    op.execute('DROP VIEW flux_10m')
    op.execute('DROP VIEW flux_1h')
    op.execute('DROP VIEW flux_12h')
    op.execute('DROP VIEW flux_5d')


def downgrade() -> None:
    pass
