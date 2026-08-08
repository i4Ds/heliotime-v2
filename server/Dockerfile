FROM mambaorg/micromamba:alpine3.22

COPY conda-lock.yml ./
# Ensure the active arch's packages are present (lockfile covers linux-64 + linux-aarch64).
RUN micromamba install --yes --name base --file conda-lock.yml && \
    micromamba clean --all --yes && \
    micromamba run -n base python -c "import fastapi, starlette; print(fastapi.__version__, starlette.__version__)"

COPY data ./data
COPY importer ./importer
COPY migrations ./migrations
COPY utils ./utils
COPY alembic.ini ./
COPY config.py ./
COPY import.py ./
COPY logging.ini ./
COPY main.py ./

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["/usr/local/bin/_entrypoint.sh", "python"]
CMD ["-m", "fastapi_cli", "run", "./main.py"]
