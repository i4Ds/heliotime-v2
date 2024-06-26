"""
Add flux table and aggregates

Revision ID: b6c5d29b72af
Revises: 
Create Date: 2024-06-20 14:23:41.699998
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b6c5d29b72af'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_raw(table_name: str) -> str:
    return f'''
        CREATE TABLE {table_name}
        (
            time TIMESTAMPTZ      NOT NULL,
            flux DOUBLE PRECISION NOT NULL
        );
        SELECT create_hypertable('{table_name}', by_range('time'));
    '''


def _create_downscale(
        view_name: str,
        parent_name: str,
        bucket_size: str,
        real_time: bool = False,
        continuous: bool = False,
        start_offset: str = '8 days',
        end_offset: str = '00:10:00',
        schedule_interval: str = '00:05:00',
        initial_start: str = '2000-01-01T00:00:00Z',
) -> str:
    sql = f'''
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
    '''
    if continuous:
        sql += f"""
            SELECT add_continuous_aggregate_policy('{view_name}',
              start_offset => INTERVAL '{start_offset}',
              end_offset => INTERVAL '{end_offset}',
              schedule_interval => INTERVAL '{schedule_interval}',
              initial_start => TIMESTAMPTZ '{initial_start}'
            );
        """
    return sql


def _create_retention(relation_name: str, drop_after: str = '60 days'):
    return f"SELECT add_retention_policy('{relation_name}', drop_after => INTERVAL '{drop_after}')"


def _create_merge(
        view_name: str,
        archive_source: str,
        live_source: str
) -> str:
    return f"""
        CREATE VIEW {view_name} AS
        SELECT *
        FROM {archive_source}
        UNION ALL
        SELECT *
        FROM {live_source}
        WHERE (SELECT MAX(time) FROM {archive_source}) < time
    """


def upgrade() -> None:
    # Stores 1s data with ~4 days delay
    op.execute(_create_raw('flux_archive'))
    '''
    Downscale bucket sizes where chosen so that each step is a multiple between 6-12.
    This limits the maximum number of rows needed for the worst case fetch (assuming max resolution 2000):
    12*2000=24000
    Real time calculations were not taken into account but should be negligible.
    5 days is the lowest resolution because that is what is roughly needed to fetch 40 years:
    40*365/2000=7.3 days  
    '''
    op.execute(_create_downscale(
        view_name='flux_archive_10s',
        parent_name='flux_archive',
        bucket_size='00:00:10',
    ))
    op.execute(_create_downscale(
        view_name='flux_archive_1m',
        parent_name='flux_archive_10s',
        bucket_size='00:01:00',
    ))
    op.execute(_create_downscale(
        view_name='flux_archive_10m',
        parent_name='flux_archive_1m',
        bucket_size='00:10:00',
    ))
    op.execute(_create_downscale(
        view_name='flux_archive_1h',
        parent_name='flux_archive_10m',
        bucket_size='01:00:00',
    ))
    op.execute(_create_downscale(
        view_name='flux_archive_12h',
        parent_name='flux_archive_1h',
        bucket_size='12:00:00',
    ))
    op.execute(_create_downscale(
        view_name='flux_archive_5d',
        parent_name='flux_archive_12h',
        bucket_size='5 days',
    ))

    # Stores 1m averaged data with ~6 seconds delay
    op.execute(_create_raw('flux_live'))
    op.execute(_create_downscale(
        view_name='flux_live_10m',
        parent_name='flux_live',
        bucket_size='00:10:00',
        real_time=True,
        continuous=True,
        initial_start='2000-01-01T00:00:00Z',
    ))
    op.execute(_create_downscale(
        view_name='flux_live_1h',
        parent_name='flux_live_10m',
        bucket_size='01:00:00',
        real_time=True,
        continuous=True,
        # Add 20 second offset to each refresh interval
        # so the higher level uses the newly computed lower level.
        initial_start='2000-01-01T00:00:20Z',
    ))
    op.execute(_create_downscale(
        view_name='flux_live_12h',
        parent_name='flux_live_1h',
        real_time=False,
        bucket_size='12:00:00',
        continuous=True,
        initial_start='2000-01-01T00:00:40Z',
    ))
    op.execute(_create_downscale(
        view_name='flux_live_5d',
        parent_name='flux_live_12h',
        bucket_size='5 days',
        real_time=False,
        continuous=True,
        start_offset='15 days',
        initial_start='2000-01-01T00:01:00Z',
    ))
    # Live data is no longer needed as archive catches up
    op.execute(_create_retention('flux_live'))
    op.execute(_create_retention('flux_live_10m'))
    op.execute(_create_retention('flux_live_1h'))
    op.execute(_create_retention('flux_live_12h'))
    op.execute(_create_retention('flux_live_5d'))

    # Make views merging archive and live together
    op.execute(_create_merge(
        view_name='flux',
        archive_source='flux_archive',
        live_source='flux_live'
    ))
    op.execute(_create_merge(
        view_name='flux_10s',
        archive_source='flux_archive_10s',
        live_source='flux_live'
    ))
    op.execute(_create_merge(
        view_name='flux_1m',
        archive_source='flux_archive_1m',
        live_source='flux_live'
    ))
    op.execute(_create_merge(
        view_name='flux_10m',
        archive_source='flux_archive_10m',
        live_source='flux_live_10m'
    ))
    op.execute(_create_merge(
        view_name='flux_1h',
        archive_source='flux_archive_1h',
        live_source='flux_live_1h'
    ))
    op.execute(_create_merge(
        view_name='flux_12h',
        archive_source='flux_archive_12h',
        live_source='flux_live_12h'
    ))
    op.execute(_create_merge(
        view_name='flux_5d',
        archive_source='flux_archive_5d',
        live_source='flux_live_5d'
    ))


def downgrade() -> None:
    pass
