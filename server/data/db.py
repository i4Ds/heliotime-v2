from typing import Awaitable

import asyncpg
from asyncpg import Connection, Pool

from config import DATABASE_URL


def connect_db() -> Awaitable[Connection]:
    return asyncpg.connect(DATABASE_URL)


def create_db_pool() -> Pool:
    return asyncpg.create_pool(DATABASE_URL)
