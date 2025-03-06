import asyncio
import dataclasses
import logging
import time
import warnings
from abc import ABC, abstractmethod
from datetime import timedelta, datetime
from multiprocessing import Process
from typing import Callable, Coroutine, Any

import pandas as pd
from asyncpg import Connection

from config import IMPORT_START
from data.flux.access import import_flux, fetch_last_flux_timestamp, fetch_flux
from data.flux.spec.channel import FluxChannel
from data.flux.spec.data import Flux, empty_flux
from data.flux.spec.source import FluxSource
from utils.logging import configure_logging
from ._clean import CLEAN_BORDER_SIZE, clean_flux

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

    async def _clean(self, channel: FluxChannel, flux: Flux) -> Flux:
        """
        Cleans the provided flux.
        Takes care of loading and/or recleaning the bordering data.
        """
        if channel.is_clean:
            raise ValueError('Cannot clean already cleaned flux.')
        if len(flux) == 0:
            return empty_flux()

        # We need to reclean the bordering data because of how clean_flux works
        reclean_start = flux.index[0] - CLEAN_BORDER_SIZE
        reclean_end = flux.index[-1] + CLEAN_BORDER_SIZE
        flux_start = await fetch_flux(
            self._connection, self.source, channel, timedelta(),
            reclean_start - CLEAN_BORDER_SIZE, flux.index[0]
        )
        flux_end = await fetch_flux(
            self._connection, self.source, channel, timedelta(),
            flux.index[-1], reclean_end + CLEAN_BORDER_SIZE
        )
        with warnings.catch_warnings():
            warnings.filterwarnings(
                'ignore',
                message='The behavior of array concatenation with empty entries is deprecated. '
                        'In a future version, this will no longer exclude empty items when determining '
                        'the result dtype. To retain the old behavior, exclude the empty entries '
                        'before the concat operation.'
            )
            flux_all = pd.concat([flux_start, flux, flux_end])

        # Clean and throw away the bordering data
        return clean_flux(flux_all)[reclean_start:reclean_end]

    async def _import(self, channels: dict[FluxChannel, Flux]):
        """
        Imports the provided flux and if not present, creates the cleaned version.

        TODO: implement updating the combined channels
        """
        if len(channels) == 0:
            return

        # Create cleaned versions if they do not exist
        existing_channels = list(channels.items())  # Cannot modify dict while iterating
        for channel, flux in existing_channels:
            cleaned_channel = dataclasses.replace(channel, is_clean=True)
            if cleaned_channel in channels:
                continue  # Skip if cleaned version already exists
            channels[cleaned_channel] = await self._clean(channel, flux)

        # Clean empty channels
        # TODO: define the provided time range, so we can also overwrite with "nothing"
        #   aka deleting the existing erroneous entries.
        channels = {
            channel: flux
            for channel, flux in channels.items()
            if len(flux) > 0
        }
        if len(channels) == 0:
            return

        # Log final import information
        entry_count = sum(len(flux) for flux in channels.values())
        start = min(flux.index[0] for flux in channels.values())
        end = max(flux.index[-1] for flux in channels.values())
        self._logger.info(
            f'Importing {len(channels)} channels with {entry_count} entries from {start} to {end}'
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
