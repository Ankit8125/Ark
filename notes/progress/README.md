# Current progress

Updated 2026-10-02 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**Verified locally: V0.1 identity plus V0.2 Workspace, Agent, and ordered Flow catalogs with history/restore.** All three catalogs support create/read/edit, history browsing, and restore as a new immutable revision; Flows pin exact dependency versions and revalidate them on restore. The [history acceptance record](2026-10-02-01-catalog-history.md) records completed automated/browser checks and fixture cleanup. V0.2 as a whole is not complete: archive and templates remain. Session execution, invitations, runners, and model calls remain future work.

| Area              | Evidence                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–004; history needs no migration; restricted ark_app checked on October 2                   |
| Development setup | Zero users/resources at the October 2 read-only check; first-owner setup remains available                |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                             |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard |
| Automated tests   | 140 unit/DOM, 81 PostgreSQL integration, and 7 guard tests passed; run details recorded in checkpoint     |
| UI                | History/restore, Flow pin retention, conflict/offline recovery, and desktop/mobile views verified         |
| Tooling           | Production build, lint, and strict type checks passed                                                     |
| Scope             | Loopback development; no production deployment or execution workflow                                      |

The [latest verification record](2026-10-02-01-catalog-history.md) explains the automated checks, browser acceptance, resolved approval interruption, and fixture cleanup. The [history guide](../learning/10-catalog-history.md) explains safe restore and recovery. The [Flow](../learning/09-flows.md), [Agent](../learning/08-agents.md), and [Workspace](../learning/07-workspaces.md) guides explain fields, commands, versions, and conflicts. The [architecture guide](../learning/06-project-architecture.md) contains the updated ASCII folder tree and catalog boundaries.

The [tooling verification](2026-09-26-04-supported-react-tooling.md) confirms Vite rather than Create React App and records the requirement to avoid deprecated/end-of-life technology. The catalog increments add no dependencies.

The original V0.1 browser verification used separate test ports and a separate database because port 5173 was occupied at that time. If `pnpm.cmd dev` reports that port busy, stop the older development terminal first.

## Change log

| Date / step     | Record                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md)                                |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md)                                          |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md)                   |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md)                       |
| 2026-09-26 / 03 | [Architecture review and focused hardening](2026-09-26-03-architecture-review.md)              |
| 2026-09-26 / 04 | [React tooling and maintenance policy](2026-09-26-04-supported-react-tooling.md)               |
| 2026-09-27 / 01 | [Team-owned workspace catalog](2026-09-27-01-workspaces.md)                                    |
| 2026-09-27 / 02 | [Team-owned Agent catalog](2026-09-27-02-agents.md)                                            |
| 2026-09-28 / 01 | [Ordered Flow implementation](2026-09-28-01-flows.md)                                          |
| 2026-09-30 / 01 | [Flow verification checkpoint and remaining work](2026-09-30-01-flow-verification.md)          |
| 2026-10-01 / 01 | [Flow acceptance completed](2026-10-01-01-flow-completion.md)                                  |
| 2026-10-02 / 01 | [History/restore implementation and verification checkpoint](2026-10-02-01-catalog-history.md) |

## Synchronization

The last published checkpoint includes Flow implementation commit `3374c32e02833c5de190c8e38c87ca7781fd4349` and documentation commit `a866b44c55f8c6abb0f001d8d3e131ee512d574a`. History/restore is a local increment based on that checkpoint; no remote synchronization has been performed in this step. See the [history record](2026-10-02-01-catalog-history.md) and local Git log for its commit and review evidence.

## Next bounded step

Add archive with explicit inbound Flow dependency and unarchive behavior, defining acceptance cases before changing visibility. Templates and deletion remain separate. Runner execution and real model calls remain later milestones.
