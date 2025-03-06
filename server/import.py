import asyncio

from typer import Typer

from data.db import apply_db_migrations
from importer.flux.archive import start_archive_import, ArchiveImporterProcess
from importer.flux.live import start_live_import, LiveImporterProcess
from utils.logging import configure_logging

app = Typer()

_skip_migration = False


@app.callback()
def _callback(skip_migrations: bool = False):
    global _skip_migration
    _skip_migration = skip_migrations


@app.command('archive')
def _start_archive_import():
    if not _skip_migration:
        apply_db_migrations()
    asyncio.run(start_archive_import())


@app.command('live')
def _start_live_import():
    if not _skip_migration:
        apply_db_migrations()
    asyncio.run(start_live_import())


@app.command('all')
def _start_import():
    if not _skip_migration:
        apply_db_migrations()
    archive_importer = ArchiveImporterProcess()
    live_importer = LiveImporterProcess()
    archive_importer.start()
    live_importer.start()
    archive_importer.join()
    live_importer.join()


if __name__ == "__main__":
    configure_logging()
    app()
