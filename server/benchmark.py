from __future__ import annotations

import asyncio
import logging
import math
import statistics
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timedelta
from multiprocessing import Pool
from typing import Annotated, Awaitable, Callable

import numpy as np
from aiohttp import ClientSession, ClientResponse
from typer import Typer, Argument

from config import FLUX_MAX_RESOLUTION
from utils.logging import configure_logging

_logger = logging.getLogger(f'benchmarker')
Range = tuple[datetime, datetime]


async def _fetch_flux_range(session: ClientSession, base_url: str) -> Range | None:
    response = await session.get(base_url + '/status')
    response.raise_for_status()
    json = await response.json()
    if json['start'] is None or json['end'] is None:
        return None
    return (
        datetime.fromisoformat(json['start']),
        datetime.fromisoformat(json['end'])
    )


async def _fetch_flux_range_definitive(
        session: ClientSession,
        base_url: str,
        tries=10,
        wait=timedelta(seconds=5)
) -> Range:
    for _ in range(tries):
        flux_range = await _fetch_flux_range(session, base_url)
        if flux_range is not None:
            return flux_range
        _logger.warning(f'Benchmark target is initializing or has not data. Retrying in {wait}')
        await asyncio.sleep(wait.total_seconds())
    _logger.error(f'Benchmark target still not ready. Giving up.')
    raise ValueError('Benchmark target did not become ready.')


async def _fetch_flux(session: ClientSession, base_url: str, start: datetime, end: datetime) -> ClientResponse:
    return await session.get(base_url + '/flux', params={
        'resolution': FLUX_MAX_RESOLUTION,
        'start': start.isoformat(),
        'end': end.isoformat()
    })


async def _measure_request(request: Callable[[], Awaitable[ClientResponse]]) -> float:
    start_time = time.perf_counter()
    response = await request()
    if not response.ok:
        raise ValueError(f'Received error response {response.status}: {repr(response)}')
    end_time = time.perf_counter()
    return end_time - start_time


@dataclass(frozen=True)
class _SimulationResult:
    mean_latency: timedelta
    median_latency: timedelta
    request_count: int
    error_count: int

    @classmethod
    def merge(cls, *results: _SimulationResult) -> _SimulationResult:
        return cls(
            mean_latency=sum((result.mean_latency for result in results), timedelta()) / len(results),
            median_latency=sorted((result.median_latency for result in results))[(len(results) - 1) // 2],
            request_count=sum(result.request_count for result in results),
            error_count=sum(result.error_count for result in results)
        )


async def _simulate_view_pan(
        session: ClientSession,
        base_url: str,
        start: datetime,
        view_size: timedelta,
        step_size: timedelta | None = None,
        steps=30,
        interval=timedelta(milliseconds=200)
) -> _SimulationResult:
    if step_size is None:
        step_size = view_size * 0.6
    measurements = deque()
    view_start = start
    for step in range(steps):
        measurement = _measure_request(
            lambda: _fetch_flux(session, base_url, view_start, view_start + view_size)
        )
        measurements.append(asyncio.create_task(measurement))
        if step == steps - 1:
            break
        view_start = view_start + step_size
        await asyncio.sleep(interval.total_seconds())
    measurements = await asyncio.gather(*measurements, return_exceptions=True)
    latencies = deque()
    for measurement in measurements:
        if isinstance(measurement, BaseException):
            _logger.error(
                f'Encountered exception during request:',
                exc_info=(type(measurement), measurement, measurement.__traceback__)
            )
            continue
        latencies.append(measurement)
    return _SimulationResult(
        mean_latency=timedelta(seconds=statistics.mean(latencies)),
        median_latency=timedelta(seconds=statistics.median(latencies)),
        request_count=len(measurements),
        error_count=len(measurements) - len(latencies)
    )


async def _simulate_viewer(
        base_url: str, flux_range: Range,
        seed: int | None = None,
        pans=10,
        pan_kwargs: dict | None = None
) -> _SimulationResult:
    if pan_kwargs is None:
        pan_kwargs = {}
    random = np.random.default_rng(seed=seed)
    range_size = flux_range[1] - flux_range[0]
    results = deque()
    async with ClientSession() as session:
        for _ in range(pans):
            view_size = range_size * min(random.lognormal() / 40, 1.5)
            pan_start = flux_range[0] + range_size * random.random() - view_size / 2
            results.append(await _simulate_view_pan(
                session, base_url, pan_start, view_size, **pan_kwargs
            ))
    return _SimulationResult.merge(*results)


async def _simulate_viewer_group(
        base_url: str, flux_range: Range,
        viewers=100,
        seed: int | None = None,
        viewer_kwargs: dict | None = None
) -> _SimulationResult:
    if viewer_kwargs is None:
        viewer_kwargs = {}
    results = await asyncio.gather(*(
        _simulate_viewer(
            base_url, flux_range,
            seed=None if seed is None else seed + i_viewer,
            **viewer_kwargs
        )
        for i_viewer in range(viewers)
    ))
    return _SimulationResult.merge(*results)


def _simulate_viewer_group_sync(*args, **kwargs) -> _SimulationResult:
    return asyncio.run(_simulate_viewer_group(*args, **kwargs))


def _simulate_viewer_groups(
        base_url: str, flux_range: Range,
        viewers=100,
        group_size=100,
        seed: int | None = None,
        viewer_kwargs: dict | None = None
) -> _SimulationResult:
    groups = math.ceil(viewers / group_size)
    with Pool(processes=groups) as pool:
        results = [
            pool.apply_async(_simulate_viewer_group_sync, (base_url, flux_range), {
                'viewers': min(viewers - group_size * i_group, group_size),
                'seed': None if seed is None else seed + i_group,
                'viewer_kwargs': viewer_kwargs
            })
            for i_group in range(groups)
        ]
        return _SimulationResult.merge(*(result.get() for result in results))


app = Typer()


@app.command()
def _benchmark(
        base_url: Annotated[str, Argument()] = 'http://localhost:8000',
        viewers: int = 50,
        seed: int = None
):
    asyncio.run(benchmark(base_url, viewers, seed))


async def benchmark(base_url: str, viewers: int, seed: int | None):
    if base_url.endswith('/'):
        base_url = base_url[:-1]
    _logger.info(f'Benchmarking {base_url}')
    async with ClientSession() as session:
        flux_range = await _fetch_flux_range_definitive(session, base_url)
    _logger.info(f'Simulating {viewers} constantly panning users.')
    start_time = datetime.now()
    result = _simulate_viewer_groups(
        base_url,
        flux_range,
        viewers=viewers,
        seed=seed
    )
    end_time = datetime.now()
    simulation_duration = end_time - start_time

    _logger.info(f'Benchmark took {simulation_duration}.')
    _logger.info(f'Mean latency was {result.mean_latency.total_seconds() * 1000:.3f}ms.')
    _logger.info(f'Median latency was {result.median_latency.total_seconds() * 1000:.3f}ms.')
    _logger.info(f'Encountered {result.error_count} errors.')
    _logger.info(f'Made {result.request_count} requests.')
    # Normal user makes ~1 request per second
    normal_viewers = result.request_count / simulation_duration.total_seconds()
    _logger.info(f'Equivalent to ~{normal_viewers:.1f} users.')


if __name__ == "__main__":
    configure_logging()
    app()
