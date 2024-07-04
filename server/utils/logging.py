import logging
import logging.config


def configure_logging():
    logging.config.fileConfig('logging.ini', disable_existing_loggers=False)
