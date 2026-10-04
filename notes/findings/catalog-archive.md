# Catalog archive contract

Recorded 2026-10-03 (Asia/Kolkata). [Findings index](README.md)

## Intended behavior and acceptance

This contract was recorded before implementation. The [October 4 completion record](../progress/2026-10-04-01-archive-completion.md) records passing automated/browser acceptance and fixture cleanup.

- Archive is resource metadata: `archivedAt` and a monotonic `lifecycleRevision` starting at 1. Archive/unarchive increments that counter, preserves the definition revision and version identity, and writes an audit in the same transaction. Names remain reserved.
- Catalog lists default to active records; `status=archived` selects archived records before pagination. Current and historical reads remain available under current team authorization.
- Admins/developers can archive or unarchive a supported, valid definition. Archived records cannot be edited or restored. Unknown/invalid current definitions remain read-only.
- Edit, restore, archive, and unarchive require expected content and lifecycle revisions. A stale request, including one opened before an archive/unarchive cycle, conflicts. There are no automatic mutation retries. Creation replay is allowed only before any lifecycle transition.
- A Workspace or Agent used by any active Flow's current definition cannot be archived. Historical and archived Flow definitions do not block archive. New/edited/restored/reactivated Flows require active dependencies with supported pinned versions; reactivation preserves exact original pins.
- Dependency archive holds the dependency row for update, then reads active Flow heads in a fresh statement without locking Flow rows. Flow mutations already lock dependencies for share and re-read them. This prevents a racing Flow from introducing a reference after the archive check without reversing the existing lock order.
- Unsupported or invalid active Flow definitions conservatively block Workspace/Agent archive because their references cannot be verified. The current small catalog scans active Flow definitions within the authorized team. A relational dependency index is deferred; revisit it if catalog size makes this scan costly.
- Browser acceptance covers confirmation/cancel, archived filtering and reload, read-only history, unarchive, inbound dependency rejection, exact pin retention, stale two-tab recovery, offline draft retention, desktop/mobile layouts, and disposable-fixture cleanup.
- Automated acceptance covers strict schemas, authorization/isolation, pagination, immutable snapshot preservation, reserved names, stale counters, audit/response rollback, dependency races, and regression suites.

The lock design follows PostgreSQL 17 [row locking](https://www.postgresql.org/docs/17/explicit-locking.html) and [Read Committed statement snapshots](https://www.postgresql.org/docs/17/transaction-iso.html). It relies on the application write paths; administrative SQL remains outside that boundary. No deletion, templates, execution, or new grants are included.

## Storage and request contract

Migration `005_catalog_archive.sql` adds nullable `archived_at`, positive integer `lifecycle_revision` with default 1, and a team/kind/archive-state/ID index. Existing names remain unique across both states. Definition `revision` and `versionId` are unchanged by lifecycle transitions, while `updatedAt` records the transition time. Immutable-version responses retain their original snapshot metadata.

| Operation             | Request and result                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List                  | Optional strict `status=active` or `status=archived`; active is the default; UUID cursor and page size 50 remain                                                                     |
| Archive/unarchive     | `POST /api/teams/:teamId/{workspaces\|agents\|flows}/:id/{archive\|unarchive}` with strict `{ revision, lifecycleRevision }`; 1024-byte body limit; concrete current-record response |
| Edit                  | Existing full replacement plus required `lifecycleRevision`                                                                                                                          |
| Restore               | Existing source `versionId` and expected `revision`, plus required `lifecycleRevision`                                                                                               |
| Current/history reads | Existing authorization and routes; archived records remain accessible                                                                                                                |

`REVISION_CONFLICT` rejects stale definition or lifecycle counters. `RESOURCE_ARCHIVED` rejects edits/restores while archived. `LIFECYCLE_CONFLICT` rejects a transition to the current state after counter checks. `RESOURCE_IN_USE` blocks inbound active Flow references; `UNVERIFIABLE_DEPENDENCIES` fails closed for unsupported active Flow heads. Missing, foreign, mismatched, or archived dependency pairs receive the existing generic `INVALID_DEPENDENCY` response. No names or definitions from another context are disclosed.

Lifecycle audits use `<kind>.archived` or `<kind>.unarchived` with `{ revision, lifecycleRevision }`. The API does not copy definitions into audit metadata. Response parsing runs before commit, so audit or response failure rolls back the timestamp/counter too. Strict expected counters reject a duplicate request after successful commit, including a retry after a lost response. Creation replay also rejects any resource that has undergone a lifecycle transition, even when it is active again.

The backend's current-schema validation now applies consistently to edit, restore, archive, and unarchive. It does not replace a stored unsupported or invalid definition with a stripped object. The [learning guide](../learning/11-catalog-archive.md) explains user recovery; the [completion record](../progress/2026-10-04-01-archive-completion.md) records executed checks and limits.
