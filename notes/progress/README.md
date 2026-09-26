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
| Automated tests | 3 contract + 15 PostgreSQL/process-restart + 7 staged-guard checks passed |
| UI | Actual setup/login/logout/reload/offline-retry flow checked; desktop/mobile inspected |
| Tooling | Strict types, Oxlint, production build; exact commands in implementation record |
| Scope | Loopback development; no production deployment or execution workflow |

Normal startup port 5173 is occupied by an older server in this environment. Stop that development terminal before `pnpm.cmd dev`. Verification used separate test ports and a separate database.

## Change log

| Date / step | Record |
| --- | --- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md) |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md) |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md) |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md) |

## Synchronization

Implementation commit `28140ca` was pushed to main and independently matched against GitHub. The [synchronization receipt](2026-09-26-02-identity-sync.md) records the full hash and final checks. This receipt is a subsequent documentation-only update; use `git status --short --branch` and `git log --oneline -5` for live status.

## Next bounded step

Begin V0.2 with team-owned workspace records: contract, SQL migration, authorized create/read/update API, revision-conflict tests, and a save/reload form. Then add agents and ordered flows with immutable versions. Do not add runner execution or real model calls to that first catalog increment.
