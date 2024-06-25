"""
Add flux table and aggregates

Revision ID: b6c5d29b72af
Revises: 
Create Date: 2024-06-20 14:23:41.699998
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'b6c5d29b72af'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_downscale(
        view_name: str,
        parent_name: str,
        real_time: bool,
        bucket_size: str,
        start_offset: str,
        end_offset: str,
        schedule_interval: str
) -> str:
    return f'''
        CREATE MATERIALIZED VIEW {view_name}
                    (time, flux)
                    WITH (
                    timescaledb.continuous,
                    timescaledb.materialized_only = {str(real_time).lower()}
                    )
        AS
        SELECT time_bucket(INTERVAL '{bucket_size}', time) AS bucket,
               MAX(flux)
        FROM {parent_name}
        GROUP BY bucket
        ORDER BY bucket
        WITH NO DATA;
        SELECT add_continuous_aggregate_policy('{view_name}',
          start_offset => INTERVAL '{start_offset}',
          end_offset => INTERVAL '{end_offset}',
          schedule_interval => INTERVAL '{schedule_interval}'
        );
    '''


def upgrade() -> None:
    op.execute('''
        CREATE TABLE flux
        (
            time TIMESTAMPTZ      NOT NULL,
            flux DOUBLE PRECISION NOT NULL
        );
        SELECT create_hypertable('flux', by_range('time'));
    ''')

    '''
    Downscale bucket sizes where chosen so that each step is a multiple between 6-12.
    This limits the maximum number of rows needed for the worst case fetch (assuming max resolution 2000):
    12*2000=24000
    Real time calculations were not taken into account but should be negligible.
    5 days is the lowest resolution because that is what is roughly needed to fetch 40 years:
    40*365/2000=7.3 days  
    '''
    op.execute(_create_downscale(
        view_name='flux_10s',
        parent_name='flux',
        real_time=True,
        bucket_size='00:00:10',
        start_offset='1 week',
        end_offset='00:05:00',
        schedule_interval='00:01:00'
    ))
    op.execute(_create_downscale(
        view_name='flux_1m',
        parent_name='flux_10s',
        real_time=True,
        bucket_size='00:01:00',
        start_offset='1 week',
        end_offset='00:05:00',
        schedule_interval='00:01:00'
    ))
    op.execute(_create_downscale(
        view_name='flux_10m',
        parent_name='flux_1m',
        real_time=True,
        bucket_size='00:10:00',
        start_offset='1 week',
        end_offset='00:10:00',
        schedule_interval='00:10:00'
    ))
    op.execute(_create_downscale(
        view_name='flux_1h',
        parent_name='flux_10m',
        real_time=False,
        bucket_size='01:00:00',
        start_offset='1 week',
        end_offset='00:10:00',
        schedule_interval='00:10:00'
    ))
    op.execute(_create_downscale(
        view_name='flux_12h',
        parent_name='flux_1h',
        real_time=False,
        bucket_size='12:00:00',
        start_offset='1 week',
        end_offset='00:10:00',
        schedule_interval='00:10:00'
    ))
    op.execute(_create_downscale(
        view_name='flux_5d',
        parent_name='flux_12h',
        real_time=False,
        bucket_size='5 days',
        start_offset='30 days',
        end_offset='00:10:00',
        schedule_interval='00:10:00'
    ))

    # Cannot refresh inside transaction so all views are initially created with no data
    # See: https://github.com/timescale/timescaledb/issues/2876
    with op.get_context().autocommit_block():
        op.execute("CALL refresh_continuous_aggregate('flux_10s', NULL, NULL)")
        op.execute("CALL refresh_continuous_aggregate('flux_1m', NULL, NULL)")
        op.execute("CALL refresh_continuous_aggregate('flux_10m', NULL, NULL)")
        op.execute("CALL refresh_continuous_aggregate('flux_1h', NULL, NULL)")
        op.execute("CALL refresh_continuous_aggregate('flux_12h', NULL, NULL)")
        op.execute("CALL refresh_continuous_aggregate('flux_5d', NULL, NULL)")


def downgrade() -> None:
    pass
