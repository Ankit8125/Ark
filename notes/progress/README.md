# Current progress

Updated 2026-10-13 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**Verified locally: V0.1 identity and the V0.2 catalog milestone, including built-in templates.** Workspaces, Agents, and ordered Flows support immutable editing, history/restore, archive/unarchive, and active/archived filtering. Built-in examples fill unsaved drafts; ordinary Save creates independent team-owned copies. Workspace copies require a repository URL; Flow copies require explicit version pins and receive fresh stage identities with remapped bindings. The [template completion record](2026-10-13-01-template-completion.md) records checks, recovery fixes, and cleanup. Session execution, invitations, runners, and model calls remain future work.

| Area              | Evidence                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–005; templates require no migration; restricted ark_app and preserved counts checked October 13 |
| Development setup | Zero users/resources/versions at the October 13 read-only check; first-owner setup remains available       |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                             |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard |
| Automated tests   | 197 unit/DOM, 131 PostgreSQL integration, and 7 guard tests passed; recovery runs explained in checkpoint |
| UI                | Template copies/save/reload, explicit pins, dirty/offline recovery, and desktop/mobile views verified     |
| Tooling           | Production build, lint, and strict type checks passed                                                     |
| Scope             | Loopback development; no production deployment or execution workflow                                      |

The [latest verification record](2026-10-13-01-template-completion.md) explains automated checks, browser acceptance, and fixture cleanup. The [template guide](../learning/12-catalog-templates.md) explains editable copies; the [archive guide](../learning/11-catalog-archive.md) explains dependencies and lifecycle recovery; the [history guide](../learning/10-catalog-history.md) explains restore. The [Flow](../learning/09-flows.md), [Agent](../learning/08-agents.md), and [Workspace](../learning/07-workspaces.md) guides explain fields, commands, and conflicts. The [architecture guide](../learning/06-project-architecture.md) maps implemented modules and boundaries.

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

## Synchronization

History/restore commit `73db9427f6966b357448839ef05f349fd0688c1b` was pushed to `origin/main` on October 3, and remote HEAD matched local HEAD. Archive commit `b1554c6` and the template increment remain local. This record belongs to the template feature commit, identifiable with `git log -- notes/progress/2026-10-13-01-template-completion.md`. No push was requested or performed.

## Next bounded step

Define the V0.3 runner enrollment contract and acceptance cases before implementation: one-use enrollment, authenticated heartbeats, explicit team authorization, and revocation. Keep online status, dispatch approval, grants, compatibility, and capacity distinct. Dispatch, jobs, repository commands, model calls, and deletion remain separate increments.
