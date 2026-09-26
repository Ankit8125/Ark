# Identity and authorization findings

Updated 2026-09-26. [Findings index](README.md)

## Implemented API

| Endpoint                    | Behavior                                                       |
| --------------------------- | -------------------------------------------------------------- |
| `GET /api/health/live`      | Process liveness                                               |
| `GET /api/health/ready`     | Database and migration available; 503 otherwise                |
| `GET /api/bootstrap/status` | Whether one-time setup is required                             |
| `POST /api/bootstrap`       | Atomic owner/organization/team creation; 201 or replay 409     |
| `POST /api/auth/login`      | Generic credential denial or fresh session cookie              |
| `POST /api/auth/logout`     | Revokes session and clears cookie; 204                         |
| `GET /api/me`               | Active identity and explicit teams; anonymous 401              |
| `GET /api/teams/:teamId`    | Active membership required; unshared/nonexistent team both 404 |

Shared Zod contracts define inputs and responses. Errors use `{ error: { code, message, fieldErrors? } }`. The API allowlists loopback Host headers; mutations require exact approved Origin and JSON. Forwarded peer addresses are not trusted. Vite retains browser Origin and rewrites Host to the backend.

## Invariants and evidence

- A locked bootstrap marker and unique organization singleton prevent competing setups. Forced late-write failure rolls the complete setup back.
- Argon2id uses 19,456 KiB memory, time cost 2, parallelism 1. Unknown accounts take the password-verification path and receive the same failure message. Login allows 10 attempts/minute/IP; setup allows 5. Limits are process-local and reset on restart.
- Cookies are HttpOnly, SameSite=Strict, Path=/, default 12-hour expiry. HTTP loopback uses Secure=false; HTTPS deployment requires changing this. Tokens contain 32 random bytes; PostgreSQL stores only SHA-256 hashes. Login revokes a supplied prior cookie; logout invalidates the stored session.
- Protected requests check expiry, revocation, disabled users, and revoked organization membership. Team reads require explicit membership even for organization owners. Browser storage never holds authentication tokens.
- Database triggers serialize owner-removal checks on the organization row. They prevent last-owner deletion, demotion, revocation, or deactivation; competing owner removals are tested. There is no membership-editing HTTP/UI surface yet.
- Audit rows cover bootstrap, login, and logout without passwords or tokens. General request logging is disabled; unexpected failures log a request ID without raw database errors.
- Integration evidence includes restricted privileges and a real separate-process restart. This is a local foundation, not a completed deployment security review.

## Limits for future work

Invitations, password change/recovery, email verification, member administration, audit viewing, expired-session pruning, and deployment operations remain absent. Team isolation uses queries rather than PostgreSQL RLS. Runtime table privileges are broader than individual HTTP actions; never give that connection to an untrusted SQL tool. New protected mutations need fresh authorization and transaction design.

Implementation references: [Fastify server](https://fastify.dev/docs/latest/Reference/Server/), [node-postgres transactions](https://node-postgres.com/features/transactions), [OWASP password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [PostgreSQL trigger visibility](https://www.postgresql.org/docs/17/trigger-datachanges.html), and [Zod schemas](https://zod.dev/api).
