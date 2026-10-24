# Database findings

Updated 2026-10-24. [Findings index](README.md)

## F003 - Host port and authenticated access

Compose binds 127.0.0.1:5434 to container port 5432. The original host port 5433 failed with a Windows bind-permission error; the exact cause was not established. The old local connection URL was aligned to 5434 without changing its password.

Bootstrap verified healthy PostgreSQL 17.11, internal SQL, and host TCP reachability. The identity increment additionally verified a host connection as restricted role `ark_app`. Internal socket success alone would not prove host authentication.

## F004 - Data, roles, and credentials have separate lifecycles

The Docker volume `ark-local_postgres_data` persists database files. Ignored `.env` retains matching credentials. Changing a password variable does not change an initialized database role. Never remove the volume to repair a connection mismatch. Routine shutdown is `pnpm.cmd db:stop`.

The Compose `ark` user remains the local administrator. `MIGRATION_DATABASE_URL` serves explicit migrations/provisioning; the API's `DATABASE_URL` uses `ark_app`. It is non-superuser, cannot create databases/roles or bypass RLS, and receives explicit table privileges. It can read/insert audit events but cannot update/delete them or create tables. This does not replace API authorization or implement row-level security.

## F008 - Migrations and tests have explicit boundaries

The October 20 compute-control preparation verified migrations `001_identity.sql` through `007_runner_compute_controls.sql` applied to `ark_dev`. Add later migration files and register their versions instead of editing applied SQL. The runner serializes migration writers, checks stored checksums, and rolls back on failure. Server startup never migrates. The [Workspace increment](workspaces.md) adds resources and insert/read-only snapshots; `pnpm.cmd db:prepare` configures their runtime privileges explicitly. The [Agent](agents.md) and [Flow](flows.md) increments expand the kind constraint and reuse those same privileges. The [archive migration](catalog-archive.md) adds `archived_at`, a separate `lifecycle_revision` counter, and a status-list index without changing immutable snapshots or runtime grants.

The final 2026-10-01 check connected as `ark_app` to `ark_dev`, found four migrations, zero users, and zero Workspaces, Agents, or Flows. Thus first-owner setup was still available at that verification; this is a dated observation, not a guarantee that later user activity leaves the database empty.

The 2026-10-04 development check verified migration 005 applied and the runtime connection using `ark_app`. Users, resources, and versions remained at zero, matching the pre-upgrade baseline with four migrations. This records the checked upgrade result; it does not imply that later user activity leaves the database empty.

The 2026-10-13 template increment required no migration or grant change. Read-only development counts before and after verification matched: `ark_app`, five migrations, zero users/resources/versions. The previous empty template schema and fresh fictional browser fixture were individually verified and removed from `ark_test`; the development database and persistent volume were preserved. This remains a dated observation, not a promise about later user activity.

The 2026-10-20 runner checkpoint verified migration 006 and restricted runtime runner privileges. The subsequent compute-control preparation applied additive migration 007: existing users/resources/versions/runners counts stayed at zero while the migration count advanced from six to seven. The runtime remained `ark_app` without superuser, database/role creation, or RLS bypass privileges. `runner_use_grants` allows SELECT/INSERT/UPDATE and denies DELETE. The October 24 recheck confirmed seven migrations, those same zero counts, and restricted privileges. Focused tests and real owner/developer browser acceptance are recorded in the [compute-control checkpoint](../progress/2026-10-24-01-compute-controls.md). Its generated schema `ark_test_a1ba60d043f3362aeeb0` was removed and verification ports 3002/3003/5184 were closed; development data and volumes were preserved. These are dated observations, not a guarantee about later user activity.

Tests require local `ark_test` and generate unique `ark_test_<hex>` schemas. Cleanup validates database and schema names. Real development setup remains pending; browser accounts are disposable fixtures. Unexpectedly killed tests can leave their own schema behind; inspect and target only those schemas. There is no database-wide reset command.

The architecture review hardened helper/fixture URL validation against driver query overrides and made failed rollback discard the connection while preserving the original exception. See [resolved findings](architecture-review.md). No applied SQL migration or database role changed in that review.
