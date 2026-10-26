# Preparation receipt journal

Started 2026-10-26; continued 2026-10-27 (Asia/Kolkata). [Progress](README.md) · [Contract](../findings/repository-preparation-receipts.md)

## Purpose and scope

Continue from preparation-control commit `306b36b`. Store one immutable structured preparation receipt per owned repository lease with exact plan/resource binding, replay, diagnostics, and authorized reads. Evidence stays `runner_reported_unverified`; there is no change to execution authority, lease/control/lifecycle state, capacity, command execution, or cleanup/release.

## Implemented flow and files

The contract was recorded before implementation. Shared schemas -> additive migration 011 -> API -> focused checks are complete locally. A still-valid owning runner posts one structured final preparation report. The API locks runner -> execution -> lease, validates exact immutable context, and atomically saves a token-free canonical payload/digest plus safe audit. It returns the same immutable record for identical replay and rejects another final report. Current team members read the record or null after fresh authorization and session-expiry checks.

- `packages/contracts/src/repository-preparation-receipts.ts` defines strict prepared/failed observations, contained reported paths, exact ownership/manifest binding, token-free canonical serialization, response provenance, and pure plan matching. Version-1 serialization/normalization is frozen; a semantic change needs a new supported version.
- `011_repository_preparation_receipts.sql` adds one append-only final receipt per lease, composite execution/lease/runner/tenant/Workspace/generation/runtime constraints, immutable provenance, and a token-free request header check. Existing applied migrations and runner-capacity indexes remain unchanged.
- `apps/api/src/repository-preparation-receipts.ts`, dedicated routes, and `app.ts` add machine upload and current-member read. Migration registration/runtime grants advance through 011. Upload does not invoke work assessment/renewal or alter execution, lifecycle events, control sequence, lease status/expiry, or capacity.
- New unit/API tests cover the journal; existing identity/archive/stub-upgrade checks now expect eleven migrations. Architecture, roadmap, working agreement, indexes, and [guide 19](../learning/19-preparation-receipts.md) describe the boundary.

Prepared observations must report exact admitted source/command image, a contained canonical container directory, successful exited preparation container, present owned volume, and absent command container. The command image and local image ID are distinct, and neither identifies the preparation transport image. Failed observations retain bounded reason/source/image/path diagnostics. Caller trust assertions, logs, output, free-form labels, commands, credentials, and quality verdicts are rejected.

## Focused verification and corrections

**37 distinct focused cases passed across bounded runs:**

| Check                                                         | Actual result                                                                                                                            |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/repository-preparation-receipts.test.ts`          | 14/14 passed; 28.19s, including frozen serialization, JSONB key reordering, exact bindings, paths/Unicode, and trust/authority rejection |
| `tests/integration/repository-preparation-receipts.test.ts`   | 18/20 passed initially in 74.07s; only the two corrected fixture cases were rerun, both passed in 10.69s, with the other 18 skipped      |
| Three existing migration cases selected by exact name filters | 3/3 passed; 22.70s; 45 unrelated cases skipped                                                                                           |
| Shared/API production builds                                  | Passed; contracts rebuilt after the final Unicode validation change before unit/API checks                                               |
| `pnpm.cmd typecheck`                                          | All application/package and root test TypeScript checks passed                                                                           |
| Final changed-test TypeScript check and `pnpm.cmd lint`       | Passed after fixture corrections; lint reported no warnings                                                                              |

The API cases cover prepared/failed reads, one-receipt conflicts/replay, canonical restart recovery, current role/team/organization/session boundaries, actual browser-expiry lock waits, revoked/wrong/stub machine ownership, strict HTTP/body fields, exact prepared identity/resource/path/budget matches, append-only/FK constraints, safe audit/response rollback, and independently observed fixture cleanup. A forced cross-runner global-ID collision holds the winner at audit insertion, observes the loser waiting at INSERT, and proves 201/409 without partial state or extra audit. Late uploads after cancellation/expiry/approval/grant/starter loss compare exact execution/lease/event/control/capacity snapshots and grant no work.

Both initial failures were test-fixture problems: disabling the only owner correctly raised `ARK_LAST_OWNER`, so the fixture now seeds another valid active owner before disabling the starter; the forged-FK test needed consistent UUID casts before it could reach the expected FK check. Production guards were preserved, and no production source correction was needed after the focused runs. Earlier implementation review fixed a strict helper binding before verification. Independent shared/backend/schema review found no remaining actionable blocker.

## Database and fixture preservation

Docker reported Linux. Before tests and after cleanup, the development database was at migration 010 under restricted `ark_app`, with zero identity/catalog/runner/session/plan/repository/receipt rows and one pre-existing test schema. `pnpm.cmd db:prepare` then applied migration 011 and configured SELECT/INSERT-only receipt privileges; UPDATE/DELETE are denied and immutable triggers also protect the table. The post-migration read-only comparison confirmed eleven migrations, unchanged development counts, and the exact same test-schema inventory. Generated fixtures removed only their own local `ark_test` schemas and verified absence through independent observers. Environment files, database volumes, and unrelated fixtures were preserved.

## Acceptance limits and publication

This completes local backend-journal acceptance. All evidence remains `runner_reported_unverified`; matching strings and synthetic protocol tests do not establish actual source/image observation, filesystem containment, sandbox enforcement, preparation, or cleanup. No command-start/completion/release or recovery endpoint, real adapter, repository CLI worker, UI, quality report, model call, new service, or deployment was added. Broad suites and browser/UI checks were deliberately skipped for this backend-only increment. V0.5 remains incomplete.

All 28 source, migration, test, and documentation files were explicitly staged and reviewed. Staged whitespace, 250 local links across 15 Markdown files, manual confidential-content review, and `pnpm.cmd check:staged` passed. No environment, credentials, private research, generated artifacts, logs, or database files were staged. The guard is heuristic and supplements manual review. Only new migration 011 is in this SQL diff; applied 001–010 remain unchanged. GitHub was fetched and `origin/main` matched base `306b36b` before publication. This record's feature commit is discoverable with `git log -- notes/progress/2026-10-27-01-preparation-receipts.md`; authorized synchronization pushes without force and verifies remote/local HEAD equality.

## Next bounded step

Define explicit command authorization and process/cleanup receipt contracts bound to the exact preparation, plan/lease/generation, concrete resource identities, fixed deadlines, and an implemented adapter's tested observation/enforcement path. Require observed termination/cleanup before capacity release. A stored unverified preparation receipt alone cannot authorize work, establish test quality, or release ownership.
