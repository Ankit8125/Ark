# Release roadmap

This is intended work. The [progress notebook](../notes/progress/README.md) records implemented and verified behavior. Releases are cumulative; do not label a milestone complete from a scaffold or a plan alone.

## V0 - Internal end-to-end prototype

| Increment | Deliverable                                                                        | Required evidence                                                                                                                                |
| --------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| V0.1      | Foundation, identity, PostgreSQL, setup/login, initial organization/team, UI shell | Setup persists across restart; bootstrap is one-use; unauthorized requests fail; two-team fixtures prove isolation; last owner cannot be removed |
| V0.2      | UI-created workspaces, agents, ordered flows, immutable versions, history/restore, archive, templates | Save/reload fidelity, stale edit/lifecycle conflicts, forbidden dependencies rejected, independent template copies with explicit repository/dependency choices |
| V0.3      | Real local runner enrollment and compute controls                                  | One-use enrollment, heartbeat, approval/grants, revocation, offline detection                                                                    |
| V0.4      | Durable orchestration using a deterministic stub                                   | Idempotent start/events/completion, SSE replay, exclusive ownership, uncertain recovery, correct cancellation                                    |
| V0.5      | Isolated repository preparation and real commands                                  | Explicit source revision, real reports, no-tests is non-pass, process cleanup and path boundaries                                                |
| V0.6      | First real agent runtime adapter                                                   | Authorized API-key usage, typed completions, cancellation, observable usage and finite limits                                                    |
| V0.7      | Plan/publication approvals and bounded repair                                      | Stale evidence/approval rejected, exact commit binding, separate process status and quality verdict                                              |
| V0.8      | One verified draft PR                                                              | Actual checks/review/approval, controlled push, response-loss reconciliation, verified remote head/base/draft                                    |

Current position: local V0.1 identity and V0.2 catalog configuration are implemented and verified. Workspace, Agent, and ordered Flow catalogs include history/restore, archive/unarchive, and built-in templates that save as independent team-owned copies. The [template completion record](../notes/progress/2026-10-13-01-template-completion.md) records acceptance and limits. V0.3 has not started. The Sessions page is a shell; it cannot start an execution yet.

## V1 - First team-usable release

Complete invitations, fixed roles, teams, resource/compute grants, credential-use policies, administrative controls, costs/metrics/audit views, access revocation, and operational recovery. Demonstrate separate admin/developer/reviewer identities and two-team isolation. Network exposure requires an explicit deployment/security checkpoint. Ordinary records must be manageable through the UI.

## Later cumulative releases

| Release | Scope                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------- |
| V1.1    | Versioned skills/tools/MCP registries, ticket input, same-PR follow-up, CLI and editor access                                 |
| V2      | Verified connector events, durable schedules, notifications, external CI evidence                                             |
| V3      | Typed graph editing, child sessions, bounded parallel work, multiple repositories, additional runtimes, safe pause/resume     |
| V4      | Curated scoped memory, provenance-aware retrieval, evaluations, cost reconciliation and quality measurements                  |
| V5      | Managed compute, shared artifact storage, enterprise identity/operations, isolated plugins, optional release/deployment flows |

Deferred scope remains part of the product direction. It does not justify installing or provisioning everything during bootstrap.

## Next work package

Define the first bounded V0.3 local runner enrollment, heartbeat, and revocation contract before changing shared schemas. Settle explicit team authorization, expiring one-use enrollment, runner credential storage and revocation, authenticated heartbeats, and offline detection. Keep enrollment, online state, dispatch approval, and compute grants distinct. Then follow shared schema -> migration -> backend -> frontend for the agreed increment, with acceptance cases established first. Existing identity and catalog suites remain regression checks. Job dispatch, session orchestration, repository/container execution, and model calls remain later work. Consult [current progress](../notes/progress/README.md) for the verified Git checkpoint before starting.

TypeScript strictness is explicit. Oxlint is retained intentionally for the current workspace; the [tooling findings](../notes/findings/codebase-and-tooling.md) record the deviation from the earlier ESLint plan. Real model calls and runner execution remain later work.
