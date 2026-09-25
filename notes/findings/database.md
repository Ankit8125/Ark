# Database findings

Recorded 2026-09-25. [Findings index](README.md)

## F003 - Windows database port mapping is 5434 -> 5432

Evidence: Compose and the running container bind `127.0.0.1:5434:5432`. PostgreSQL remains on 5432 inside its container. The original host port 5433 failed with an access-permission bind error; the root cause may involve Windows reservations or another process, but it was not established.

The ignored local `DATABASE_URL` still used 5433 after the Compose edit. It was corrected to 5434 without changing the password. Keep Compose, `.env.example`, the local environment, setup helper, and instructions aligned if the host port changes again.

Verified: healthy PostgreSQL 17.11, successful in-container SQL query, reachable host TCP port. Not verified by those checks: a future API connecting with `DATABASE_URL`. The in-container local socket can use different authentication from host TCP access.


## F004 - Database data and local credentials have separate lifecycles

PostgreSQL data resides in the Docker named volume `ark-local_postgres_data`. The `.env` file is ignored and local. `setup:env` creates it only when absent and does not print secrets.

Changing an environment variable does not change the password of an already initialized PostgreSQL role. Preserve the matching `.env` and volume; do not delete/recreate the volume to fix a connection error. Use an explicit password-rotation procedure when necessary. Routine shutdown uses `db:stop`.

The current `POSTGRES_USER` is the local development bootstrap role. It is not yet a designed least-privilege application/migration role split. Implement that database access design before representing the API as hardened.
