from typing import Awaitable

import asyncpg
from alembic import command
from alembic.config import Config
from asyncpg import Connection, Pool

from config import DATABASE_URL, DATABASE_POOL_SIZE


def apply_db_migrations():
    command.upgrade(Config('alembic.ini'), 'head')


def connect_db() -> Awaitable[Connection]:
    return asyncpg.connect(DATABASE_URL)


def create_db_pool() -> Pool:
    return asyncpg.create_pool(
        DATABASE_URL,
        max_size=DATABASE_POOL_SIZE,
        min_size=min(10, DATABASE_POOL_SIZE)
    )
