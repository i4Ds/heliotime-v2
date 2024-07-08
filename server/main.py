import asyncio
from contextlib import asynccontextmanager
from datetime import datetime
from typing import cast, Optional

import asyncpg
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pandas import Timestamp

from data.db import create_db_pool, apply_db_migrations
from data.flux import fetch_flux
from importer.archive import ArchiveImporterProcess
from importer.live import LiveImporterProcess
from utils.logging import configure_logging

db_pool: asyncpg.Pool


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global db_pool
    configure_logging()
    apply_db_migrations()
    archive_importer = ArchiveImporterProcess()
    archive_importer.start()
    live_importer = LiveImporterProcess()
    live_importer.start()
    db_pool = await create_db_pool()
    yield
    await db_pool.close()
    archive_importer.kill()
    live_importer.kill()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,  # noqa
    allow_origins=['*'],  # TODO: make configurable
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get('/flux')
async def get_flux(
        resolution: int,
        start: Optional[datetime] = None,
        end: Optional[datetime] = None
):
    # TODO: check start < end
    # TODO: configure max resolution
    # TODO: investigate time inaccuracy (live data is not minute aligned)
    # TODO: add resource utilization check
    async with db_pool.acquire() as connection:
        series = await fetch_flux(connection, min(max(resolution, 1), 2000), start, end)
        return [
            (cast(Timestamp, timestamp).timestamp() * 1000, flux)
            for timestamp, flux in series.items()
        ]
