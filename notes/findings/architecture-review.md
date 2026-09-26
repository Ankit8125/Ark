# Architecture review findings

Updated 2026-09-26. [Findings index](README.md)

## Keep the existing modular monolith

The V0.1 code already separates HTTP handlers, identity use cases, credential operations, database infrastructure, contracts, and presentation. Independent backend and frontend reviews found no concrete need for a folder-only rewrite or generic repository interfaces. Feature folders become useful when V0.2 introduces a second domain. See the [implemented tree and growth guide](../learning/06-project-architecture.md).

## Resolved gaps

- The browser mounted `App` without a render boundary. It now has a recovery screen and explicit root reporting hooks. Only fixed source/event codes cross the reporting boundary; raw exception arguments are discarded. Reporter failure cannot break the recovery screen.
- A failed transaction rollback previously masked the first exception and released the connection without marking it unusable. The helper now preserves the original failure and discards a connection whose rollback failed. No automatic retry was introduced.
- Local database helpers checked URL authority fields while `pg` could honor query overrides. Shared validation now rejects query parameters/fragments and non-PostgreSQL protocols before creating helper/fixture pools. Both admin and existing runtime configuration are checked before `db:prepare` writes. Internally generated test-schema options remain supported.

The URL validator is intentionally in `scripts/lib`: it defines the local maintenance/test policy, not a universal restriction on the generic database package. Its declaration file gives strict TypeScript tests a typed import; changes must keep the JavaScript and declaration aligned.

## Evidence and remaining limits

Regression tests exercise actual React rendering and recovery, transaction failure paths, and invalid local connection destinations. Existing PostgreSQL authorization, bootstrap, and restart tests remain the regression baseline. The [dated record](../progress/2026-09-26-03-architecture-review.md) distinguishes executed checks from prior browser evidence.

This was a scoped code review, not a comprehensive penetration test. Network deployment, password recovery, invitations, and user-management workflows remain outside V0.1. Backend unexpected-failure logging already emits a request ID without raw database details; richer allowlisted error categories and hardened process shutdown are possible later operational improvements. Do not add raw error messages, SQL, bodies, or connection strings to logs for convenience.
