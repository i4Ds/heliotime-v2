from typing import Awaitable

import asyncpg
from alembic import command
from alembic.config import Config
from asyncpg import Connection, Pool

from config import DATABASE_URL


def _apply_migrations():
    command.upgrade(Config('alembic.ini'), 'head')


def connect_db() -> Awaitable[Connection]:
    _apply_migrations()
    return asyncpg.connect(DATABASE_URL)


def create_db_pool() -> Pool:
    _apply_migrations()
    return asyncpg.create_pool(DATABASE_URL)
