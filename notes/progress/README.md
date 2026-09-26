# Current progress

Updated 2026-09-26 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**V0.1 local identity foundation implemented.** One-time owner/organization/team setup, persistent login/logout, API authorization, checked migrations, and a responsive team-aware shell are present. Session execution, workspace editing, invitations, runners, and models remain future work.

| Area | Evidence |
| --- | --- |
| Database | Migration applied to ark_dev; API authenticates as restricted ark_app |
| Development setup | No user accounts created; first-owner setup remains available |
| Identity | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks |
| Authorization | Explicit team membership and database last-owner guard |
| Automated tests | 31 unit/React DOM + 15 PostgreSQL/process-restart + 7 staged-guard checks passed |
| UI | Actual setup/login/logout/reload/offline-retry flow checked; desktop/mobile inspected |
| Tooling | Strict types, Oxlint, production build; exact commands in implementation record |
| Scope | Loopback development; no production deployment or execution workflow |

The [staff-engineer architecture review](2026-09-26-03-architecture-review.md) retains this structure and adds targeted render recovery, transaction cleanup, and local URL safety fixes. No new product feature was introduced. The [architecture guide](../learning/06-project-architecture.md) contains the recommended ASCII folder tree and growth decisions.

The latest [tooling verification](2026-09-26-04-supported-react-tooling.md) confirms Vite rather than Create React App and records the user's requirement to avoid deprecated/end-of-life technology. It changes documentation only.

The original V0.1 browser verification used separate test ports and a separate database because port 5173 was occupied at that time. If `pnpm.cmd dev` reports that port busy, stop the older development terminal first.

## Change log

| Date / step | Record |
| --- | --- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md) |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md) |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md) |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md) |
| 2026-09-26 / 03 | [Architecture review and focused hardening](2026-09-26-03-architecture-review.md) |
| 2026-09-26 / 04 | [React tooling and maintenance policy](2026-09-26-04-supported-react-tooling.md) |

## Synchronization

Implementation commit `28140ca`, receipt `da04cbe`, and architecture review `a0afcf1` were pushed to main and verified against GitHub. The [latest documentation step](2026-09-26-04-supported-react-tooling.md) records the maintenance policy; use `git status --short --branch` and `git log --oneline -5` for live status.

## Next bounded step

Begin V0.2 with team-owned workspace records: contract, SQL migration, authorized create/read/update API, revision-conflict tests, and a save/reload form. Then add agents and ordered flows with immutable versions. Do not add runner execution or real model calls to that first catalog increment.
