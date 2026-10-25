# V0.5 immutable saved-plan API

Recorded 2026-10-25 (Asia/Kolkata). [Progress](README.md) · [Contract](../findings/repository-execution.md#saved-plan-api-slice-recorded-before-implementation)

## Purpose and scope

Continue from planning compiler commit `93732f4edfcb320c35803272afa823f802ca249f`. Persist reusable repository intent separately from dispatch: preview and read for current team members, explicit immutable Save for admins/developers. The server resolves the selected Workspace version and compiles its command, source/image declaration, directory, and fixed policy. Clients cannot replace those fields. Save and safe audit are atomic, retries preserve the saved snapshot, and runtime rows are append-only.

The detailed HTTP/storage/replay contract was added to the findings before implementation. This is a bounded backend slice; V0.5 remains incomplete. No repository execution admission, renewal, runner adapter, real command, model, or UI is implied by a saved `planned_unverified` plan.

## Implemented data flow and files

The server accepts only a Workspace resource/version pair and explicit action/commit/image selection. It resolves that active supported version under current team authorization and a Workspace SHARE lock, compiles the saved command/configuration, and computes a deterministic digest. Preview returns that intent without a write. Explicit Save atomically records it with provenance and one safe audit. Current members can subsequently read the saved snapshot independently of catalog changes.

- `packages/contracts/src/repository-plans.ts` defines strict request/response, provenance, metadata pagination, and digest formats. `serializeRepositoryCommandPlan` emits fixed v1 nested field order and preserves exact command bytes; future changes to policy/normalization/serialization require a new supported version. A golden digest fixture anchors these bytes.
- Migration `009_repository_plans.sql` adds separate immutable rows with team/organization/creator and Workspace-kind/version foreign keys. The runtime has SELECT/INSERT only, with a row trigger additionally rejecting UPDATE/DELETE. Migration 008 and its rows remain unchanged. The registry retains all earlier migrations; the two existing migration expectations now name/count 009/nine.
- `apps/api/src/repository-plans.ts` implements preview/Save/list/get using the existing transaction and identity services. A transaction advisory lock serializes each client UUID before catalog lookup. Same creator/tenant/normalized request replays saved content without recomputation/audit; other reuse conflicts. The insert conflict fallback also rechecks expiry after waits. Concrete response validation runs before commit. Summaries select only metadata and 51 rows for a 50-row UUID-keyset page.
- `repository-plan-routes.ts` registers the four cookie-authenticated endpoints through the normal Host/Origin/JSON/body guards. Read-authorized preview needs no runner/grant; Save requires current admin/developer authority. No route creates runner/session/lease/work-event records or dispatches the plan.
- The [saved-plan guide](../learning/17-saved-repository-plans.md), compiler guide, contributor instructions, README, architecture/roadmap, and indexes explain the boundary and current limitations.

## Checks actually completed

| Check                                                              | Result                                                                                                                                          |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build:shared`                                            | Passed                                                                                                                                          |
| `pnpm.cmd --filter @ark/api build`                                 | Passed after replacing constructor parameter properties with explicit readonly fields, as required by the existing `erasableSyntaxOnly` setting |
| `tests/unit/repository-plans.test.ts`                              | 10 distinct cases passed across the initial nine-case run (2.63 seconds) and the new golden v1 digest case (3.74 seconds)                       |
| New `tests/integration/repository-plans.test.ts`                   | 24/24 passed in 32.79 seconds                                                                                                                   |
| Existing migration replay and populated catalog upgrade cases only | 2/2 passed, 45 other cases skipped, in 47.54 seconds                                                                                            |
| `pnpm.cmd typecheck`                                               | All packages and root test TypeScript passed                                                                                                    |
| `pnpm.cmd lint`                                                    | Passed without warnings                                                                                                                         |
| `pnpm.cmd db:prepare`                                              | Additive development migration 8 to 9 and runtime SELECT/INSERT-only plan grants verified                                                       |

There are **36 distinct focused cases** across these runs. No full unit/integration suite, web production build, DOM suite, browser walkthrough, or real repository/container execution was repeated. This is backend-only acceptance; no new UI exists to verify. No dependencies were added. Shared/API production compilation and strict application/test types cover the changed backend/contracts.

The new integration file covers no-write preview, every role and team/organization/session boundaries, exact supported historical pins, wrong/mismatched/archived dependencies, strict command/policy overrides, HTTP/query/body guards, canonical digest/case normalization, saved snapshot stability, identical/conflicting and concurrent requests, restart persistence, expiry during Workspace/advisory/unique-index waits, pending membership revocation, audit/response rollback, fifty-row metadata pages, and restricted database privileges/immutability/foreign keys. Plan operations create no runner, execution session, lease, or execution event. Each fixture closes only its own generated schema, then a separate observer verifies that exact schema absent.

Independent review found no actionable authorization, replay, expiry, rollback, isolation, or pagination defect. Its suggestion to add a fixed serialization digest is included in the passing golden fixture. The initial API compile caught constructor shorthand incompatible with the repository's configured TypeScript subset; the explicit-field correction passed compilation before integration checks.

## Data preservation, review, and Git

Before checks, Docker reported Linux and read-only development counts showed restricted `ark_app`, eight migrations, and zero organizations/teams/users/auth sessions/audits/catalog/runner/session/plan records. The same counts stayed zero after migration 009; plan SELECT/INSERT were allowed, UPDATE/DELETE denied. Independent before/after test-schema inventories matched exactly: one pre-existing schema was preserved, all newly generated schemas were removed. No database volume, environment, private research, unrelated schema, or user data was deleted. Only the declared local migration/role setup was applied; no listening API/browser/runner service or execution container was started. QA inventory helpers/logs remain ignored.

The [October 26 completion entry](2026-10-26-01-repository-plan-api-verification.md) records the final staged-review/publication checkpoint after the client date changed. Base commit is `93732f4`; this record's commit is identifiable with `git log -- notes/progress/2026-10-25-03-repository-plan-api.md`.

## Result and next bounded step

The backend saved-plan slice is implemented and locally verified; **V0.5 remains incomplete**. A saved plan is declared intent with `planned_unverified`, not execution admission, observed source/image truth, cleanup evidence, or quality.

Next separately define and implement repository execution admission, long-command control/renewal, and preparation/report binding. Bind the saved plan/digest to its exact session/Workspace/Flow context, reauthorize the selected compute, and preserve active-or-uncertain ownership before connecting a real adapter. Require verified process/resource cleanup to release repository work; the current pure-stub admin confirmation is insufficient.
