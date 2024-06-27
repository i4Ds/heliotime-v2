FROM mambaorg/micromamba:alpine3.17

COPY conda-lock.yml ./
RUN micromamba install --yes --name base --file conda-lock.yml && \
    micromamba clean --all --yes

COPY data ./data
COPY importer ./importer
COPY migrations ./migrations
COPY alembic.ini ./
COPY config.py ./
COPY import.py ./
COPY main.py ./

ENV PYTHONUNBUFFERED=1
ENTRYPOINT ["/usr/local/bin/_entrypoint.sh", "python"]
CMD ["-m", "fastapi_cli", "run", "./main.py"]
