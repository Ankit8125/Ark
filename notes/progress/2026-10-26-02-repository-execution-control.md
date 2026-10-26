# Repository execution admission and preparation control

Recorded 2026-10-26 (Asia/Kolkata). [Progress](README.md) · [Contract](../findings/repository-execution-control.md)

## Purpose and scope

Continue from saved-plan API commit `556a644`. Bind declared repository intent to an explicit authorized execution and shared runner reservation, then support bounded preparation control without reusing the pure stub's stopped-confirmation shortcut. The detailed contract was recorded before implementation.

The repository execution is standalone work for one saved Workspace action, with its own lifecycle and exact plan/digest binding. Current Flows describe Agent stages; this slice creates no synthetic Flow/Agent snapshot. It shares the existing lease capacity index with stub work. This backend slice authorizes preparation only; command start, successful completion, verified cleanup/release, adapters, and UI remain later work. V0.5 is incomplete.

## Implemented data flow and files

A current admin/developer selects an immutable saved plan and explicitly granted runner. Preview validates current authority without writes. Start atomically records the plan identity, queued execution, first lifecycle event, and safe audit. Current team members can read metadata, detail, and bounded JSON event history. Cancellation uses lifecycle revisions; queued work cancels immediately, while held work retains its reservation.

An authenticated machine must explicitly declare `repository.v1` and `docker-linux-offline.v1` to claim this work. A claim fixes preparation/run deadlines, hashes its lease secret, and returns reproducible ownership intent. Runtime declaration establishes protocol opt-in, not verified containment or image availability. A separate control sequence permits idempotent preparation renewal without racing lifecycle revisions. Exact control replay never renews twice and checks current permissions, cancellation, lease status, and deadlines again. Stop, permission loss, expiry, and cancellation never release repository capacity in this slice.

- `packages/contracts/src/repository-executions.ts` defines strict human/machine requests, execution/event/lease/control responses, and deterministic ownership manifests.
- Migration `010_repository_execution_control.sql` adds immutable admission, lifecycle events, append-only token-free control receipts, and fixed clocks. Shared `session_leases` gains runtime, repository owner, and control sequence while retaining global active/uncertain runner exclusivity. Database migration registration and runtime privileges are updated.
- `apps/api/src/repository-executions.ts` and `repository-execution-routes.ts` implement admission, reads, claim, preparation controls, cancellation, and expiry. The saved-plan loader/digest is reused, and `app.ts` registers the routes.
- `work-authorization.ts` extracts existing identity/runner/compute checks for both runtimes. Stub claim/replay/advance/expiry paths explicitly require `stub.v1`; the engine waits for both runtime expiry passes even if one fails.
- New schema, API/control, and populated-upgrade tests cover the boundary. Existing identity/archive migration expectations advance to ten migrations.
- Architecture, roadmap, indexes, working agreement, and [guide 18](../learning/18-repository-execution-control.md) explain the implemented boundary and remaining work.

## Checks and corrections

**79 distinct focused cases passed:**

| Focused file                                             | Result         | Purpose                                                                                                                             |
| -------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/repository-executions.test.ts`               | 14/14; 5.50s   | Strict schemas, plan/manifest bindings, coherent authority windows                                                                  |
| `tests/integration/repository-executions.test.ts`        | 32/32; 64.53s  | Human/compute/tenant rules, admission/replay/rollback, shared capacity, controls, cancellation, expiry, immutability, exact cleanup |
| `tests/integration/sessions.test.ts`                     | 32/32; 158.07s | Existing stub behavior after shared lease/auth changes                                                                              |
| `tests/integration/repository-execution-upgrade.test.ts` | 1/1; 1.95s     | Populated 009 -> 010 upgrade, byte-for-byte legacy field preservation, old claim/progress/completion, shared capacity               |

Shared and API production builds passed. Package type checks passed. The first root test type check found three UUID-inference errors in new test helpers; explicit shared request/string types corrected them, and the test type check then passed. A final lint warning identified a redundant throwing schema guard in upgrade cleanup; the generated constant target remains validated before creation, and cleanup still verifies absence. After that correction, `pnpm.cmd lint` passed without warnings. No broad suite was repeated.

Independent review prompted atomic claim state/clock updates to satisfy migration constraints, a final cancellation expiry check after audit, a fresh first-claim authority projection after blocking audit, and globally conflicting claim UUID handling that rolls back without partial events/state. These source corrections preceded the passing focused API/stub cases. Review found no remaining actionable defect.

## Database and cleanup evidence

Docker reported Linux before PostgreSQL checks. `pnpm.cmd db:prepare` applied migration 010 locally and configured the restricted `ark_app` runtime role. Runtime execution/lease privileges are SELECT/INSERT/UPDATE with no DELETE; repository events/controls allow SELECT/INSERT only. Plans and admission/lease identity retain immutable guards.

Before and after checks found unchanged zero development counts for identity, catalog, runner, grant, session/lease/event, saved-plan, and repository execution/control tables. The migration count changed from nine to ten. Exact test-schema inventories matched, preserving one pre-existing unrelated `ark_test` schema. New fixtures removed only their generated schemas and independently verified absence. Upgrade tests populated a disposable 001–009 schema before applying 010; development data was not used as an upgrade fixture.

Preparation/run deadline cases use controlled fixture-clock shifts while temporarily disabling only the known immutable-clock trigger in their validated generated schema, then restore it in `finally`. They establish protocol boundaries, not natural 120/900-second worker or real-resource behavior.

## Limits, final review, and publication

No real repository operation, execution container, process supervision, model call, new listening service, or deployment was introduced. No browser/UI or full regression suite was run; this increment changes backend contracts and storage. Ownership manifests describe intended names, not observed resource ownership. Repository jobs deliberately have no completion, stopped-confirmation, manual-reconcile, or release endpoint until evidence and adapter enforcement exist.

All 30 source, migration, test, and documentation files were explicitly staged and reviewed. Staged whitespace, 214 local links across 13 Markdown files, manual confidential-content review, and `pnpm.cmd check:staged` passed. No environment, credentials, private research, generated artifacts, logs, or database files were staged. The guard is heuristic and supplements manual review. GitHub was fetched and `origin/main` matched the unchanged base `556a644` before publication. This completes local backend-slice acceptance, not V0.5 execution acceptance. This record's feature commit is discoverable with `git log -- notes/progress/2026-10-26-02-repository-execution-control.md`; authorized synchronization pushes without force and verifies remote/local HEAD equality.

## Next bounded step

Define bound preparation/process/cleanup receipts and the trusted-observation contract before connecting a real repository adapter. Require the exact plan/lease/generation, observed source/image/resource ownership, and verified process termination/cleanup before command authorization or capacity release. Preserve the fixed clocks, fresh compute authorization, runtime isolation, and uncertain ownership.
