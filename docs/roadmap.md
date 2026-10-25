# Release roadmap

This is intended work. The [progress notebook](../notes/progress/README.md) records implemented and verified behavior. Releases are cumulative; do not label a milestone complete from a scaffold or a plan alone.

## V0 - Internal end-to-end prototype

| Increment | Deliverable                                                                                           | Required evidence                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V0.1      | Foundation, identity, PostgreSQL, setup/login, initial organization/team, UI shell                    | Setup persists across restart; bootstrap is one-use; unauthorized requests fail; two-team fixtures prove isolation; last owner cannot be removed               |
| V0.2      | UI-created workspaces, agents, ordered flows, immutable versions, history/restore, archive, templates | Save/reload fidelity, stale edit/lifecycle conflicts, forbidden dependencies rejected, independent template copies with explicit repository/dependency choices |
| V0.3      | Real local runner enrollment and compute controls                                                     | One-use enrollment, heartbeat, approval/grants, revocation, offline detection                                                                                  |
| V0.4      | Durable orchestration using a deterministic stub                                                      | Idempotent start/events/completion, SSE replay, exclusive ownership, uncertain recovery, correct cancellation                                                  |
| V0.5      | Isolated repository preparation and real commands                                                     | Explicit source revision, real reports, no-tests is non-pass, process cleanup and path boundaries                                                              |
| V0.6      | First real agent runtime adapter                                                                      | Authorized API-key usage, typed completions, cancellation, observable usage and finite limits                                                                  |
| V0.7      | Plan/publication approvals and bounded repair                                                         | Stale evidence/approval rejected, exact commit binding, separate process status and quality verdict                                                            |
| V0.8      | One verified draft PR                                                                                 | Actual checks/review/approval, controlled push, response-loss reconciliation, verified remote head/base/draft                                                  |

Current accepted position: local V0.1 identity, V0.2 catalog configuration, V0.3 runner enrollment/compute controls, and V0.4 durable deterministic-stub sessions. The [template completion record](../notes/progress/2026-10-13-01-template-completion.md), [runner checkpoint](../notes/progress/2026-10-20-01-runner-enrollment.md), and [compute-control checkpoint](../notes/progress/2026-10-24-01-compute-controls.md) retain their evidence and limits. Broad regression suites were deliberately not repeated for the compute-control or session increments.

V0.4 is verified locally in the [October 25 record](../notes/progress/2026-10-25-01-durable-sessions.md), with 130 distinct focused cases across runs plus desktop/mobile browser acceptance and verified cleanup. Sessions previews typed values against an explicit active Flow version, queues immutable resource snapshots, and exposes stage progress, outputs, replayable events, cancellation, and admin recovery. An opted-in foreground runner uses `stub.v1`; PostgreSQL retains queue, lease, and event authority. Capacity is one held session per runner, including uncertain leases. Session quality remains `not_evaluated`. Repository preparation, actual path/container isolation, commands, model calls, and publication remain their later milestones.

V0.5 is partial: its [repository execution contract](../notes/findings/repository-execution.md) is recorded, and the first pure shared compiler creates a syntax-checked `planned_unverified` command plan from one saved Workspace action, a declared full commit, and a same-repository image digest. The [planning record](../notes/progress/2026-10-25-02-repository-planning.md) tracks focused verification. No API/DB/runner/UI integration, repository observation, execution, report, or quality verdict is implemented for these plans. V0.4 remains the accepted runnable checkpoint.

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

The [local runner enrollment contract](../notes/findings/runner-enrollment.md) has automated and browser/foreground-runner acceptance with verified disposable-fixture cleanup. Existing identity and catalog suites remain regression checks for future changes. Consult [current progress](../notes/progress/README.md) before resuming a check or starting a service.

Add immutable plan storage and authorized preview/admission/renewal before a real Docker adapter. The [planning record](../notes/progress/2026-10-25-02-repository-planning.md) records the completed focused planner checks. Follow the recorded [V0.5 contract](../notes/findings/repository-execution.md) for source/image observation, checkout/path/container boundaries, fixed command policy, genuine reports, no-tests as non-pass, and verified process cleanup. Preserve the [V0.4 ownership contract](../notes/findings/durable-sessions.md) while keeping its admin stopped-confirmation shortcut specific to the pure stub. Registration, health, approval, grants, compatibility, and capacity remain distinct. The [planning guide](../notes/learning/16-repository-planning.md) explains why `planned_unverified` is neither dispatch authority nor execution/quality evidence. No new dependency or external orchestration service is required by this planning slice.

TypeScript strictness is explicit. Oxlint is retained intentionally for the current workspace; the [tooling findings](../notes/findings/codebase-and-tooling.md) record the deviation from the earlier ESLint plan. The current runner executes only the deterministic evaluator; real repository commands and model calls remain later work.
