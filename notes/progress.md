# Progress and verification

Last updated: 2026-09-25 (Asia/Kolkata).

## Current checkpoint

**V0.1 started; not complete.** A pnpm workspace, React/Vite starter, local PostgreSQL service, development commands, and persistent project notes exist. The frontend is still the template counter screen. There is no platform API, authentication, database migration layer, runner, AI adapter, or real session workflow.

| Area | Current evidence |
| --- | --- |
| Runtime | Node 24.21.0 and pnpm 10.34.5 verified locally |
| Frontend | React starter exists; production build and Oxlint completed successfully |
| Database | PostgreSQL 17.11 verified by SQL; container healthy at 127.0.0.1:5434 -> 5432 |
| Host connectivity | TCP connection to host port 5434 succeeded; this alone is not database authentication |
| Local configuration | `.env` connection port corrected from 5433 to 5434 without changing credentials |
| Tests | All 7 staged-file guard tests pass. Vitest/Playwright installed; application suites absent |
| Public content | Source, lockfile, safe configuration, and independent documentation are eligible; credentials and original private research remain ignored |
| Release status | No V0/V1 release claimed; no remote deployment or paid inference performed |

## 2026-09-25 - User-run bootstrap, recorded retrospectively

The assistant previously supplied commands; the user ran the installers and setup commands. The assistant did not perform those earlier installations.

1. Updated Node and installed pnpm; initialized Git and the pnpm workspace.
2. Added `.gitignore`, local environment variables, and PostgreSQL Compose configuration.
3. Port 5433 was refused by Windows. The user's Docker assistant changed the published port to 5434. The exact Windows reservation/conflict cause was not independently diagnosed.
4. The user reported a healthy PostgreSQL 17.11 container and a successful SQL version query.
5. Scaffolded `apps/web` with React/TypeScript/Vite and installed formatting/test tools.
6. Created an empty public GitHub repository and requested safe synchronization and persistent notes.

No commits existed when this recording pass began. The initial reviewed snapshot is commit `de926a0` (`chore: record workspace and local PostgreSQL bootstrap`). It records the resulting files, not a fictional commit for each earlier shell command.

## 2026-09-25 - Configuration, verification, and publication preparation

Purpose: preserve the setup accurately, make future work reproducible, and keep public commits free of local credentials and private research.

Changes:

- Corrected only the host port in the ignored local `DATABASE_URL`; its password was preserved.
- Added a placeholder-only `.env.example` and an idempotent environment generator.
- Added root scripts for development, build, lint, database lifecycle, hook installation, and staged-file checks.
- Added a targeted pre-commit guard and its isolated tests. The hook reads staged content, so a safe working copy cannot hide an unsafe staged version.
- Added the three notebook views, public architecture/roadmap, root README, and persistent contributor instructions.
- Preserved all four original planning/research files locally and excluded them from public commits because they contain private service references or research context.
- Configured the supplied GitHub remote and a repository-local GitHub noreply email for new commits; global Git identity was not changed.

Verification evidence:

| Check | Result / scope |
| --- | --- |
| `node --version`; `pnpm.cmd --version` | 24.21.0; 10.34.5 |
| `docker compose --env-file .env -f infra/local/compose.yaml ps` | Healthy container; 127.0.0.1:5434 -> 5432 |
| `docker compose ... exec -T postgres psql -U ark -d ark_dev -c "SELECT version();"` | PostgreSQL 17.11; reads existing DB, no mutations |
| Node TCP probe to 127.0.0.1:5434 | Connected; no application login or database-password claim |
| `pnpm.cmd --dir apps/web build` | Passed; TypeScript build and Vite production bundle |
| `pnpm.cmd --dir apps/web lint` | Passed; current Oxlint rules |
| `node --check scripts/setup-env.mjs`; `node --check scripts/check-staged.mjs` | Syntax passed |
| Initial staged-file guard and `git diff --cached --check` | Passed for the initial reviewed source snapshot |
| `pnpm.cmd build`; `pnpm.cmd lint` | New root wrappers passed the same frontend checks |
| `pnpm.cmd test:guard` | 7 tests passed, 0 failed; isolated synthetic fixtures only |
| `node scripts/setup-env.mjs` with existing `.env` | Existing configuration preserved; no credential values printed |
| Redacted local environment consistency check | Host 127.0.0.1, port 5434, database ark_dev; URL password matches the Compose input |

Environment limitations: the restricted command sandbox could not access Docker's pipe or spawn a Vite subprocess. The same read-only Docker checks and frontend build succeeded with the required process permissions. These were execution-environment restrictions, not changes made to the application. No application unit/integration/browser acceptance suite or host-side authenticated database client has been implemented or claimed as passing.

The development-support changes are recorded in commit `eada6b2` (`chore: add safe environment setup and staged credential checks`). The guard ran successfully before both initial commits. Its tests cover safe placeholders, forbidden `.env` staging, copied local credentials, credential URLs, private document paths, synthetic provider tokens, and unsafe staged content hidden by a clean working file. Matched values are withheld from diagnostics.

GitHub destination: `Ankit8125/Ark`, public, branch `main`. The repository was empty when inspected. Synchronization evidence is recorded in a dated checkpoint after the initial reviewed commits are pushed; do not infer upload success solely from local commit creation.

## Next bounded step

Implement the first V0.1 identity slice: shared contracts and SQL migrations, a Fastify API, one-time organization/owner/team setup, protected sessions, and the matching setup/login frontend. Define acceptance checks before changing code; follow the [roadmap](../docs/roadmap.md).

Before that slice, resolve the recorded starter deviations: explicit TypeScript strictness and the planned ESLint versus current Oxlint choice. No model key or agent runner is needed for this work.
