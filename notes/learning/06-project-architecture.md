# How the project is organized

Updated 2026-09-27. [Learning index](README.md)

Ark is a TypeScript modular monolith: one application with explicit boundaries, rather than a separate deployed service for every responsibility. This is the recommended structure for V0.1 identity and the first V0.2 workspace slice. The tree shows relevant implemented files, with repeated configuration and assets omitted.

```text
ark/
|-- apps/
|   |-- web/src/
|   |   |-- main.tsx                 # Browser composition root
|   |   |-- App.tsx                  # Routes and session lifecycle
|   |   |-- AuthPage.tsx             # Setup/login form
|   |   |-- Shell.tsx                # Team-aware application layout
|   |   |-- features/workspaces/
|   |   |   |-- WorkspaceRoutes.tsx # Catalog route composition
|   |   |   |-- WorkspaceList.tsx   # Paginated team catalog
|   |   |   |-- WorkspaceEditor.tsx # Complete definition form and save recovery
|   |   |   |-- useDraftNavigation.tsx # Dirty-form route protection
|   |   |   |-- permissions.ts     # UI role capability projection
|   |   |   |-- api.ts             # Workspace HTTP adapter
|   |   |   |-- WorkspaceEditor.test.tsx # Editor and shell DOM regressions
|   |   |   `-- workspaces.module.css
|   |   |-- api.ts                   # HTTP calls and response validation
|   |   |-- ErrorBoundary.tsx        # Recovery from rendering failures
|   |   |-- error-reporting.ts       # Sanitized React logging hooks
|   |   |-- ErrorBoundary.test.tsx   # Real React DOM recovery checks
|   |   |-- App.module.css          # Scoped presentation
|   |   `-- index.css               # Global tokens and baseline styles
|   `-- api/src/
|       |-- server.ts               # Process configuration and startup
|       |-- app.ts                  # HTTP routes and request guards
|       |-- identity.ts             # Identity use cases and authorization
|       |-- workspace-routes.ts     # Catalog HTTP request/response adaptation
|       |-- workspaces.ts           # Catalog use cases, transactions, SQL
|       |-- credentials.ts          # Password and session-token operations
|       |-- errors.ts               # Validation and safe API failures
|       `-- index.ts                # Public factory export
|-- packages/
|   |-- contracts/src/
|   |   |-- index.ts                # Identity schemas and public exports
|   |   `-- workspaces.ts           # Workspace schemas and inferred types
|   `-- db/
|       |-- src/index.ts            # Pool, transactions, migration runner
|       `-- migrations/
|           |-- 001_identity.sql
|           `-- 002_workspaces.sql
|-- scripts/
|   |-- lib/local-database-url.mjs   # Local maintenance/test URL validation
|   |-- lib/local-database-url.d.mts # Types for the JavaScript helper
|   |-- database.mjs                # Explicit local provisioning/migrations
|   |-- setup-env.mjs               # Preserving environment setup
|   `-- check-staged.mjs            # Publication guard
|-- tests/
|   |-- unit/                      # Contracts, URL guard, transaction failures
|   |-- integration/               # Real PostgreSQL and process restart
|   `-- helpers/                   # Disposable test schemas/browser API
|-- infra/local/compose.yaml       # Local PostgreSQL infrastructure
|-- docs/                         # Intended architecture and roadmap
`-- notes/
    |-- learning/                 # Explanations and commands
    |-- progress/                 # Dated work and verification evidence
    `-- findings/                 # Decisions, facts, and limitations
```

## Follow one request

For login, `AuthPage` validates the form with the shared contract and calls `api.ts`. The server checks Host, Origin, content type, rate limits, and the request schema. `IdentityService` verifies the password and organization membership, then uses the database transaction helper to store a hashed session token. The browser receives an HttpOnly cookie and a validated account response. `App` controls the signed-in state; `Shell` displays the authorized teams. Browser validation improves feedback; server validation and membership checks establish authority.

The database package knows how to connect and run transactions; it does not decide which team a user may access. The contracts package knows data shapes; it does not import React, Fastify, or database clients. Components do not make SQL queries. These boundaries are more useful than adding a generic interface or a new package around every function.

## What the review changed

1. **Rendering recovery.** A root `ErrorBoundary` displays a reload action if a descendant fails during rendering. React root callbacks send only fixed event codes to a replaceable reporter. Raw error messages, stack traces, form values, and tokens are not forwarded. The fallback does not retain the thrown error. Reloading can lose unsaved input, so the screen says so.
2. **Transaction cleanup.** If an operation fails, the helper rolls it back. If rollback itself fails, it preserves the original exception and destroys that connection instead of returning it to the pool. It does not automatically retry the operation: a disconnected commit can have an uncertain outcome.
3. **Local connection safety.** Provisioning and test fixtures now share a URL validator. It rejects unsupported protocols, remote hosts, wrong databases, and external query parameters. This matters because the database driver can use query parameters to override the apparent destination. Test fixtures add their own generated schema option only after validation.

For example, a URL that names loopback but adds a remote `host` query parameter is rejected before a pool is created. Real credentials remain in ignored `.env`; do not paste them into notes, browser variables, or command output.

## How this grows

V0.2 now has a focused `features/workspaces/` folder in the web app, a workspace service and route module in the API, and a domain-specific contracts file. The API's two catalog files remain flat while the module is small; introduce a folder when additional responsibilities justify it. Move identity files together when that makes navigation easier. Keep public contract exports and add new numbered SQL migrations; never edit applied migrations.

Workspace saves validate the full definition, reauthorize the team in a transaction, lock/check its revision, and commit a new snapshot plus audit event. React Router's data router supplies dirty-form navigation blocking without replacing Vite or React. The [workspace guide](07-workspaces.md) explains this flow and its recovery behavior.

Extract a repository abstraction when persistence needs a real alternative or repeated query boundaries become difficult to test. Until then, the identity service's parameterized SQL and injected pool keep transaction ownership visible. Separate engine/runner entrypoints belong to their planned milestones, not this review.

Use PascalCase for React components and domain types, camelCase for functions/variables, and descriptive lowercase or kebab-case names for infrastructure modules. Keep types beside their owner; infer request/response types from Zod rather than duplicating them in a global `types` folder. Small modules with clear responsibilities satisfy the useful parts of SOLID without speculative layers.

## Verification and limits

Run from the project root:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd test:unit
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd build
pnpm.cmd test:integration
pnpm.cmd test:guard
```

`test:unit` includes React DOM tests in jsdom as well as contracts and infrastructure checks. jsdom is development-only and does not replace a real browser walkthrough. Integration tests need the already-provisioned local `ark_test` database and Docker running. Run `pnpm.cmd db:prepare` after pulling a new migration; the workspace increment adds `002_workspaces.sql`.

An error boundary handles rendering failures, not every asynchronous callback, failed event handler, or broken application download. Expected request failures continue through the API/form error paths. Logging intentionally trades detailed stack traces for privacy; adding richer diagnostics needs a reviewed, sanitized schema. No remote monitoring service was added. A sound V0.1 foundation is not a claim of production readiness or perfection.

The implementation follows React's [error boundary contract](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) and [root error hooks](https://react.dev/reference/react-dom/client/createRoot), and node-postgres's [client release contract](https://node-postgres.com/apis/pool#releasing-clients).
