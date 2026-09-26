# Codebase and tooling findings

Updated 2026-09-26. [Findings index](README.md)

## F001 - The starter has become the local identity foundation

| Location               | Implemented responsibility                                                                    |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| `apps/web`             | React Router setup/login guards, forms, team-aware shell, CSS modules and tokens              |
| `apps/api`             | Fastify request boundary, identity service, credentials, loopback server                      |
| `packages/contracts`   | Zod request/response schemas and inferred TypeScript types                                    |
| `packages/db`          | PostgreSQL pool, transactions, checksum-verified SQL migrations                               |
| `scripts/database.mjs` | Local migration/runtime-role/test-database provisioning                                       |
| `tests/unit`           | Contract validation, local URL safety, and transaction failure cases                           |
| `tests/integration`    | Real PostgreSQL identity, denial, rollback, concurrency, privilege, and process-restart tests |
| `tests/helpers`        | Isolated test schemas and a disposable browser-test API                                       |

Session execution, resource editing, runners, and models are absent. The UI says so. Login sessions (`auth_sessions`) are not future execution sessions.

## F002 - The lockfile establishes resolved versions

Node 24.21.0 and pnpm 10.34.5 were verified during bootstrap. `package.json` pins the package-manager version and requires Node 24. Manifest ranges express compatibility; `pnpm-lock.yaml` records exact resolutions. Use frozen-lockfile installation. The API uses Fastify 5.12.5's `LogController`, so its manifest requires at least that version.

## F006 - Strictness and lint decisions are explicit

TypeScript `strict` is enabled in web, API, shared packages, and tests. The API also enables unchecked-index and exact-optional-property checks. Root `typecheck` covers tests as well as packages; `build` emits packages in dependency order.

Oxlint is intentionally retained rather than switching the working starter to ESLint during identity implementation. Root lint includes apps, packages, tests, and scripts. This is an explicit deviation from the earlier plan, not a claim that ESLint was configured. There is no type-aware ESLint suite. TypeScript and behavior tests provide separate checks.

`dev` uses concurrently to start API and web and stop its sibling when one exits. Shared packages build before startup; shared-source changes require a rebuild/restart. The deployment boundary is loopback development. Windows container isolation for future execution has not been implemented or proven.

The root unit-test command also discovers `apps/web/src/**/*.test.tsx`. Those DOM tests use development-only jsdom and real React roots to verify render recovery; they are distinct from browser walkthrough evidence. jsdom 30.1.1 requires Node 24.15 or newer on the 24.x line, so the root engine constraint now states `>=24.15 <25`; the verified local Node 24.21.0 satisfies it. The [architecture guide](../learning/06-project-architecture.md) records the recommended module layout.
