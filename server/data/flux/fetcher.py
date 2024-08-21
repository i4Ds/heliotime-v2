import asyncio
import itertools
from collections import deque
from datetime import datetime, timedelta
from typing import Optional, cast, Awaitable

import asyncpg
import pandas as pd

from data.flux.access import fetch_flux_timestamp_range, fetch_flux, fetch_raw_flux
from data.flux.source import FluxSource
from data.flux.spec import Flux, empty_flux, RawFlux


class FluxFetcher:
    # Sorted from highest to lowest priority
    _SOURCES = (
        FluxSource.ARCHIVE,
        FluxSource.LIVE,
    )

    _pool: asyncpg.Pool
    _update_task: asyncio.Task

    _ranges: dict[FluxSource, tuple[datetime, datetime]]
    start: Optional[datetime]
    end: Optional[datetime]

    def __init__(self, pool: asyncpg.Pool, update_interval=timedelta(seconds=10)):
        self._pool = pool
        self._ranges = {}
        self.start = None
        self.end = None
        self._update_task = asyncio.create_task(self._update_periodically(update_interval))

    async def _update_periodically(self, interval: timedelta):
        try:
            while True:
                await self.update()
                await asyncio.sleep(interval.total_seconds())
        except asyncio.CancelledError:
            return

    async def update(self):
        async with self._pool.acquire() as connection:
            ranges = {}
            start = end = None
            for source in self._SOURCES:
                timestamp_range = await fetch_flux_timestamp_range(connection, source)
                if timestamp_range is None:
                    continue
                ranges[source] = timestamp_range
                if start is None or timestamp_range[0] < start:
                    start = timestamp_range[0]
                if end is None or end < timestamp_range[1]:
                    end = timestamp_range[1]
            self._ranges = ranges
            self.start = start
            self.end = end

    def _fetch_sections(
            self,
            fetch_function: type[fetch_flux] | type[fetch_raw_flux],
            start: datetime, end: datetime,
            interval: timedelta, timeout: Optional[timedelta] = None
    ) -> Awaitable[tuple]:
        section_start = start
        sections = deque()
        for source in self._SOURCES:
            source_range = self._ranges.get(source)
            if source_range is None or source_range[1] < section_start:
                continue
            if end < source_range[0]:
                break
            section_end = min(source_range[1], end)
            sections.append(fetch_function(
                self._pool, source, interval,
                section_start, section_end, timeout
            ))
            if end <= source_range[1]:
                break
            section_start = section_end
        return asyncio.gather(*sections)

    async def fetch(
            self,
            start: datetime, end: datetime,
            interval: timedelta, timeout: Optional[timedelta] = None
    ) -> Flux:
        sections = await self._fetch_sections(fetch_flux, start, end, interval, timeout)
        return (
            empty_flux()
            if len(sections) == 0 else
            cast(pd.Series, pd.concat(sections))
        )

    async def fetch_raw(
            self,
            start: datetime, end: datetime,
            interval: timedelta, timeout: Optional[timedelta] = None
    ) -> RawFlux:
        sections = await self._fetch_sections(fetch_raw_flux, start, end, interval, timeout)
        return itertools.chain.from_iterable(sections)

    def cancel(self):
        self._update_task.cancel()
