# Codebase and tooling findings

Recorded 2026-09-25. [Findings index](README.md)

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


## F006 - Starter tooling differs from parts of the plan

- The generated frontend uses Oxlint; the intended plan selected ESLint. Preserve the factual distinction and make an explicit decision in V0.1.
- `tsconfig.app.json` and `tsconfig.node.json` do not explicitly set `strict`. Compiler configuration inspection did not report an explicit strict setting. Set and verify the intended strict behavior before claiming compliance; do not infer all type-safety guarantees from a successful build or the TypeScript major alone.
- Root commands were absent immediately after scaffolding and were added during the recording pass. Application `test:unit`, `test:integration`, `test:e2e`, migration commands, and test fixtures do not yet exist.
- The Windows development environment uses Docker Desktop/WSL2. Later per-session sandboxing must be implemented and tested on this environment; a database container alone does not provide agent isolation.
