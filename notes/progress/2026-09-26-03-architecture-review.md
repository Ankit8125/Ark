# Staff-engineer architecture review

Recorded 2026-09-26 (Asia/Kolkata). [Current progress](README.md)

## Purpose and scope

Review the current V0.1 structure for maintainability, security, error handling, and future growth. The user requested refactoring only where necessary, with no new product features. Independent frontend and backend reviews supported keeping the existing modular monolith and identified three concrete failure-path gaps.

## Changes

- `apps/web/src/ErrorBoundary.tsx`, `error-reporting.ts`, and `main.tsx`: root render recovery with a reload action and sanitized, replaceable React error hooks. Existing successful routes and forms are unchanged.
- `packages/db/src/index.ts`: preserve the initial transaction exception and discard a connection if rollback fails. No automatic retry or migration change.
- `scripts/lib/local-database-url.mjs` and its TypeScript declaration: validate local PostgreSQL helper/fixture destinations before pool creation. `scripts/database.mjs` and `tests/helpers/database.ts` use it; externally supplied query overrides and fragments are rejected.
- `tests/unit/transaction.test.ts`, `local-database-url.test.ts`, and `apps/web/src/ErrorBoundary.test.tsx`: focused failure-path regressions. The root unit command now includes web DOM tests; jsdom is development-only and the lockfile is updated. The Node engine constraint and setup guides now specify 24.15 or newer within 24.x, matching jsdom's minimum on that line; local Node 24.21.0 already satisfies it.
- [Architecture learning guide](../learning/06-project-architecture.md): ASCII tree, login data flow, naming conventions, trade-offs, and growth triggers. [Review findings](../findings/architecture-review.md) preserve decisions and limits. Relevant indexes, tooling/database findings, and the architecture document link to these details.

## Verification

- Production build: passed.
- Strict typecheck: passed across packages and tests.
- Oxlint: passed.
- Unit tests: 31 passed (3 contracts, 18 local URL checks, 6 transaction lifecycle checks, 4 React DOM recovery/reporting checks).
- Credential-guard regression tests: 7 passed.
- PostgreSQL/process-restart integration tests: 15 passed after starting the existing local container.
- Public Markdown local-link check: passed for all 26 files.
- Staged whitespace check and publication guard passed for the reviewed snapshot; final commit also runs the installed guard hook.
- Cleanup verification found zero remaining generated test schemas. Read-only development checks found zero users and setup still required.

The first combined unit run passed 27 non-DOM cases but hit a worker-startup timeout for jsdom. A direct jsdom probe succeeded after about 52 seconds; the focused four DOM tests and then the complete 31-test command passed. A redundant JSX configuration setting was removed after Vite reported it ignored; the final run had no such warning.

The first integration run could not connect to loopback port 5434. Docker Desktop was running but Compose reported no running Ark services. The declared database container was started with its existing volume before retrying successfully; no data reset or credential rotation occurred. It was left running for normal local development.

## Limitations and next step

The new UI behavior was tested with a real React root in jsdom. A real-browser walkthrough was not repeated during this review; the earlier V0.1 browser evidence remains historical. No network deployment, penetration test, cloud service, model invocation, new migration, or feature milestone was added. Existing environment credentials and original private planning files remain local and excluded.

The next implementation remains the first V0.2 team-owned workspace contract, migration, authorized create/read/update API, revision-conflict tests, and save/reload form. Introduce feature folders when that second domain makes them useful.

## Git record

Review base: `da04cbe` (`docs: record verified identity checkpoint sync`), following implementation `28140ca`. The intended review commit is `fix: harden identity foundation error boundaries`; this record is included in that commit. Its own hash is deliberately not embedded in itself. Use `git log --oneline -3` and `git status --short --branch` for live history and synchronization status.
