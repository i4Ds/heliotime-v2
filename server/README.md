# Heliotime Server

The server providing flux data to the Heliotime interface via an HTTP API. Downloads the data
with [SunPy](https://docs.sunpy.org/en/stable/generated/gallery/time_series/goes_xrs_example.html) from NOAA sources,
removes artifacts and stores it into the [TimescaleDB](https://www.timescale.com/) (PostgreSQL) for fast retrieval.

## Getting started

Ensure you have Conda or a compatible tool
installed ([Micromamba](https://mamba.readthedocs.io/en/latest/user_guide/micromamba.html) recommended) and the database
is running:

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
> PyCharm
>
currently [does not support Mamba](https://youtrack.jetbrains.com/issue/PY-58703/Setting-interpreter-to-mamba-causes-PyCharm-to-stop-accepting-run-configurations).
> As a workaround, install and use Conda in PyCharm but point it to the same environment:
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

## Database Structure

This sections gives a rough overview of the database structures without finer optimizations details like compression and
chunking.

Solar flux would ideally be a single-value timeseries. But, because there are multiple sources providing multiple
versions which get post-processed in multiple ways, a single measurement intervals actually has multiple values.
All these values (as of 2025 around 7 billion) need to be queryable in real-time in various resolutions without
taking too much processing power or storage space to provide a useful public webservice. 
This is why the database unfortunately cannot just be a single simple table.


### Tables and Views (Sources and Resolutions)

Data form each source is stored in a different table with precomputed aggregated views for various resolutions.

- **Data Tables** (`flux_<source>`)
    - `live`: Low-resolution real-time data (1m), delayed by a few minutes.
    - `archive`: High-resolution archive data (1–3s), delayed by a few days.
- **Aggregated Views** (`flux_<source>_<bucket>`):
    - Buckets: `10s`, `1m`, `10m`, `1h`, `12h`, `5d`
    - Aggregations: `flux_min`, `flux_max`, `count` (number of measurements in the bucket)

### Metadata Columns (Channel Attributes)

Each measurement variant is stored in a single row with the following metadata attributes:

- `satellite`: GOES ID 1–18 or combined (precomputed best signal selection)
- `band`: Short or long frequency band
- `is_clean`: Raw or post-processed data

One combination of these attributes make up a single channel with typically 12 available channels per measurement
interval (2 satellites + 1 combined x 2 frequency bands x 2 post-processing states).



 
