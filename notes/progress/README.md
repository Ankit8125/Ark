# Current progress

Updated 2026-09-27 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**V0.1 identity and the first V0.2 workspace slice implemented.** Team-owned workspaces can be created, listed, read, edited, and reloaded with immutable snapshots and stale-edit protection. Agents, flows, session execution, invitations, runners, and models remain future work. V0.2 as a whole is not complete.

| Area              | Evidence                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001/002 applied to ark_dev; API authenticates as restricted ark_app                             |
| Development setup | No user accounts created; first-owner setup remains available                                              |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                              |
| Authorization     | Explicit team membership, admin/developer workspace writes, locked write checks, last-owner guard          |
| Automated tests   | 52 unit/React DOM + 30 PostgreSQL/process-restart + 7 staged-guard checks passed                           |
| UI                | Workspace save/reload, two-tab conflict, offline retry, dirty navigation checked; desktop/mobile inspected |
| Tooling           | Strict types, Oxlint, production build; exact commands in implementation record                            |
| Scope             | Loopback development; no production deployment or execution workflow                                       |

The latest [workspace implementation record](2026-09-27-01-workspaces.md) explains the feature, verification, review fixes, and limits. The [workspace guide](../learning/07-workspaces.md) explains fields, commands, versions, and conflicts. The [architecture guide](../learning/06-project-architecture.md) contains the updated ASCII folder tree.

The [tooling verification](2026-09-26-04-supported-react-tooling.md) confirms Vite rather than Create React App and records the requirement to avoid deprecated/end-of-life technology. The workspace increment adds no dependency.

The original V0.1 browser verification used separate test ports and a separate database because port 5173 was occupied at that time. If `pnpm.cmd dev` reports that port busy, stop the older development terminal first.

## Change log

| Date / step     | Record                                                                            |
| --------------- | --------------------------------------------------------------------------------- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md)                   |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md)                             |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md)      |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md)          |
| 2026-09-26 / 03 | [Architecture review and focused hardening](2026-09-26-03-architecture-review.md) |
| 2026-09-26 / 04 | [React tooling and maintenance policy](2026-09-26-04-supported-react-tooling.md)  |
| 2026-09-27 / 01 | [Team-owned workspace catalog](2026-09-27-01-workspaces.md)                       |

## Synchronization

Prior checkpoints through `9f586f7` were pushed to main and verified against GitHub. The workspace step follows that base; use `git status --short --branch` and `git log --oneline -5` for its resolved commit and live synchronization state.

## Next bounded step

Continue V0.2 with team-owned agents: contract, new SQL migration, authorized endpoints, immutable versions, and save/reload UI. Then add ordered flows with authorized resource references. Runner execution and real model calls remain later milestones.
