import asyncio
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
from data.flux.source import FluxSource
from data.flux.spec import Flux
from data.flux.access import import_flux, fetch_last_flux_timestamp, fetch_flux
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

    async def _import(self, flux: Flux):
        """
        Cleans the provided flux and imports it into the database.
        Takes care of loading and/or recleaning the bordering data.
        """
        if len(flux) == 0:
            return
        self._logger.info(f'Importing {len(flux)} entries from {flux.index[0]} to {flux.index[-1]}')

        # We need to reclean the bordering data because of how clean_flux works
        reclean_start = flux.index[0] - CLEAN_BORDER_SIZE
        reclean_end = flux.index[-1] + CLEAN_BORDER_SIZE
        flux_start = await fetch_flux(
            self._connection, self.source, timedelta(),
            reclean_start - CLEAN_BORDER_SIZE, flux.index[0]
        )
        flux_end = await fetch_flux(
            self._connection, self.source, timedelta(),
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
        cleaned = clean_flux(
            flux_all, is_live=self.source == FluxSource.LIVE
        )[reclean_start:reclean_end]

        # Import the cleaned data
        await import_flux(self._connection, self.source, cleaned)

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
