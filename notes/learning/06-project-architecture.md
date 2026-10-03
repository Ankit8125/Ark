# How the project is organized

Updated 2026-10-01. [Learning index](README.md)

Ark is a TypeScript modular monolith: one application with explicit boundaries. This is the recommended structure for V0.1 identity and the V0.2 Workspace/Agent/Flow slices. The tree shows relevant implemented files, with repeated configuration and assets omitted.

```text
ark/
|-- apps/
|   |-- web/src/
|   |   |-- main.tsx                 # Browser composition root
|   |   |-- App.tsx                  # Routes and session lifecycle
|   |   |-- AuthPage.tsx             # Setup/login form
|   |   |-- Shell.tsx                # Team-aware application layout
|   |   |-- features/
|   |   |   |-- workspaces/
|   |   |   |   |-- WorkspaceRoutes.tsx # Workspace route composition
|   |   |   |   |-- WorkspaceList.tsx   # Workspace list adapter
|   |   |   |   |-- WorkspaceEditor.tsx # Explicit repository/environment fields
|   |   |   |   |-- api.ts              # Validated Workspace HTTP adapter
|   |   |   |   `-- WorkspaceEditor.test.tsx # Editor and shell regressions
|   |   |   |-- agents/
|   |   |   |   |-- AgentRoutes.tsx     # Agent route composition
|   |   |   |   |-- AgentList.tsx       # Agent list adapter
|   |   |   |   |-- AgentEditor.tsx     # Explicit instructions/preferences fields
|   |   |   |   |-- api.ts              # Validated Agent HTTP adapter
|   |   |   |   `-- AgentEditor.test.tsx # Agent DOM regressions
|   |   |   |-- flows/
|   |   |   |   |-- FlowRoutes.tsx     # Flow route composition
|   |   |   |   |-- FlowList.tsx       # Flow list adapter
|   |   |   |   |-- FlowEditor.tsx     # Details and section composition
|   |   |   |   |-- FlowStages.tsx     # Ordered stages with stable identities
|   |   |   |   |-- FlowPorts.tsx      # Typed port/binding controls
|   |   |   |   |-- ResourceVersionPicker.tsx # Explicit pins and historical reads
|   |   |   |   |-- useDependencyCatalog.ts # Abortable paginated choices
|   |   |   |   |-- flow-fields.ts     # Field/source helpers
|   |   |   |   |-- api.ts             # Flow and pinned-version HTTP adapter
|   |   |   |   |-- flows.module.css
|   |   |   |   `-- FlowEditor.test.tsx # Flow DOM regressions
|   |   |   `-- catalog/
|   |   |       |-- useVersionedEditor.ts # Shared save/load/conflict lifecycle
|   |   |       |-- CatalogEditor.tsx  # Shared form chrome and field component
|   |   |       |-- CatalogHistory.tsx # Saved snapshots and confirmed restore
|   |   |       |-- CatalogHistory.test.tsx # History recovery/lifecycle checks
|   |   |       |-- history-api.ts    # Shared history/restore HTTP adapter
|   |   |       |-- history-api.test.tsx # Envelope and context validation
|   |   |       |-- CatalogList.tsx    # Paginated loading and recovery
|   |   |       |-- useDraftNavigation.tsx # Dirty/busy navigation protection
|   |   |       |-- permissions.ts     # UI role projection; server is authority
|   |   |       `-- catalog.module.css
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
|       |-- workspace-routes.ts     # Workspace HTTP adaptation
|       |-- workspaces.ts           # Concrete Workspace service/response contract
|       |-- agent-routes.ts         # Agent HTTP adaptation
|       |-- agents.ts               # Concrete Agent service/response contract
|       |-- flow-routes.ts          # Flow HTTP adaptation
|       |-- flows.ts                # Concrete Flow service/response contract
|       |-- flow-dependencies.ts    # Locked, scoped immutable version checks
|       |-- versioned-catalog.ts    # Shared authorized transactions and SQL
|       |-- credentials.ts          # Password and session-token operations
|       |-- errors.ts               # Validation and safe API failures
|       `-- index.ts                # Public factory export
|-- packages/
|   |-- contracts/src/
|   |   |-- index.ts                # Identity schemas and public exports
|   |   |-- workspaces.ts           # Workspace schemas and inferred types
|   |   |-- agents.ts               # Agent schemas and inferred types
|   |   |-- flows.ts                # Typed ordered graph and reference validation
|   |   |-- catalog-versions.ts     # Paired pins and immutable version DTO
|   |   `-- catalog-text.ts         # Shared PostgreSQL-safe text validator
|   `-- db/
|       |-- src/index.ts            # Pool, transactions, migration runner
|       `-- migrations/
|           |-- 001_identity.sql
|           |-- 002_workspaces.sql
|           |-- 003_agents.sql
|           `-- 004_flows.sql
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

V0.2 has focused `features/workspaces/`, `features/agents/`, and `features/flows/` folders, concrete service/route modules in the API, and domain-specific contracts. Shared catalog behavior lives beside these features. Introduce deeper backend folders when additional responsibilities justify them. Keep public contract exports and add new numbered SQL migrations; never edit applied migrations.

Catalog saves validate the full definition, reauthorize the team in a transaction, lock/check its revision, validate the resulting public response, and commit a new snapshot plus audit event. Kind is checked alongside team and organization. Flow saves add dependency checks inside that transaction through one narrow validator callback. React Router's data router supplies dirty-form navigation blocking without replacing Vite or React. The [Workspace](07-workspaces.md), [Agent](08-agents.md), and [Flow](09-flows.md) guides explain each definition and its recovery behavior.

The second catalog exposed real duplication, so transaction handling and browser recovery have shared implementations. The third adds typed dependency resolution without moving Flow rules into Workspace or Agent modules. Field layouts, contracts, and endpoint adapters remain feature-owned. A single place for conflict/retry/authorization mechanics reduces the risk that one feature receives a fix while another misses it. The trade-off is that shared changes require all three features' regression tests. There is no dynamic form schema or speculative plugin system.

[History and restore](10-catalog-history.md) extend the same catalog boundary. History pages contain metadata; selecting a revision fetches its complete definition. Restore uses the source snapshot on the server and commits a fresh version after current authorization, expected-revision, and dependency checks. Shared `CatalogHistory` controls and a small request adapter reuse the existing editor's recovery and navigation handling.

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

`test:unit` includes React DOM tests in jsdom as well as contracts and infrastructure checks. jsdom is development-only and does not replace a real browser walkthrough. Integration tests need the already-provisioned local `ark_test` database and Docker running. Run `pnpm.cmd db:prepare` after pulling a new migration; the Flow increment adds `004_flows.sql`.

An error boundary handles rendering failures, not every asynchronous callback, failed event handler, or broken application download. Expected request failures continue through the API/form error paths. Logging intentionally trades detailed stack traces for privacy; adding richer diagnostics needs a reviewed, sanitized schema. No remote monitoring service was added. A sound V0.1 foundation is not a claim of production readiness or perfection.

The implementation follows React's [error boundary contract](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary) and [root error hooks](https://react.dev/reference/react-dom/client/createRoot), and node-postgres's [client release contract](https://node-postgres.com/apis/pool#releasing-clients).
