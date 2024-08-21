import asyncio
import logging
import math
from collections import deque
from datetime import datetime, timedelta
from multiprocessing import Pool
from typing import Annotated, Awaitable, Callable, Collection

import numpy as np
from aiohttp import ClientSession, ClientResponse
from typer import Typer, Argument

from config import FLUX_MAX_RESOLUTION
from utils.logging import configure_logging

_logger = logging.getLogger(f'benchmarker')
Range = tuple[datetime, datetime]


async def _fetch_flux_range(session: ClientSession) -> Range | None:
    response = await session.get('/status')
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
        tries=10,
        wait=timedelta(seconds=5)
) -> Range:
    for _ in range(tries):
        flux_range = await _fetch_flux_range(session)
        if flux_range is not None:
            return flux_range
        _logger.warning(f'Benchmark target is initializing or has not data. Retrying in {wait}')
        await asyncio.sleep(wait.total_seconds())
    _logger.error(f'Benchmark target still not ready. Giving up.')
    raise ValueError('Benchmark target did not become ready.')


async def _fetch_flux(session: ClientSession, start: datetime, end: datetime) -> ClientResponse:
    return await session.get('/flux', params={
        'resolution': FLUX_MAX_RESOLUTION,
        'start': start.isoformat(),
        'end': end.isoformat()
    })


async def _measure_request(request: Callable[[], Awaitable[ClientResponse]]) -> timedelta:
    start_time = datetime.now()
    response = await request()
    if not response.ok:
        raise ValueError(f'Received error response {response.status}: {repr(response)}')
    end_time = datetime.now()
    return end_time - start_time


def _mean_timedelta(deltas: Collection[timedelta]) -> timedelta:
    return sum(deltas, timedelta()) / len(deltas)


async def _simulate_view_pan(
        session: ClientSession,
        start: datetime,
        view_size: timedelta,
        step_size: timedelta | None = None,
        steps=30,
        interval=timedelta(milliseconds=200)
) -> tuple[timedelta, int]:
    if step_size is None:
        step_size = view_size * 0.6
        measurements = deque()
        view_start = start
        for step in range(steps):
            view_end = view_start + step_size
            measurement = _measure_request(
                lambda: _fetch_flux(session, view_start, view_end)
            )
            measurements.append(asyncio.create_task(measurement))
            if step == steps - 1:
                break
            view_start = view_end
            await asyncio.sleep(interval.total_seconds())
        measurements = await asyncio.gather(*measurements, return_exceptions=True)
        latencies = deque()
        for measurement in measurements:
            if not isinstance(measurement, timedelta):
                _logger.error(
                    f'Encountered exception during request:',
                    exc_info=(type(measurement), measurement, measurement.__traceback__)
                )
                continue
            latencies.append(measurement)
        return _mean_timedelta(latencies), len(measurements) - len(latencies)


async def _simulate_viewer(
        base_url: str, flux_range: Range,
        seed: int | None = None,
        pans=10,
        pan_kwargs: dict | None = None
) -> tuple[timedelta, int]:
    if pan_kwargs is None:
        pan_kwargs = {}
    random = np.random.default_rng(seed=seed)
    range_size = flux_range[1] - flux_range[0]
    error_count = 0
    latencies = deque()
    async with ClientSession(base_url) as session:
        for _ in range(pans):
            pan_start = flux_range[0] + range_size * random.random()
            view_size = range_size * min(random.lognormal() / 40, 1.5)
            latency, pan_error_count = await _simulate_view_pan(
                session, pan_start, view_size, **pan_kwargs
            )
            latencies.append(latency)
            error_count += pan_error_count
    return _mean_timedelta(latencies), error_count


async def _simulate_viewer_group(
        base_url: str, flux_range: Range,
        viewers=100,
        seed: int | None = None,
        viewer_kwargs: dict | None = None
) -> tuple[timedelta, int]:
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
    latencies, error_counts = zip(*results)
    return _mean_timedelta(latencies), sum(error_counts)


def _simulate_viewer_group_sync(*args, **kwargs) -> tuple[timedelta, int]:
    return asyncio.run(_simulate_viewer_group(*args, **kwargs))


def _simulate_viewer_groups(
        base_url: str, flux_range: Range,
        viewers=100,
        group_size=100,
        seed: int | None = None,
        viewer_kwargs: dict | None = None
) -> tuple[timedelta, int]:
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
        latencies, error_counts = zip(*(result.get() for result in results))
    return _mean_timedelta(latencies), sum(error_counts)


app = Typer()


@app.command()
def _benchmark(
        base_url: Annotated[str, Argument()] = 'http://localhost:8000',
        viewers: int = 200,
        seed: int = None
):
    asyncio.run(benchmark(base_url, viewers, seed))


async def benchmark(base_url: str, viewers: int, seed: int | None):
    _logger.info(f'Benchmarking {base_url}')
    async with ClientSession(base_url) as session:
        flux_range = await _fetch_flux_range_definitive(session)
    _logger.info(f'Simulating {viewers} constantly panning users.')
    latency, error_count = _simulate_viewer_groups(
        base_url,
        flux_range,
        viewers=viewers,
        seed=seed
    )
    _logger.info(f'Average latency was {latency.total_seconds() * 1000:.3f}ms.')
    _logger.info(f'Encountered {error_count} errors.')


if __name__ == "__main__":
    configure_logging()
    app()
