# Database findings

Updated 2026-09-26. [Findings index](README.md)

## F003 - Host port and authenticated access

Compose binds 127.0.0.1:5434 to container port 5432. The original host port 5433 failed with a Windows bind-permission error; the exact cause was not established. The old local connection URL was aligned to 5434 without changing its password.

Bootstrap verified healthy PostgreSQL 17.11, internal SQL, and host TCP reachability. The identity increment additionally verified a host connection as restricted role `ark_app`. Internal socket success alone would not prove host authentication.

## F004 - Data, roles, and credentials have separate lifecycles

The Docker volume `ark-local_postgres_data` persists database files. Ignored `.env` retains matching credentials. Changing a password variable does not change an initialized database role. Never remove the volume to repair a connection mismatch. Routine shutdown is `pnpm.cmd db:stop`.

The Compose `ark` user remains the local administrator. `MIGRATION_DATABASE_URL` serves explicit migrations/provisioning; the API's `DATABASE_URL` uses `ark_app`. It is non-superuser, cannot create databases/roles or bypass RLS, and receives explicit table privileges. It can read/insert audit events but cannot update/delete them or create tables. This does not replace API authorization or implement row-level security.

## F008 - Migrations and tests have explicit boundaries

`001_identity.sql` is applied to `ark_dev`. Add later migration files and register their versions instead of editing this one. The runner serializes migration writers, checks stored checksums, and rolls back on failure. Server startup never migrates.

Tests require local `ark_test` and generate unique `ark_test_<hex>` schemas. Cleanup validates database and schema names. Real development setup remains pending; browser accounts are disposable fixtures. Unexpectedly killed tests can leave their own schema behind; inspect and target only those schemas. There is no database-wide reset command.

The architecture review hardened helper/fixture URL validation against driver query overrides and made failed rollback discard the connection while preserving the original exception. See [resolved findings](architecture-review.md). No applied SQL migration or database role changed in that review.
