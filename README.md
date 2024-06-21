# Heliotime

<!-- TODO: add getting started, deploy, etc.-->

Start database:

```sh
./du.sh dev db:deploy
```

> **Docker Utility** <br>
> `du.sh` is an alias to `docker compose` which loads the right compose files depending on the selected environment:
> development `dev` or production `prod`. Only production requires certain environment variables to be set.
> See [Configuration](#configuration) for available options.

## Configuration

The server, database, and site can be configured using the following environment variables:

| <div style="width:150px">Name</div> | Dev Default | Prod Default | Description                                 |
| :---------------------------------: | :---------: | :----------: | :------------------------------------------ |
|      `EXTERNAL_DATABASE_PORT`       |   `5432`    |     same     | Post the database will be exposed at.       |
|         `DATABASE_DATABASE`         | `postgres`  |     same     | Name of the database to use.                |
|         `DATABASE_USERNAME`         | `postgres`  |     same     | Username to authenticate with the database. |
|         `DATABASE_PASSWORD`         | `heliotime` |      -       | Password to authenticate with the database. |
