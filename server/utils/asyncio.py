import asyncio
from asyncio import Future
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures.process import ProcessPoolExecutor
from typing import Callable, Any, TypeVar

_TReturn = TypeVar('_TReturn')


def run_in_executor(
        executor: ThreadPoolExecutor | ProcessPoolExecutor, function: Callable[..., _TReturn], *args: Any
) -> Future[_TReturn]:
    return asyncio.get_event_loop().run_in_executor(executor, function, *args)
