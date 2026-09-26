# V0.1 identity foundation

Work started 2026-09-25 and completed verification on 2026-09-26 (Asia/Kolkata). [Current progress](README.md)

## Purpose and ordered implementation

Replace the unconnected starter with the first usable local feature, while preserving the database volume, excluding credentials/private research from Git, and retaining project context.

1. Defined shared Zod setup/login/identity/error contracts in packages/contracts.
2. Added checksum-verified migrations and PostgreSQL tables, transactional setup marker, audit records, and serialized last-owner protection in packages/db.
3. Applied the migration to ark_dev and separated local migration/admin credentials from the restricted ark_app runtime role. Existing bootstrap credentials and volume were preserved.
4. Implemented Fastify health/readiness, one-time setup, login/logout, current identity, and explicitly authorized team reads. The server never auto-migrates or auto-creates an account.
5. Added contract and real PostgreSQL acceptance tests, isolated schemas, restricted-role checks, forced rollback, and a real API process restart.
6. Replaced the counter with setup/login forms and a responsive authenticated shell showing actual organization/team/role data. Future workflows are visibly unavailable.
7. Made TypeScript strictness explicit, retained Oxlint deliberately, added full-stack development commands, and updated learning/findings/architecture/roadmap notes.

## Checks and results

| Check | Result |
| --- | --- |
| Dependency installation and lockfile | Workspace dependencies installed; resolved lockfile updated |
| Docker Compose status | PostgreSQL healthy at 127.0.0.1:5434 |
| Local preparation | Migration applied; restricted runtime authenticated; existing admin credential retained locally |
| Development identity probe | ark_app; setup required=true; users=0 |
| Unit tests | 3 passed: normalization/password preservation, field boundaries, login validation |
| Integration tests | 15 passed: readiness/denials, atomic/racing setup, rollback, cookie/hash behavior, login/logout, expiry/revocation, two-team isolation, last-owner concurrency, rate limiting, migration checksums, runtime privileges, real process restart |
| Strict typecheck | All packages and tests passed |
| Oxlint | Passed without diagnostics |
| Production build | API/shared compilation and Vite bundle passed |
| Staged-file guard regression suite | All 7 passed |
| Browser acceptance | Setup, field-error focus, persistence after reload, logout, invalid login, offline failure and successful retry passed; desktop/mobile inspected |
| Root dev startup | Both commands launched; occupied port 5173 caused expected failure and sibling termination |
| Git publication checks | Recorded with the final synchronization receipt after staged review |

The first integration run found a rate-limit error mapped to HTTP 500 instead of 429. The handler was fixed; the whole integration suite passed afterwards. A missing favicon and a frontend effect warning were also fixed. A stale dev-browser dependency bundle was resolved with a full reload before rerunning login. Browser verification details and limitations are in [the walkthrough](../findings/browser-verification.md).

## Decisions and limitations

- Local-only identity slice; no invitations, password recovery, member-management UI, runner, model calls, or execution sessions.
- Native form controls and account details menu suffice; no Radix component was needed. Styling follows the existing console direction, without invented metrics or workflows.
- Rate limits are process-local. API queries enforce team isolation; PostgreSQL RLS is not implemented. Production HTTPS/cookie/proxy/operations work remains separate.
- Interactive Playwright CLI evidence is not an automated browser regression suite.
- Dependency installation, Docker inspection, pnpm subprocesses, and Git writes required sandbox escalations. Two parallel implementation workers hit usage limits; their unfinished work was completed in the main task.
- Automatic approval review initially rejected restoring three historical notes until their diffs were inspected. Those diffs contained only formatter table padding/blank-line changes; the scoped restore was then approved and completed.
- Tests never created a development owner. Browser fixture schemas were identified and cleaned separately; PostgreSQL's persistent development volume was retained.

## Further reading and next step

Read [identity and sessions](../learning/05-identity-and-sessions.md), [identity invariants](../findings/identity-and-security.md), and [database boundaries](../findings/database.md).

Next: V0.2's first team-owned workspace CRUD slice, with revision conflicts and backend permission tests before its UI.

Commit reference: the implementation commit containing this record, retrievable with `git log --oneline -- notes/progress/2026-09-26-01-identity-foundation.md`. A subsequent receipt records its verified GitHub hash without trying to embed a commit's own hash inside itself.
