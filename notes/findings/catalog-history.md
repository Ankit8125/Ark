# Catalog history and restore contract

Recorded 2026-10-02 (Asia/Kolkata). [Findings index](README.md) · [Learning guide](../learning/10-catalog-history.md)

## Storage and HTTP

The existing `resources` and `resource_versions` tables support history and restore. The unique `(resource_id, revision)` index supports descending revision pagination. No SQL migration, provenance column, library, or runtime privilege change is required. Runtime snapshots remain insert/read only.

All three catalog kinds expose these routes below `/api/teams/:teamId/{workspaces|agents|flows}/:resourceId`:

| Method and suffix                 | Contract                                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `GET /versions?cursor=<revision>` | Up to 50 metadata entries, newest first; exclusive numeric revision cursor; `nextCursor` is null at the end |
| `GET /versions/:versionId`        | Complete immutable definition with its original revision, schema version, and creation time                 |
| `POST /restore`                   | Strict `{ versionId, revision }` body; expected current revision; concrete current-record response          |

The history page contains resource/team/version IDs, revision, schema version, and creation time. It omits definitions. Missing resources return 404 even for an empty page. Query fields are strict, and revision cursors must be positive decimal integers within the PostgreSQL integer range. History resource lookup always includes kind, team, and organization.

## Mutation boundary

Restore obtains current write authorization with identity/membership locks, locks the owning resource for update, and re-reads its current snapshot. It rejects a stale expected revision. The source lookup pairs version ID with that exact resource ID; the server supplies all restored fields from storage. Unsupported current/source schemas and invalid current/source definitions are read-only.

Unsupported or invalid source snapshots include a safe `versionId` field error. Current snapshot failures omit that field. This lets the editor reject only an unavailable source while retaining ordinary editing, or enter read-only conflict recovery if the current saved definition is incompatible.

Flow restore runs the existing dependency validator within this transaction. It locks Workspace/Agent resources in stable order, checks current ownership and every resource/version pair, and validates the pinned snapshots. Restoring an older Flow never automatically upgrades its pins. The existing lock order is identity/membership, owning Flow, then sorted dependencies.

Restore sets the current name and revision, inserts a fresh version, inserts `<kind>.restored` audit metadata `{ revision, sourceVersionId, sourceRevision }`, and validates the concrete response before commit. Errors, name conflicts, or audit failures roll back all changes. Audits contain identifiers and revisions, never definitions. Restoring the current snapshot intentionally creates another revision. Duplicate requests with the same expected revision conflict after the first commit.

## Client recovery

History browsing leaves the current draft intact. Preview reads and restore requests are abortable; restore busy state participates in navigation and unload protection. Restore requires explicit confirmation, including draft replacement. Failed restore retains the draft and selected snapshot. Stale conflicts offer explicit load-latest recovery; mutations are never automatically retried. Session expiry follows existing catalog handling.

The [progress record](../progress/2026-10-02-01-catalog-history.md) records actual verification and limitations. Archive/delete, templates, relational inbound dependency handling, and execution remain separate increments.
