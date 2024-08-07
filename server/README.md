# Heliotime Server

The server providing flux data to the Heliotime interface via an HTTP API. Downloads the data with [SunPy](https://docs.sunpy.org/en/stable/generated/gallery/time_series/goes_xrs_example.html) from NOAA sources, removes artifacts and stores it into the [TimescaleDB](https://www.timescale.com/) (PostgreSQL) for fast retrieval.

## Getting started

Ensure you have Conda or a compatible tool installed ([Micromamba](https://mamba.readthedocs.io/en/latest/user_guide/micromamba.html) recommended) and the database is running:

```sh
# Run in repository root (../)
./du.sh dev deploy db
```

First, create the environment from the lock file:

```sh
micromamba create --file conda-lock.yml --name heliotime-server
```

Then, activate it:

```sh
micromamba activate heliotime-server
```

Finally, start the server:

```sh
fastapi dev main.py
```

And try some API calls:

- <http://localhost:8000/status>
- <http://localhost:8000/flux?resolution=100>
- <http://localhost:8000/docs>

Some responses might be empty at first because no data has been imported yet.

> **Micromamba & PyCharm** <br>
> PyCharm currently [does not support Mamba](https://youtrack.jetbrains.com/issue/PY-58703/Setting-interpreter-to-mamba-causes-PyCharm-to-stop-accepting-run-configurations). As a workaround, install and use Conda in PyCharm but point it to the same environment:
>
> ```sh
> micromamba install conda-forge::conda
> ```
>
> PyCharm will be happy and you can keep using any other tool to manage the environment.

## Various commands

Update the lock file (from `environment.yml`):

```bash
conda-lock --micromamba
```

Create a new database revision:

```sh
alembic revision -m '<name in form of: verb noun>'
```

Apply database migrations:

```sh
alembic upgrade head
```