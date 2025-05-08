import logging
import logging.config
import timeit
from contextlib import contextmanager


def configure_logging():
    logging.config.fileConfig('logging.ini', disable_existing_loggers=False)


@contextmanager
def log_time(logger: logging.Logger, operation: str):
    start = timeit.default_timer()
    try:
        yield
    finally:
        end = timeit.default_timer()
        logger.debug(f'{operation} took {end - start:.2f}s')
