from contextlib import asynccontextmanager
from datetime import datetime
from typing import cast

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pandas import Timestamp

from data.db import create_db_pool
from data.flux import fetch_flux
from data.importer import ImporterProcess

db_pool: asyncpg.Pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global db_pool
    importer = ImporterProcess()
    importer.start()
    db_pool = await create_db_pool()
    yield
    importer.kill()
    await db_pool.close()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,  # noqa
    allow_origins=['*'],  # TODO: make configurable
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get('/flux')
async def get_flux(start: datetime, end: datetime, resolution: int):
    # TODO: check start < end
    # TODO: configure max resolution
    async with db_pool.acquire() as connection:
        series = await fetch_flux(connection, start, end, min(resolution, 2000))
        return [
            (cast(Timestamp, timestamp).timestamp() * 1000, flux)
            for timestamp, flux in series.items()
        ]
