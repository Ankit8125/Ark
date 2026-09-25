# Local PostgreSQL and daily commands

Recorded 2026-09-25. [Learning index](README.md) | [Current progress](../progress/README.md)

## Understand the database container

[`infra/local/compose.yaml`](../../infra/local/compose.yaml) describes one service named `postgres`:

- `image: postgres:17` selects the PostgreSQL 17 image series. A fresh pull can select a newer 17.x patch; this tag is not a fixed image digest.
- `POSTGRES_USER: ark` and `POSTGRES_DB: ark_dev` configure the initial database user and database.
- `POSTGRES_PASSWORD` is read from your local environment file. Its actual value belongs outside committed notes and source code.
- The health check runs `pg_isready` inside the container.
- A named volume stores PostgreSQL's files at `/var/lib/postgresql/data`, the correct default data mount for this PostgreSQL 17 image.

The port mapping has three parts:

```text
127.0.0.1 : 5434 : 5432
   |         |      |
   |         |      +-- PostgreSQL port inside the container
   |         +--------- port you connect to from Windows
   +------------------- bind only to this computer's loopback interface
```

Changing `5433` to `5434` changed the Windows-side listening port. PostgreSQL still listens on `5432` inside the container. A future API running directly on Windows must connect to `127.0.0.1:5434`. If the API later runs as another service on the same Compose network, its database address would normally be `postgres:5432` instead.

The reported port error establishes that Docker could not bind `5433`. By itself, it does not establish whether Windows had reserved that port or some other condition prevented binding. Changing to an available port allowed this setup to proceed.

The follow-up review also found that the local database connection URL still referred to `5433` after Compose had changed to `5434`. The host-side URL must match `5434` as well. Aligning its port is a configuration correction; it does not require changing the existing username or password. The values themselves are intentionally absent from these notes.

The database credentials in an environment file must match the credentials that initialized the data volume. Changing a password variable later does not automatically change an existing database user's password.

### Three checks prove different things

1. A healthy container means its configured readiness probe succeeded.
2. `psql` run through `docker compose exec` can prove the database accepts an internal connection and can execute SQL. Without a host argument, it generally uses a local socket inside the container and may not need the password used by a Windows client.
3. A real database connection from Windows to `127.0.0.1:5434`, using the intended application credentials, proves the host port and those credentials together. The eventual API needs this check too.

Therefore, successful internal `SELECT version()` output does not by itself prove that a future API can connect or authenticate. A TCP port check proves reachability, but also does not validate a database password.


## Useful commands for the current starter

Run these in PowerShell from the repository root. They refer to the root `.env` file without printing its values. Start Docker Desktop before database commands.

Check the tools selected by your current terminal:

```powershell
node --version
pnpm.cmd --version
docker --version
docker compose version
```

Create local environment configuration on a new checkout, then start or inspect the configured database:

```powershell
pnpm.cmd setup:env
pnpm.cmd db:up
pnpm.cmd db:status
docker compose --env-file .env -f infra/local/compose.yaml exec postgres psql -U ark -d ark_dev -c "SELECT version();"
Test-NetConnection -ComputerName 127.0.0.1 -Port 5434
```

The SQL command checks the database internally. `Test-NetConnection` checks the Windows-side TCP endpoint. See the three-check distinction above before interpreting their results.

Run frontend checks and start development:

```powershell
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd dev
```

After a successful build, you can run `pnpm.cmd --dir apps/web preview` in a separate terminal to inspect the built frontend. Preview is a local build-checking server, not the planned production deployment.

Stop the database while retaining its data:

```powershell
pnpm.cmd db:stop
```

`docker compose down` removes the containers and network but normally retains the named volume. Adding `-v` removes that volume and its database data, so it is not a routine shutdown command.
