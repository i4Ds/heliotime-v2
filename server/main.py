from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import cast, Optional

import asyncpg
from asyncpg.pgproto.pgproto import timedelta
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pandas import Timestamp
from pydantic import BaseModel

from config import FLUX_QUERY_TIMEOUT, FLUX_MAX_RESOLUTION
from data.db import create_db_pool, apply_db_migrations
from data.flux.fetcher import FluxFetcher
from data.flux.spec import empty_flux
from importer.archive import ArchiveImporterProcess
from importer.live import LiveImporterProcess
from utils.logging import configure_logging

db_pool: asyncpg.Pool
flux_fetcher: FluxFetcher


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global db_pool, flux_fetcher
    configure_logging()
    apply_db_migrations()

    archive_importer = ArchiveImporterProcess()
    archive_importer.start()
    live_importer = LiveImporterProcess()
    live_importer.start()

    db_pool = await create_db_pool()
    flux_fetcher = FluxFetcher(db_pool)

    yield

    flux_fetcher.cancel()
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
    if flux_fetcher.start is None or flux_fetcher.end is None:
        # If there is no extreme there isn't any data at all.
        return empty_flux()
    if start is None:
        start = flux_fetcher.start
    if end is None:
        end = datetime.now(timezone.utc)
    if start > end:
        raise HTTPException(400, '"start" timestamp must be before "end" timestamp.')
    if end - start > timedelta(days=100 * 365):
        raise HTTPException(400, 'Time range cannot be larger than 100 years.')

    # TODO: add resource utilization check
    resolution = min(max(resolution, 1), FLUX_MAX_RESOLUTION)
    interval = (end - start) / resolution
    try:
        series = await flux_fetcher.fetch(start, end, interval, FLUX_QUERY_TIMEOUT)
    except TimeoutError:
        raise HTTPException(503, 'Query took too long to execute.')
    return [
        (cast(Timestamp, timestamp).timestamp() * 1000, flux)
        for timestamp, flux in series.items()
    ]


class Status(BaseModel):
    start: datetime | None
    end: datetime | None


@app.get('/status')
async def get_flux() -> Status:
    return Status(
        start=flux_fetcher.start,
        end=flux_fetcher.end
    )
