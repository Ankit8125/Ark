# Findings and decisions

Recorded: 2026-09-25. Facts below distinguish verified implementation from intended design.

## F001 - The application is still a frontend starter

Evidence: `apps/web/src/App.tsx` is the generated counter/links page. `apps/web/src/main.tsx` mounts it in React StrictMode. The current UI does not call a backend or access PostgreSQL. There are no API, engine, runner, migration, or shared-contract packages yet.

Consequence: a successful frontend build is not proof that setup/login, permissions, tasks, or sessions work. V0.1 remains incomplete.

## F002 - Declared ranges and installed versions differ

The manifest records permitted ranges; `pnpm-lock.yaml` records resolved dependency versions. Direct inspection of the installed packages on this date found:

| Dependency | Manifest declaration | Resolved locally |
| --- | --- | --- |
| React / React DOM | ^19.2.8 | 19.3.0 |
| TypeScript | ~6.0.2 | 6.0.3 |
| Vite | ^8.3.0 | 8.3.1 |
| Oxlint | ^1.81.0 | 1.85.0 |

Node 24.21.0 and pnpm 10.34.5 were verified by their executables. Root tooling declarations pin Playwright 1.63.0, Prettier 3.9.9, and Vitest 5.0.1. Keep the lockfile in Git and use frozen-lockfile installation for reproduction. Do not describe a version range as the exact installed version.

## F003 - Windows database port mapping is 5434 -> 5432

Evidence: Compose and the running container bind `127.0.0.1:5434:5432`. PostgreSQL remains on 5432 inside its container. The original host port 5433 failed with an access-permission bind error; the root cause may involve Windows reservations or another process, but it was not established.

The ignored local `DATABASE_URL` still used 5433 after the Compose edit. It was corrected to 5434 without changing the password. Keep Compose, `.env.example`, the local environment, setup helper, and instructions aligned if the host port changes again.

Verified: healthy PostgreSQL 17.11, successful in-container SQL query, reachable host TCP port. Not verified by those checks: a future API connecting with `DATABASE_URL`. The in-container local socket can use different authentication from host TCP access.

## F004 - Database data and local credentials have separate lifecycles

PostgreSQL data resides in the Docker named volume `ark-local_postgres_data`. The `.env` file is ignored and local. `setup:env` creates it only when absent and does not print secrets.

Changing an environment variable does not change the password of an already initialized PostgreSQL role. Preserve the matching `.env` and volume; do not delete/recreate the volume to fix a connection error. Use an explicit password-rotation procedure when necessary. Routine shutdown uses `db:stop`.

The current `POSTGRES_USER` is the local development bootstrap role. It is not yet a designed least-privilege application/migration role split. Implement that database access design before representing the API as hardened.

## F005 - Public publication excludes private research

The destination repository is public. Four original root planning/research documents contain private-service references or internal research context. They remain unchanged and ignored locally. Removing only URLs would not necessarily remove confidential observations.

Public `docs/architecture.md` and `docs/roadmap.md` state the independent project design without those sources. Code/config/tests and the notebook are the published working context. Do not upload the excluded originals or copy their private passages into commits, issues, logs, or notes.

## F006 - Starter tooling differs from parts of the plan

- The generated frontend uses Oxlint; the intended plan selected ESLint. Preserve the factual distinction and make an explicit decision in V0.1.
- `tsconfig.app.json` and `tsconfig.node.json` do not explicitly set `strict`. Compiler configuration inspection did not report an explicit strict setting. Set and verify the intended strict behavior before claiming compliance; do not infer all type-safety guarantees from a successful build or the TypeScript major alone.
- Root commands were absent immediately after scaffolding and were added during the recording pass. Application `test:unit`, `test:integration`, `test:e2e`, migration commands, and test fixtures do not yet exist.
- The Windows development environment uses Docker Desktop/WSL2. Later per-session sandboxing must be implemented and tested on this environment; a database container alone does not provide agent isolation.

## F007 - Git safety is layered and local hooks are not automatic on clones

`.gitignore` excludes local/private material; the pre-commit hook scans the Git index; review of the staged diff remains required. The guard detects selected token formats, credential-bearing URLs, known local `.env` values, and forbidden paths. It is not an exhaustive content-classification system, encoded-secret detector, or organizational data-loss-prevention product.

Run `pnpm.cmd hooks:install` in every new clone. For the initial reviewed commits, a repository-local GitHub noreply identity avoids publishing the configured personal email; global Git settings remain unchanged.

Source and safe configuration belong in Git. Installed dependencies, build outputs, logs, database contents, credentials, and private research do not. Each meaningful step should include updated notes and actual check results. Git records the tracked files only; the local environment-port correction is described without committing its secret-bearing file.

## Open decisions for the next implementation increment

1. Implement identity/API schemas and migrations before product UI features.
2. Make TypeScript strictness explicit and choose the lint configuration deliberately.
3. Choose the local application and migration database-role split.
4. Add the actual Vitest/PostgreSQL/Playwright suites for the identity slice.
5. Select the recoverable OS-backed secret-store implementation before real provider credentials.
6. Validate runner/container isolation when that milestone starts; it is not proven by current Docker availability.
