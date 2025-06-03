import asyncio
import logging
import time
from abc import ABC, abstractmethod
from datetime import timedelta, datetime
from multiprocessing import Process
from typing import Callable, Coroutine, Any

import asyncpg

from config import IMPORT_START
from data.flux.access import fetch_last_non_combined_flux_timestamp
from data.flux.spec.channel import FluxChannel
from data.flux.spec.data import Flux
from data.flux.spec.source import FluxSource
from utils.logging import configure_logging
from utils.range import DateTimeRange

_logger = logging.getLogger(f'importer')


def source_logger(source: FluxSource) -> logging.Logger:
    return _logger.getChild(source.name.lower())


def log_import(logger: logging.Logger, channels: dict[FluxChannel, tuple[Flux, DateTimeRange]]):
    if len(channels) == 0:
        logger.info('Not importing any channels')
        return
    entry_count = sum(len(flux) for flux, _ in channels.values())
    time_range = DateTimeRange.which_includes(list(r for _, r in channels.values()))
    logger.info(
        f'Importing {len(channels)} channels with {entry_count} entries for {time_range}'
    )


class Importer(ABC):
    source: FluxSource

    _logger: logging.Logger
    _connection: asyncpg.Pool

    def __init__(self, source: FluxSource, connection: asyncpg.Pool):
        self.source = source
        self._logger = source_logger(source)
        self._connection = connection

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
            last_timestamp = await fetch_last_non_combined_flux_timestamp(self._connection, self.source)
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
    logger = source_logger(source)
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
            args=(source, start)
        )
