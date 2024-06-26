import asyncio
from abc import ABC, abstractmethod
from datetime import timedelta, datetime
from multiprocessing import Process
from typing import Awaitable, Callable, Coroutine, Any

from asyncpg import Connection

from config import IMPORT_START
from data.flux import Flux, import_flux, fetch_last_flux_timestamp, FluxSource


class Importer(ABC):
    source: FluxSource

    _connection: Connection

    def __init__(self, source: FluxSource, connection: Connection):
        self.source = source
        self._connection = connection

    def _import(self, flux: Flux) -> Awaitable:
        return import_flux(self._connection, self.source, flux)

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
            wait_delta = await self._import_from(
                IMPORT_START if last_timestamp is None else
                last_timestamp + timedelta(milliseconds=1)
            )
            await asyncio.sleep(wait_delta.total_seconds())


ImportStarter = Callable[[], Coroutine[Any, Any, Any]]


def _start_async(start: ImportStarter):
    """
    Must be a module level function to be usable as process target.
    """
    asyncio.run(start())


_PROCESS_NAMES = {
    FluxSource.ARCHIVE: 'Archive',
    FluxSource.LIVE: 'Live'
}


class ImporterProcess(Process, ABC):
    def __init__(self, source: FluxSource, start: ImportStarter):
        super().__init__(
            name=f'Heliotime {_PROCESS_NAMES[source]} Importer',
            target=_start_async,
            args=(start,),
            daemon=True
        )
