# Catalog archive and unarchive

Recorded 2026-10-03 (Asia/Kolkata). [Current progress](README.md) · [Previous checkpoint](2026-10-02-01-catalog-history.md)

This entry preserves the implementation checkpoint. Acceptance completed on October 4; see the [completion record](2026-10-04-01-archive-completion.md) for final checks, cleanup, and the next step.

## Purpose and data flow

Archive removes a Workspace, Agent, or Flow from active catalog lists while keeping its definition, name reservation, and immutable history. A confirmed request sends the expected definition and lifecycle revisions. The API rechecks write authorization, locks the resource, checks those counters and dependency rules, then commits lifecycle metadata and audit together. Unarchive restores active visibility without replacing a definition or changing its version identity.

The [archive contract](../findings/catalog-archive.md) records the decisions and acceptance cases before implementation. Workspace/Agent archive is blocked by active Flow current references. Unarchiving a Flow revalidates its original pins against active dependencies. Unsupported current definitions remain read-only. Templates, deletion, execution, invitations, and deployment are outside this increment.

## Work in progress

- Shared contracts add explicit active/archived filtering and required lifecycle counters for mutations.
- Migration 005 adds lifecycle metadata and an index; migrations 001–004 remain unchanged.
- Shared API lifecycle transactions preserve snapshots and names, reject stale requests, and protect active Flow dependencies.
- Frontend controls and automated acceptance tests are being implemented.

## Checks and result

Not yet accepted. Shared packages and API build passed. Full regression checks, migration verification, browser acceptance, fixture cleanup, independent review, and staged-content review remain pending.

## Git and next step

Base: `73db9427f6966b357448839ef05f349fd0688c1b` (history/restore), pushed to `origin/main` and verified against remote HEAD on October 3 before this increment. Archive changes are local and uncommitted. Finish and verify this bounded feature before starting templates.
