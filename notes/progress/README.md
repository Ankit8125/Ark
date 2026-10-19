# Current progress

Updated 2026-10-20 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**Verified locally: V0.1 identity, the V0.2 catalog milestone, and the first V0.3 runner enrollment, heartbeat, and revocation increment.** The [runner checkpoint](2026-10-20-01-runner-enrollment.md) records 166 passed integration tests, 281 distinct passed unit/DOM cases across recovery runs, passing build/lint/type/guard checks, browser/foreground-runner acceptance, and completed fixture cleanup. Full V0.3 remains incomplete: dispatch approval/grants and session execution remain future work. The [template completion record](2026-10-13-01-template-completion.md) preserves the catalog checkpoint.

| Area              | Evidence                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–006; restricted ark_app and runner grants checked October 20 |
| Development setup | Zero users/resources/versions/runners at the October 20 read-only check; first-owner setup remains available |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                             |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard |
| Automated tests   | 166 integration, 10 guard, and 281 distinct unit/DOM cases passed across full/targeted runs; final Compute 42/42 result supplied by the user |
| UI                | Catalog acceptance verified; real runner enrollment/recovery, online/offline/revoke, reload, and desktop/mobile acceptance passed |
| Tooling           | Production build, lint, and strict type checks passed                                                     |
| Scope             | Loopback development; no production deployment or execution workflow                                      |

The [latest runner record](2026-10-20-01-runner-enrollment.md) distinguishes completed checks, recovery runs, limits, and verified QA cleanup. The [runner guide](../learning/13-local-runners.md) explains enrollment, health, revocation, and commands. The [template](../learning/12-catalog-templates.md), [archive](../learning/11-catalog-archive.md), [history](../learning/10-catalog-history.md), [Flow](../learning/09-flows.md), [Agent](../learning/08-agents.md), and [Workspace](../learning/07-workspaces.md) guides cover catalog behavior. The [architecture guide](../learning/06-project-architecture.md) maps implemented modules and boundaries.

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
| 2026-10-03 / 01 | [Catalog archive and unarchive](2026-10-03-01-catalog-archive.md)                              |
| 2026-10-04 / 01 | [Archive acceptance completed](2026-10-04-01-archive-completion.md)                            |
| 2026-10-05 / 01 | [Built-in template contract and implementation checkpoint](2026-10-05-01-catalog-templates.md) |
| 2026-10-13 / 01 | [Template acceptance and V0.2 catalog completion](2026-10-13-01-template-completion.md)         |
| 2026-10-20 / 01 | [Runner implementation and verification checkpoint](2026-10-20-01-runner-enrollment.md) |

## Synchronization

History/restore commit `73db9427f6966b357448839ef05f349fd0688c1b` was pushed to `origin/main` on October 3, and remote HEAD matched local HEAD. Archive `b1554c6`, templates `37571f5`, and this runner increment are local work. The runner commit is identifiable with `git log -- notes/progress/2026-10-20-01-runner-enrollment.md`. No push was requested or performed.

## Next bounded step

Define the bounded dispatch-approval and explicit compute-grant contract before implementation. Keep online status, approval, grants, compatibility, and capacity distinct; jobs, repository commands, model calls, and deletion remain separate increments. Runner acceptance and QA cleanup are complete. The user requested no repeated long suite runs without a new change or unresolved concern.
