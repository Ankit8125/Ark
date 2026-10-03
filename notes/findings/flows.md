# Ordered Flow contract and dependency boundaries

Updated 2026-10-01. [Findings index](README.md)

The ordered Flow catalog increment passed production build, automated checks, and real-browser acceptance. See the [completion record](../progress/2026-10-01-01-flow-completion.md) for exact commands, test-run limitations, recovery checks, and publication status. Earlier implementation and interrupted verification remain dated history.

## Schema version 1

`packages/contracts/src/flows.ts` defines a strict Flow object with name, description, Workspace resource/version pair, input ports, ordered stages, and final output bindings. It allows 1–20 stages and 1–8 ports per list. Port names are at most 40 characters, start with a lowercase letter, and otherwise contain lowercase letters, digits, or underscores. Each port has type `text` or `json`.

Each stage has a stable UUID, unique case-insensitive display name, pinned Agent pair, input bindings, and output declarations. Input bindings select either a Flow input or an earlier stage output. Final Flow outputs select stage outputs. Validation requires matching types and unique port names within each list. Missing/self/forward references and duplicate stage identities are rejected. UUIDs in the definition are normalized to lowercase to match PostgreSQL identities and prevent case aliases from bypassing graph checks.

These are declarations only. Actual values, JSON payload validation, execution compatibility, runtime permissions, and scheduling belong to later milestones. This is an ordered recipe with no branches, approvals, loops, code evaluation, secret lookup, repository fetch, or model call.

## Immutable dependencies

`catalog-versions.ts` defines paired resource/version references and a separate immutable-version response. The response carries resource/team/version IDs, the snapshot revision/schema version/creation time, and its unmodified definition. It does not borrow the current resource's name or revision when displaying an old snapshot.

Flows are restricted to Workspace/Agent versions in their own team and organization. Version resolution checks both IDs and the expected kind, and validates the pinned snapshot rather than the resource's current head. A newer incompatible head must not invalidate an older supported pin.

The implementation uses the existing immutable JSON snapshot storage. Application validation establishes dependency integrity; a separate relational edge table is deferred until operations such as archive or transfer require it. Runtime grants cannot delete resources or modify/delete snapshots. Administrative access remains outside that protection.

## Implemented HTTP surface

Flow list/current-read/create/update follow the existing catalog conventions under `/api/teams/:teamId/flows`. Explicit historical reads are available under `/api/teams/:teamId/workspaces/:workspaceId/versions/:versionId` and the Agent equivalent. Every read checks current identity and team membership. Flow responses store references; they do not expand dependency definitions without separate authorized reads.

Dependency mutation validation belongs inside the same transaction as identity/membership locks, snapshot insertion, current revision, response validation, and audit. Identical creation replay must revalidate dependencies. Dependency rows are locked in a stable order; Flows cannot depend on other Flows. Audit metadata contains the Flow ID and revision, never source definitions or instructions.

The validator checks that every referenced resource was actually returned by the lock statement before its separate snapshot lookup. This prevents a newly visible resource from being resolved without a held lock. Missing, cross-team, wrong-kind, or mismatched pairs return generic `INVALID_DEPENDENCY`; unsupported or invalid pinned definitions return `UNSUPPORTED_DEPENDENCY`. Both are 400 responses with safe field paths. Stored unknown Flow schemas remain readable and reject edits with 409.

Flow mutation bodies allow 128 KiB. The maximal escaped valid fixture exercises 20 stages and eight ports per list, including references to prior-stage outputs; it exceeds 64 KiB and fits the route limit. API field errors retain complete dotted paths for the dynamic controls. No request definitions are written to audit metadata or unexpected-error logs.

The browser loads current catalog choices in pages of 50 and separately reads selected pins, retaining historical selections rather than silently replacing them. A full dependency history selector is deferred. Each editor performs at most one Workspace and 20 stage-version reads for its selected references; identical Agent selections are not currently deduplicated across stage components. Dirty initialization uses the same generated stage identities for the draft and its baseline. Validation focus waits until busy controls are enabled again.

Defensive cross-organization coverage relaxes the organization singleton constraint only in a generated test schema. Production remains single-organization; those fixtures do not implement or claim multi-organization support.

## References and remaining scope

Official references checked during design: [Zod refinements](https://zod.dev/api#superrefine), [PostgreSQL 17 row locks](https://www.postgresql.org/docs/17/explicit-locking.html), and [node-postgres transactions](https://node-postgres.com/features/transactions). No package or lockfile upgrade is required.

[History listing/restore](catalog-history.md) now extend all three catalogs, including complete historical Flow reads and fresh dependency validation during restore. The dependency picker still offers current catalog choices and retained historical pins; choosing any older dependency directly remains a separate UI decision. Archive/delete, templates, cross-team sharing, runner enrollment, and execution remain separate increments.
