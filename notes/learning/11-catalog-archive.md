# Archive and unarchive

Recorded 2026-10-03 (Asia/Kolkata). [Learning index](README.md) · [Current progress](../progress/README.md)

Archive puts saved configuration aside without deleting it. Use the catalog's Active or Archived filter to find a record, then open it. Admins and developers can confirm Archive or Unarchive. Reviewers and viewers can read records and their history.

An archived record keeps its name, complete definition, and all saved revisions. Its name remains reserved within the team and resource kind. Its editor is read-only; history is still available. Unarchive makes that same record active again. It does not restore an earlier definition or create another saved definition revision. To restore an old definition, unarchive first, then use history restore.

## Flows and dependencies

A Workspace or Agent cannot be archived while an active Flow's current definition uses it. Update that Flow to use another dependency, or archive the Flow first. Older Flow revisions and archived Flows keep their exact pins and remain readable.

Unarchiving a Flow checks its original Workspace and Agent versions again. Those resources must be active in the same team, and the pinned versions must still have supported definitions. Unarchive the dependencies first. No pin is silently upgraded to a newer revision.

Unsupported or invalid current definitions remain read-only. If an active Flow has an unsupported definition, dependency archive is conservatively blocked because Ark cannot verify its references. A compatible application or explicit data investigation is needed; the editor does not discard unknown fields to bypass this check.

## Concurrent edits and recovery

Ark tracks definition revision and lifecycle revision separately. For example, archiving and unarchiving definition revision 3 keeps definition revision 3, while its lifecycle revision advances twice. A tab opened before those actions must load the latest record before saving. This prevents a stale tab from ignoring a lifecycle change even when the definition is unchanged.

Archive and unarchive require confirmation. Cancel keeps the draft. Failed requests retain the draft and show recovery guidance. A lost response may mean the server committed, so load the latest record explicitly to check its state before retrying. Mutations never retry automatically.

```text
Confirm archive/unarchive + expected definition/lifecycle revisions
    -> API checks current identity, team membership, and write role
    -> lock resource; reject stale or unsupported state
    -> archive dependency: check active Flow references
    -> unarchive Flow: validate original dependency pins
    -> commit lifecycle metadata and audit together
    -> show returned state; keep immutable snapshots unchanged
```

Migration 005 adds lifecycle metadata to the existing resource table. Existing records become active with lifecycle revision 1. Run `pnpm.cmd db:prepare` before starting the updated API; startup checks migrations but never applies them. Keep the existing environment file and database volume. See the [database guide](03-local-database.md) and [archive verification record](../progress/2026-10-04-01-archive-completion.md) for commands and actual acceptance status.
