from alembic import context
from sqlalchemy import engine_from_config
from sqlalchemy import pool

from config import DATABASE_URL
from utils.logging import configure_logging

configure_logging()

# This is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

config.set_main_option('sqlalchemy.url', DATABASE_URL)
config.set_main_option('transaction_per_migration', 'true')
connectable = engine_from_config(
    config.get_section(config.config_ini_section, {}),
    prefix="sqlalchemy.",
    poolclass=pool.NullPool,
)
with connectable.connect() as connection:
    context.configure(connection=connection)
    with context.begin_transaction():
        context.run_migrations()
