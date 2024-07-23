from contextlib import asynccontextmanager
from datetime import datetime
from typing import cast, Optional

import asyncpg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pandas import Timestamp
from pydantic import BaseModel

from config import FLUX_QUERY_TIMEOUT, FLUX_MAX_RESOLUTION
from data.db import create_db_pool, apply_db_migrations
from data.flux import fetch_flux, fetch_first_flux_timestamp, fetch_last_flux_timestamp
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
    if start is not None and end is not None and start > end:
        raise HTTPException(400, '"start" timestamp must be before "end" timestamp.')
    # TODO: investigate time inaccuracy (live data is not minute aligned)
    # TODO: add resource utilization check
    resolution = min(max(resolution, 1), FLUX_MAX_RESOLUTION)
    async with db_pool.acquire() as connection:
        try:
            series = await fetch_flux(
                connection, resolution, start, end,
                timeout=FLUX_QUERY_TIMEOUT
            )
        except TimeoutError:
            raise HTTPException(503, 'Query took too long to execute.')
        return [
            (cast(Timestamp, timestamp).timestamp() * 1000, flux)
            for timestamp, flux in series.items()
        ]


class Status(BaseModel):
    start: datetime
    end: datetime


@app.get('/status')
async def get_flux() -> Status:
    async with db_pool.acquire() as connection:
        # TODO: make single query
        return Status(
            start=await fetch_first_flux_timestamp(connection),
            end=await fetch_last_flux_timestamp(connection),
        )
