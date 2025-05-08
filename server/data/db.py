from typing import Callable

import asyncpg
from alembic import command
from alembic.config import Config
from asyncpg import Connection, Pool

from config import DATABASE_URL, DATABASE_POOL_SIZE
from data.flux.spec.channel import FrequencyBand


def apply_db_migrations():
    command.upgrade(Config('alembic.ini'), 'head')


async def _register_codecs(connection: Connection):
    await FrequencyBand.register_codec(connection)


async def connect_db() -> Connection:
    connection = await asyncpg.connect(DATABASE_URL)
    await _register_codecs(connection)
    return connection


def create_db_pool(max_size: int = DATABASE_POOL_SIZE) -> Pool:
    return asyncpg.create_pool(
        DATABASE_URL,
        max_size=max_size,
        min_size=1,
        init=_register_codecs
    )


DbPoolFactory = Callable[[], Pool]
