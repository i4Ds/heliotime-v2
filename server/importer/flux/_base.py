import asyncio
import dataclasses
import logging
import time
from abc import ABC, abstractmethod
from collections import deque
from datetime import timedelta, datetime
from multiprocessing import Process
from typing import Callable, Coroutine, Any

import pandas as pd
from asyncpg import Connection

from config import IMPORT_START
from data.flux.access import import_flux, fetch_last_flux_timestamp, fetch_flux, fetch_available_channels
from data.flux.spec.channel import FluxChannel, SATELLITE_COMBINED_ID
from data.flux.spec.data import Flux, empty_flux
from data.flux.spec.source import FluxSource
from utils.logging import configure_logging
from utils.range import DateTimeRange
from ._clean import CLEAN_BORDER_SIZE, clean_flux
from ._combine import COMBINE_BORDER_SIZE, combine_flux_channels

_logger = logging.getLogger(f'importer')


def _source_logger(source: FluxSource) -> logging.Logger:
    return _logger.getChild(source.name.lower())


class Importer(ABC):
    source: FluxSource

    _logger: logging.Logger
    _connection: Connection

    def __init__(self, source: FluxSource, connection: Connection):
        self.source = source
        self._logger = _source_logger(source)
        self._connection = connection

    async def _extend_flux(
            self, channel: FluxChannel, flux: Flux,
            original_range: DateTimeRange, target_range: DateTimeRange
    ) -> Flux:
        """
        Extends the provided flux to the target range by loading the missing data from the database.

        :param original_range: Range of the provided flux.
        :param target_range: Range to extend to.
        """
        sections = deque((flux,))
        if target_range.start < original_range.start:
            sections.appendleft(await fetch_flux(
                self._connection, self.source, channel, timedelta(),
                target_range.start, original_range.start
            ))
        if target_range.end > original_range.end:
            sections.append(await fetch_flux(
                self._connection, self.source, channel, timedelta(),
                original_range.end, target_range.end
            ))
        sections = [section for section in sections if len(section) > 0]
        if len(sections) == 0:
            return empty_flux()
        if len(sections) == 1:
            return sections[0]
        return pd.concat(sections)

    async def _clean(self, channel: FluxChannel, flux: Flux, time_range: DateTimeRange) -> tuple[Flux, DateTimeRange]:
        """

        Cleans the provided flux and the bordering sections.

        :return: The cleaned flux and the new time range of the cleaned flux.
        """
        if channel.is_clean:
            raise ValueError('Cannot clean already cleaned flux.')
        reclean_range = time_range.extend(CLEAN_BORDER_SIZE)
        fetch_range = reclean_range.extend(CLEAN_BORDER_SIZE)
        flux_all = await self._extend_flux(channel, flux, time_range, fetch_range)
        # Clean and throw away the bordering data
        return clean_flux(flux_all, fetch_range)[reclean_range.start:reclean_range.end], reclean_range

    async def _combine(
            self, channels: dict[FluxChannel, tuple[Flux, DateTimeRange]]
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
            input_channels[channel] = await self._extend_flux(channel, flux, time_range, fetch_range)

        # Load missing channels
        stored_channels = await fetch_available_channels(self._connection, self.source, recombine_range)
        for channel in stored_channels:
            if channel.satellite == SATELLITE_COMBINED_ID or channel in input_channels:
                continue
            input_channels[channel] = await fetch_flux(
                self._connection, self.source, channel, timedelta(), fetch_range.start, fetch_range.end
            )

        # Combine the channels
        combined_channels = combine_flux_channels(input_channels, fetch_range)
        return {
            channel: (combined_channels[channel][recombine_range.start:recombine_range.end], recombine_range)
            for channel in combined_channels
        }

    async def _import(self, channels: dict[FluxChannel, Flux], time_range: DateTimeRange):
        """
        Imports the provided flux and if not present, creates the cleaned and combined versions.
        All channels must cover the same time range.
        """
        if len(channels) == 0:
            return

        # Set time range per channel as some will be extended
        channels = {
            channel: (flux, time_range)
            for channel, flux in channels.items()
        }

        # Create cleaned versions if they do not exist
        existing_channels = list(channels.items())  # Cannot modify dict while iterating
        for channel, (flux, time_range) in existing_channels:
            cleaned_channel = dataclasses.replace(channel, is_clean=True)
            if cleaned_channel in channels:
                continue  # Skip if cleaned version already exists
            channels[cleaned_channel] = await self._clean(channel, flux, time_range)

        # Combine channels (if not already combined)
        channels = (await self._combine(channels)) | channels

        # Log final import information
        entry_count = sum(len(flux) for flux, _ in channels.values())
        self._logger.info(
            f'Importing {len(channels)} channels with {entry_count} entries '
            f'from {time_range.start} to {time_range.end}'
        )

        # Import the cleaned versions
        await import_flux(self._connection, self.source, channels)

    @abstractmethod
    async def _import_from(self, start: datetime) -> timedelta:
        """
        Imports all available data from the provided start data and
        using the self._import() method. It must import the entries sequentially
        from the past to the present to avoid holes if the process gets interrupted.

        :param start: Datetime to import from.
        :return: The timedelta to wait before calling this method again.
        """
        raise NotImplementedError()

    async def start_import(self):
        while True:
            last_timestamp = await fetch_last_flux_timestamp(self._connection, self.source)
            start = IMPORT_START if last_timestamp is None else \
                last_timestamp + timedelta(milliseconds=1)
            self._logger.info(f'Start import from {start}')
            start_time = time.perf_counter()
            wait_delta = await self._import_from(start)
            elapsed_seconds = time.perf_counter() - start_time
            self._logger.info(
                f'Finished import in {timedelta(seconds=elapsed_seconds)}. '
                f'Next import in {wait_delta}'
            )
            await asyncio.sleep(wait_delta.total_seconds())


_RESTART_DELAY = timedelta(minutes=1)

ImportStarter = Callable[[], Coroutine[Any, Any, Any]]


def _start_async(source: FluxSource, start: ImportStarter):
    """
    Must be a module level function to be usable as process target.
    """
    configure_logging()
    logger = _source_logger(source)
    while True:
        try:
            asyncio.run(start())
        except KeyboardInterrupt as e:
            raise e
        except:  # noqa
            logger.exception(f"Encountered unexpected exception. Restarting importer in {_RESTART_DELAY}.")
            time.sleep(_RESTART_DELAY.total_seconds())


_PROCESS_NAMES = {
    FluxSource.ARCHIVE: 'Archive',
    FluxSource.LIVE: 'Live'
}


class ImporterProcess(Process, ABC):
    def __init__(self, source: FluxSource, start: ImportStarter):
        super().__init__(
            name=f'Heliotime {_PROCESS_NAMES[source]} Importer',
            target=_start_async,
            args=(source, start),
            daemon=True
        )
