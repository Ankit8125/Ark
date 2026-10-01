# Current progress

Updated 2026-10-01 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**Verified locally: V0.1 identity plus V0.2 Workspace, Agent, and ordered Flow catalogs.** All three catalogs support create/read/edit with immutable revisions; Flows pin exact dependency versions. The [Flow acceptance record](2026-10-01-01-flow-completion.md) records the completed checks and remaining scope. V0.2 as a whole is not complete. Session execution, invitations, runners, and model calls remain future work.

| Area              | Evidence                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–004 applied to ark_dev; restricted ark_app verified on October 1                           |
| Development setup | Zero users/resources at the October 1 read-only check; first-owner setup remains available                |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                             |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard |
| Automated tests   | 96 unit/DOM, 64 PostgreSQL integration, and 7 guard tests passed; run limitations recorded in checkpoint  |
| UI                | Flow save/reload, retained/explicitly upgraded pins, conflicts, offline recovery, desktop/mobile verified |
| Tooling           | Production build, lint, and strict type checks passed                                                     |
| Scope             | Loopback development; no production deployment or execution workflow                                      |

The [latest verification record](2026-10-01-01-flow-completion.md) explains final checks, the test-only startup timing correction, browser acceptance, and fixture cleanup. Earlier interruptions remain preserved in dated history. The [Flow](../learning/09-flows.md), [Agent](../learning/08-agents.md), and [Workspace](../learning/07-workspaces.md) guides explain fields, commands, versions, and conflicts. The [architecture guide](../learning/06-project-architecture.md) contains the updated ASCII folder tree and catalog boundaries.

The [tooling verification](2026-09-26-04-supported-react-tooling.md) confirms Vite rather than Create React App and records the requirement to avoid deprecated/end-of-life technology. The catalog increments add no dependencies.

The original V0.1 browser verification used separate test ports and a separate database because port 5173 was occupied at that time. If `pnpm.cmd dev` reports that port busy, stop the older development terminal first.

## Change log

| Date / step     | Record                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md)                       |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md)                                 |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md)          |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md)              |
| 2026-09-26 / 03 | [Architecture review and focused hardening](2026-09-26-03-architecture-review.md)     |
| 2026-09-26 / 04 | [React tooling and maintenance policy](2026-09-26-04-supported-react-tooling.md)      |
| 2026-09-27 / 01 | [Team-owned workspace catalog](2026-09-27-01-workspaces.md)                           |
| 2026-09-27 / 02 | [Team-owned Agent catalog](2026-09-27-02-agents.md)                                   |
| 2026-09-28 / 01 | [Ordered Flow implementation](2026-09-28-01-flows.md)                                 |
| 2026-09-30 / 01 | [Flow verification checkpoint and remaining work](2026-09-30-01-flow-verification.md) |
| 2026-10-01 / 01 | [Flow acceptance completed](2026-10-01-01-flow-completion.md)                         |

## Synchronization

Prior checkpoints through `5048b07` (Agent catalog) were pushed to main and verified against GitHub. Origin was fetched and matched that base during resumed Flow verification. Flow acceptance is complete; explicit staging, the publication guard, commit, and remote verification are the remaining administrative steps for this record.

## Next bounded step

After recording Flow publication, add history browsing/restore as a new immutable revision with current authorization, expected-revision checks, and revalidated dependencies. Keep archive/templates separate. Runner execution and real model calls remain later milestones.
