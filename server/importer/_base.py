import asyncio
import logging
import time
from abc import ABC, abstractmethod
from datetime import timedelta, datetime
from multiprocessing import Process
from typing import Callable, Coroutine, Any

from asyncpg import Connection

from config import IMPORT_START
from data.flux import Flux, import_flux, fetch_last_flux_timestamp, FluxSource
from utils.logging import configure_logging

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

    async def _import(self, flux: Flux):
        if len(flux) == 0:
            return
        self._logger.info(f'Importing {len(flux)} entries from {flux.index[0]} to {flux.index[-1]}')
        await import_flux(self._connection, self.source, flux)

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
            wait_delta = await self._import_from(start)
            self._logger.info(f'Finished import. Next import in {wait_delta}')
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
        except BaseException as e:  # noqa
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
