import asyncio
import dataclasses
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta

import asyncpg
import pandas as pd

from data.flux.access import fetch_flux, fetch_available_channels
from data.flux.spec.channel import FluxChannel, SATELLITE_COMBINED_ID
from data.flux.spec.data import Flux, empty_flux
from data.flux.spec.source import FluxSource
from utils.asyncio import run_in_executor
from utils.range import DateTimeRange
from ._clean import CLEAN_BORDER_SIZE, clean_flux
from ._combine import COMBINE_BORDER_SIZE, combine_flux_channels


async def _extend_flux(
        pool: asyncpg.Pool, source: FluxSource, channel: FluxChannel,
        flux: Flux, original_range: DateTimeRange, target_range: DateTimeRange
) -> Flux:
    """
    Extends the provided flux to the target range by loading the missing data from the database.

    :param original_range: Range of the provided flux.
    :param target_range: Range to extend to.
    """
    sections = deque((flux,))
    if target_range.start < original_range.start:
        sections.appendleft(await fetch_flux(
            pool, source, channel, timedelta(),
            target_range.start, original_range.start
        ))
    if target_range.end > original_range.end:
        sections.append(await fetch_flux(
            pool, source, channel, timedelta(),
            original_range.end, target_range.end
        ))
    sections = [section for section in sections if len(section) > 0]
    if len(sections) == 0:
        return empty_flux()
    if len(sections) == 1:
        return sections[0]
    return pd.concat(sections)


async def _clean(
        executor: ThreadPoolExecutor, pool: asyncpg.Pool,
        source: FluxSource, channel: FluxChannel,
        flux: Flux, time_range: DateTimeRange
) -> tuple[Flux, DateTimeRange]:
    """
    Cleans the provided flux and the bordering sections.

    :return: The cleaned flux and the new time range of the cleaned flux.
    """
    if channel.is_clean:
        raise ValueError('Cannot clean already cleaned flux.')
    reclean_range = time_range.extend(CLEAN_BORDER_SIZE)
    fetch_range = reclean_range.extend(CLEAN_BORDER_SIZE)
    flux_all = await _extend_flux(pool, source, channel, flux, time_range, fetch_range)
    flux_clean = await run_in_executor(executor, clean_flux, flux_all, fetch_range)
    # Clean and throw away the bordering data
    return flux_clean[reclean_range.start:reclean_range.end], reclean_range


async def _combine(
        executor: ThreadPoolExecutor, pool: asyncpg.Pool,
        source: FluxSource, channels: dict[FluxChannel, tuple[Flux, DateTimeRange]]
) -> dict[FluxChannel, tuple[Flux, DateTimeRange]]:
    """
    Combines the provided flux channels and the bordering sections.

    :return: The combined channels and the new time range of the combined channels.
    """
    provided_range = DateTimeRange(
        min(time_range.start for _, time_range in channels.values()),
        max(time_range.end for _, time_range in channels.values())
    )
    recombine_range = provided_range.extend(COMBINE_BORDER_SIZE)
    fetch_range = recombine_range.extend(COMBINE_BORDER_SIZE)

    # Extend provided channels to the fetch range
    input_channels = {}
    for channel, (flux, time_range) in channels.items():
        if channel.satellite == SATELLITE_COMBINED_ID:
            continue
        input_channels[channel] = await _extend_flux(pool, source, channel, flux, time_range, fetch_range)

    # Load missing channels
    stored_channels = await fetch_available_channels(pool, source, recombine_range)
    for channel in stored_channels:
        if channel.satellite == SATELLITE_COMBINED_ID or channel in input_channels:
            continue
        input_channels[channel] = await fetch_flux(
            pool, source, channel, timedelta(), fetch_range.start, fetch_range.end
        )

    # Combine the channels
    combined_channels = combine_flux_channels(input_channels, fetch_range, executor)
    return {
        channel: (combined_channels[channel][recombine_range.start:recombine_range.end], recombine_range)
        for channel in combined_channels
    }


async def prepare_flux_channels(
        executor: ThreadPoolExecutor, pool: asyncpg.Pool,
        source: FluxSource, channels: dict[FluxChannel, Flux], time_range: DateTimeRange
) -> dict[FluxChannel, tuple[Flux, DateTimeRange]]:
    """
    Prepares the provided flux channels for import by cleaning and combining them using multithreading.

    :return: All channels that are should be imported.
    """
    if len(channels) == 0:
        return {}

    # Set time range per channel as some will be extended
    channels = {
        channel: (flux, time_range)
        for channel, flux in channels.items()
    }

    # Clean channels
    clean_tasks = deque()
    for channel, (flux, channel_time_range) in channels.items():
        cleaned_channel = dataclasses.replace(channel, is_clean=True)
        if cleaned_channel in channels:
            continue  # Skip if cleaned version already exists
        clean_tasks.append((
            cleaned_channel,
            asyncio.create_task(_clean(
                executor, pool, source,
                channel, flux, channel_time_range
            ))
        ))
    try:
        for cleaned_channel, task in clean_tasks:
            channels[cleaned_channel] = await task
    except:  # noqa
        for _, task in clean_tasks:
            task.cancel()
        raise

    # Combine channels (if not already combined)
    channels.update(await _combine(executor, pool, source, channels))
    return channels
