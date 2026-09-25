# Release roadmap

This is intended work. The [progress notebook](../notes/progress/README.md) records implemented and verified behavior. Releases are cumulative; do not label a milestone complete from a scaffold or a plan alone.

## V0 - Internal end-to-end prototype

| Increment | Deliverable | Required evidence |
| --- | --- | --- |
| V0.1 | Foundation, identity, PostgreSQL, setup/login, initial organization/team, UI shell | Setup persists across restart; bootstrap is one-use; unauthorized requests fail; two-team fixtures prove isolation; last owner cannot be removed |
| V0.2 | UI-created workspaces, agents, ordered flows, immutable versions | Save/reload fidelity, stale edit conflict, forbidden dependencies rejected |
| V0.3 | Real local runner enrollment and compute controls | One-use enrollment, heartbeat, approval/grants, revocation, offline detection |
| V0.4 | Durable orchestration using a deterministic stub | Idempotent start/events/completion, SSE replay, exclusive ownership, uncertain recovery, correct cancellation |
| V0.5 | Isolated repository preparation and real commands | Explicit source revision, real reports, no-tests is non-pass, process cleanup and path boundaries |
| V0.6 | First real agent runtime adapter | Authorized API-key usage, typed completions, cancellation, observable usage and finite limits |
| V0.7 | Plan/publication approvals and bounded repair | Stale evidence/approval rejected, exact commit binding, separate process status and quality verdict |
| V0.8 | One verified draft PR | Actual checks/review/approval, controlled push, response-loss reconciliation, verified remote head/base/draft |

Current position: early V0.1 preparation. There is no real API or identity flow yet.

## V1 - First team-usable release

Complete invitations, fixed roles, teams, resource/compute grants, credential-use policies, administrative controls, costs/metrics/audit views, access revocation, and operational recovery. Demonstrate separate admin/developer/reviewer identities and two-team isolation. Network exposure requires an explicit deployment/security checkpoint. Ordinary records must be manageable through the UI.

## Later cumulative releases

| Release | Scope |
| --- | --- |
| V1.1 | Versioned skills/tools/MCP registries, ticket input, same-PR follow-up, CLI and editor access |
| V2 | Verified connector events, durable schedules, notifications, external CI evidence |
| V3 | Typed graph editing, child sessions, bounded parallel work, multiple repositories, additional runtimes, safe pause/resume |
| V4 | Curated scoped memory, provenance-aware retrieval, evaluations, cost reconciliation and quality measurements |
| V5 | Managed compute, shared artifact storage, enterprise identity/operations, isolated plugins, optional release/deployment flows |

Deferred scope remains part of the product direction. It does not justify installing or provisioning everything during bootstrap.

## Next work package

1. Define the first identity/setup request and response contracts and acceptance/denial cases.
2. Add SQL migrations and a controlled local migration entrypoint; decide application versus migration database roles.
3. Implement Fastify health/readiness and one-time organization/owner/team setup.
4. Implement protected local sessions and the matching setup/login UI.
5. Verify persistence after restart, bootstrap replay rejection, unauthorized access, team isolation, and last-owner protection.
6. Record results and limitations in the notes and commit the bounded slice.

Resolve the current lint and explicit TypeScript-strictness deviations while establishing those foundations. Keep real model calls, runner execution, and external publication out of this identity slice.
