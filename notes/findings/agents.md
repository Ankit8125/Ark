# Agent catalog findings

Recorded 2026-09-27. [Findings index](README.md)

## Contract and intentional limits

`packages/contracts/src/agents.ts` owns schema version 1 and inferred types. Every definition contains name, description, instructions, runtime, nullable model preference, and a capability array. Strict objects reject unknown fields. Instructions preserve whitespace, require nonblank content, and are bounded at 16,000 UTF-16 code units. Description allows 2,000; name is trimmed and bounded at 80. The shared `catalog-text.ts` validator rejects PostgreSQL-incompatible NUL/unpaired surrogates while accepting valid Unicode pairs.

Runtime is explicitly `stub`. Model preference is null or a trimmed identifier of up to 200 characters using letters, digits, dots, underscores, slashes, colons, and dashes. It is opaque metadata; saving neither verifies availability nor calls a provider. Capabilities are unique values from `read_files`, `edit_files`, and `run_commands`, with an empty default in the UI. They express requested configuration, not effective authorization. Future execution must resolve permissions and compatibility independently.

Unknown schema versions remain readable without discarding their fields and cannot be overwritten by this editor. Adding a real runtime is a later explicit contract decision, not an arbitrary string accepted today. No provider credentials, secret references, model calls, or execution controls are introduced.

## Storage, isolation, and shared implementation

Migration `003_agents.sql` expands the resource-kind constraint to `workspace` and `agent`; applied migrations 001/002 stay unchanged. Agents reuse immutable `resource_versions`, the deferred current-version foreign key, and existing restricted runtime privileges. Names are unique per team and kind, ignoring case. Resource UUIDs remain globally unique across kinds.

The second catalog kind justifies sharing the transaction and request-recovery mechanisms. Concrete Workspace and Agent contracts, routes, service wrappers, API adapters, and field layouts remain explicit. The shared backend handles authorization locks, parameterized SQL, resource-kind filtering, snapshots, audit writes, revision conflicts, and creation replay. This is an internal implementation abstraction with two real consumers, not a generic repository framework.

All active explicit team members can read. Admins/developers can write. Organization ownership alone is insufficient. Reads and writes must match organization, team, ID, and kind. Looking up an Agent through a Workspace route, or vice versa, returns 404. Creation ID collisions across kinds return generic `ID_CONFLICT`, not the other record's content.

Each mutation reauthorizes inside its transaction, locks the relevant identity/membership rows, and atomically commits current revision, immutable snapshot, and audit. Audits contain resource ID and revision, never instructions or preferences. Runtime privileges cannot update/delete snapshots or audit events. These safeguards do not implement RLS or constrain the migration administrator.

Concrete response-schema parsing also runs inside the transaction. Moving it into a wrapper after commit could report a failed save while retaining its writes. The integration suite injects a fixture-only persistence incompatibility and verifies that response validation failure rolls back creation and editing completely.

## HTTP and recovery contract

| Method and path                          | Result                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/teams/:teamId/agents`          | Up to 50 summaries and a nullable UUID cursor                               |
| `GET /api/teams/:teamId/agents/:agentId` | Complete current definition and version metadata                            |
| `POST /api/teams/:teamId/agents`         | Client UUID, schema version 1, full definition; 201 or identical replay 200 |
| `PUT /api/teams/:teamId/agents/:agentId` | Expected revision, schema version 1, complete replacement; 200              |

Pagination uses UUID keyset order. Summaries omit instructions and preferences. Identical creation replay is allowed only for the same team/kind at revision 1 with identical normalized content. Changed content, team, kind, or revision returns 409. A stale update returns `REVISION_CONFLICT`; a duplicate Agent name returns `NAME_CONFLICT`. No automatic mutation retries occur.

Agent mutations allow 128 KiB so the maximum supported definition fits even with JSON-escaped control characters. Workspace mutations retain 64 KiB; identity retains 16 KiB. Shared Host/Origin/JSON/cookie guards remain in force. Errors and logging must not include definition contents, credentials, SQL, or raw exception messages.

The browser shares versioned-editor recovery and dirty-navigation protection between catalog kinds. Supported fields are explicit controls; no dynamic form engine or new dependency is required. Read-only role changes, team-refresh uncertainty, lost responses, and stale revisions retain the same recovery rules as Workspaces.

## Verification and remaining work

The [dated implementation record](../progress/2026-09-27-02-agents.md) records actual automated checks, browser evidence, and limits. Workspaces and identity remain regression coverage. Ordered flows and authorized version references are next; history/restore, archive/delete, templates, sharing/grants, and execution remain unimplemented. V0.2 is not complete from two catalogs alone.

Official references checked for this increment: [PostgreSQL 17 constraint changes](https://www.postgresql.org/docs/17/sql-altertable.html), [Fastify route body limits](https://fastify.dev/docs/latest/Reference/Routes/), and [Zod strict objects and refinements](https://zod.dev/api). Existing React/Vite dependencies and their lockfile are unchanged.
