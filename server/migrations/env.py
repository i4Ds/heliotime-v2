from alembic import context
from sqlalchemy import engine_from_config
from sqlalchemy import pool

from config import DATABASE_URL
from utils.logging import configure_logging

configure_logging()

# This is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# SQLAlchemy 2.1 treats a plain postgresql:// URL as the psycopg 3 driver.
# Migrations use psycopg2, which is the driver installed in the server image.
# The application itself connects with asyncpg and keeps the original URL.
migration_url = DATABASE_URL.replace('postgresql://', 'postgresql+psycopg2://', 1)
config.set_main_option('sqlalchemy.url', migration_url)
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
