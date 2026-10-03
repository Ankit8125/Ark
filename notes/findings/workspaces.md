# Workspace catalog findings

Recorded 2026-09-27. [Findings index](README.md)

## Contract and module boundaries

The first V0.2 slice stores team-owned workspace configuration only. `packages/contracts/src/workspaces.ts` owns strict Zod request schemas and inferred types. Source ref and default branch are separate. Actions retain all four supported keys and their whitespace. HTTPS repository URLs reject credentials, queries, fragments, and control characters. Relative working directories reject traversal. Every text field rejects NUL and unpaired UTF-16 surrogates because PostgreSQL text/JSON cannot store them; valid Unicode pairs remain supported. This validates configuration syntax, not remote availability or execution safety.

`apps/api/src/workspace-routes.ts` adapts HTTP to `WorkspaceService` in `workspaces.ts`. With the subsequent [Agent increment](agents.md), both concrete services delegate parameterized SQL and transaction invariants to `versioned-catalog.ts`; identity supplies team authorization. The web Workspace feature keeps its fields and HTTP adapter while `features/catalog/` shares loading/recovery/navigation behavior. No generic repository framework or additional runtime dependency was introduced.

## Storage and write consistency

Migration `002_workspaces.sql` introduces `resources` and `resource_versions`. Subsequent migrations `003_agents.sql` and `004_flows.sql` expand the original workspace-only kind constraint to include Agents and Flows. A composite team/organization foreign key prevents mismatched ownership. Names are unique per team and kind, ignoring case. Versions have independent IDs, positive schema versions, and a unique resource/revision pair. The [Flow increment](flows.md) adds authorized immutable Workspace reads; an existing pin remains unchanged when the Workspace's current version advances.

The deferred foreign key from a resource's current revision to its snapshot prevents a committed dangling revision. Every write atomically stores the current pointer, a complete snapshot, and an audit event. Audits contain the workspace ID and revision, not URLs, actions, or the full definition. Audit failure rolls back the whole write.

The runtime role can select/insert/update resources and select/insert versions. It cannot update/delete version rows or delete resources. These are privileges, not RLS or protection against the migration administrator. The API does not expose arbitrary SQL. There is no archive/delete endpoint in this slice.

Updates lock the resource before reading its current snapshot and compare the submitted revision. A competing edit gets `409 REVISION_CONFLICT`; it does not overwrite or create a new snapshot. The separate lock/read statements ensure a waiter reads the newly committed current revision under PostgreSQL READ COMMITTED semantics.

## Authorization and HTTP contract

All active explicit team members can read. Team admins/developers can write; reviewers/viewers receive 403 on writes. Organization ownership without team membership does not grant catalog access. Missing and inaccessible teams/resources return 404; unauthenticated requests return 401.

Write authorization occurs inside the transaction and holds shared locks on the session, user, organization membership, team, and team membership. Relevant revocation/disable operations serialize with the write. Each new request reauthorizes; browser role labels never establish authority. The UI uses the more restrictive role from account/team responses, pauses editing during an unverified team refresh, and preserves an open same-team draft on transient failure. Definitive access denial hides the editor.

| Method and path                                  | Contract                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `GET /api/teams/:teamId/workspaces`              | At most 50 summaries, `nextCursor`; optional UUID `cursor`         |
| `GET /api/teams/:teamId/workspaces/:workspaceId` | Current complete configuration and version metadata                |
| `POST /api/teams/:teamId/workspaces`             | Client UUID, schema version 1, full definition; 201 on create      |
| `PUT /api/teams/:teamId/workspaces/:workspaceId` | Expected revision, schema version 1, full replacement; 200 on save |

List order is UUID keyset order, not alphabetical or chronological. Reload to see new records that fall before a previously loaded cursor. Summaries omit configuration contents. An identical creation replay is 200 only while the same team's resource is at revision 1 with identical normalized content. Reused IDs with other content, team, or revision receive generic `409 ID_CONFLICT`. Duplicate team names receive `409 NAME_CONFLICT`. No automatic mutation retry is performed.

Workspace mutation bodies are limited to 64 KiB; identity routes retain the global 16 KiB limit. Exact Host checks remain global. Origin and JSON guards cover POST, PUT, PATCH, and DELETE. Cookies remain HttpOnly and SameSite=Strict.

Reads retain unknown stored definitions. Unsupported stored schema versions are read-only and updates receive `409 UNSUPPORTED_SCHEMA_VERSION`. The UI also treats invalid known-version definitions as read-only. [History and restore](catalog-history.md) now provide complete snapshot reads and new immutable restore revisions. Schema migration remains unimplemented.

## References and limits

The implementation uses the existing maintained React/Vite, Fastify, Zod, and PostgreSQL stack. Sources consulted for this increment: [PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html), [Fastify route options](https://fastify.dev/docs/latest/Reference/Routes/), [Zod schema APIs](https://zod.dev/api), and React Router's [data router](https://reactrouter.com/7.18.4/api/data-routers/createBrowserRouter) and [navigation blocker](https://reactrouter.com/api/hooks/useBlocker).

No remote repository requests, image pulls, commands, model calls, cloud provisioning, or deployments occur when saving a workspace. Configuration fields are not a secret store. Concrete verification belongs in the [dated record](../progress/2026-09-27-01-workspaces.md); frontend DOM tests and a real browser walkthrough are distinct evidence.
