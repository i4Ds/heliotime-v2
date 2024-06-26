import asyncio

from typer import Typer

from importer.archive import start_archive_import
from importer.live import start_live_import

app = Typer()


@app.command('archive')
def _start_archive_import():
    asyncio.run(start_archive_import())


@app.command('live')
def _start_live_import():
    asyncio.run(start_live_import())


if __name__ == "__main__":
    app()
