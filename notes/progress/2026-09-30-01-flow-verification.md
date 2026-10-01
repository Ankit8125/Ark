# Ordered Flow verification checkpoint — acceptance incomplete

Recorded 2026-09-30 (Asia/Kolkata). [Current progress](README.md) · [Implementation](2026-09-28-01-flows.md)

Historical checkpoint: the pending checks below were subsequently resolved in the [October 1 completion record](2026-10-01-01-flow-completion.md). Preserve this entry as evidence of what was and was not verified at the time.

## Current result

Ordered Flow source is implemented: shared strict schemas, migration 004, scoped API operations and historical dependency reads, and an ordered browser editor. Focused database and React DOM tests passed on 2026-09-28. Final production build, complete current test commands, stable-module browser acceptance, cleanup confirmation, and Git publication remain pending. Do not call this increment or V0.2 complete, and finish these checks before starting history/restore.

The working tree is based on published commit `5048b079a35db27f57f4d8331f0ae344cd2c342a`. All Flow changes remain local and unstaged. No new commit or push has occurred. Origin was fetched and matched HEAD on 2026-09-28; the 2026-09-30 local comparison still matches that cached tracking reference, not a newly fetched remote.

## Files and data flow

- `packages/contracts/src/flows.ts` and `catalog-versions.ts`: bounded ordered stages, typed port references, paired immutable identities, strict write/read envelopes. Existing Workspace/Agent contracts add version-route params.
- `packages/db/migrations/004_flows.sql` and the migration registry: extend the allowed resource kinds. Earlier applied migrations remain unchanged.
- API Flow routes/service/dependency validator: same-team and organization checks, expected kinds, paired version lookups, deterministic dependency locking, supported pinned schemas. Shared catalog transactions also validate dependencies on identical creation replay. Workspace/Agent services expose historical snapshot reads.
- `apps/web/src/features/flows/`: explicit details, ports, sources, ordered cards, version selectors, catalog pagination, and request adapters. Shared catalog hooks retain generated initial IDs and focus validation only after controls are enabled. Shell adds the Flow route/navigation.
- Tests: Flow unit and PostgreSQL suites plus 16 Flow React DOM cases; identity migration-count assertion expects four.
- Documentation: architecture/tree, learning guide, findings, and current indexes distinguish source implementation from completed acceptance. No package or lockfile changes.

Browser drafts validate locally, then the API independently validates the request and authorizes its team. It locks the Flow and referenced resource identities, checks each selected immutable snapshot, and atomically writes the current pointer, new version, and audit. Reload reads the saved definition. Nothing starts a runner, clones a repository, runs commands, or contacts a model.

## Actual checks

| Check                                             | Result and scope                                                                                                                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Initial Flow contracts, 2026-09-28                | 10 passed. Later negative-bound fixtures were strengthened; the complete final unit command has not rerun successfully.                                                                                                        |
| Full integration attempt, 2026-09-28              | 63 passed, one fixture failure while inserting a second organization under the production singleton constraint. All four existing regression files passed.                                                                     |
| Focused Flow integration after fixture fix        | 16/16 passed. The hypothetical foreign-organization fixture drops the singleton constraint only inside its disposable schema; production behavior is unchanged.                                                                |
| Catalog React DOM checks, 2026-09-28              | 41/41 passed: 16 Flow, 11 Agent, 14 Workspace. These include pin fidelity, stale reads, invalid sources/order/types, role changes, conflicts, offline recovery, and dirty navigation.                                          |
| Shared/API compilation, 2026-09-28                | Passed. Web/test typechecks also passed in focused runs.                                                                                                                                                                       |
| `pnpm.cmd lint`, 2026-09-30                       | Passed without reported warnings.                                                                                                                                                                                              |
| TypeScript, 2026-09-30                            | All five direct compiler checks passed: contracts, database, API, web, and tests. The root pnpm wrapper first failed to spawn subprocesses; direct compiler checks retained the same tsconfig files.                           |
| Unit rerun and Vite production bundle, 2026-09-30 | Could not start: Vite config loading's Windows subprocess failed with `spawn EPERM`. No compiler/test assertion failure was reached. No permissions or tool configuration were weakened.                                       |
| Staged-guard tests, 2026-09-28                    | Seven passed. The current change has not been staged, so its required `check:staged` is still pending.                                                                                                                         |
| Migration and runtime, 2026-09-28                 | `pnpm.cmd db:prepare` applied 004. Read-only status showed `ark_app`, `ark_dev`, four migrations, zero users/resources; PostgreSQL healthy on 127.0.0.1:5434. This is dated evidence, not a fresh September 30 database check. |
| Source review                                     | Separate backend and frontend review found no remaining actionable issue after the recorded fixes; review is not execution evidence.                                                                                           |

Direct compiler checks that passed, run from the repository root:

```powershell
node node_modules/typescript/bin/tsc -p packages/contracts/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p packages/db/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -b apps/web/tsconfig.json --pretty false
node node_modules/typescript/bin/tsc -p tests/tsconfig.json
```

## Review corrections

The final September 30 documentation pass checked 37 public Markdown files with no broken local links. `git diff --check` passed and the index remained empty. The source/publication staged guard is still pending because nothing has been staged.

1. Require every dependency to appear in the locked resource-ID set before the fresh snapshot lookup. A resource newly visible between statements cannot be resolved without a held lock.
2. Generate a new Flow's default stage IDs once for both the draft and clean baseline. Two independently generated definitions would incorrectly mark an untouched form dirty.
3. Focus a rejected save's field after the busy state clears, so a temporarily disabled version select can receive focus. Existing catalog DOM tests remained green.
4. Use unique React option keys while a draft temporarily contains duplicate/blank port names; preserve binding values until validation is satisfied. Move plain helpers out of component modules to keep Fast Refresh boundaries clean.

## Browser evidence and interruption

Playwright CLI and Chrome used the disposable API on 3002 and Vite on 5184, with fictional `example.test` identity data in a generated `ark_test` schema. Setup, Workspace creation, Agent creation, Flow navigation, empty-list state, and the initial Flow editor were observed. No Flow save/reload, two-tab Flow conflict, pin-upgrade, desktop/mobile visual acceptance, or final stable-module console verification was completed.

An immediate scripted navigation after Workspace creation met the existing busy-form guard; it explicitly reported that changes were saved, and confirmed navigation succeeded. Later helper extraction briefly produced Vite hot-reload missing-export messages. Source/type/DOM checks passed after that extraction, but the intended fresh browser reload was never executed. Do not report those transient browser messages as a verified clean console or a production failure.

Automatic approval review rejected the browser reload on September 28 and the resumed snapshot on September 30 because the account usage limit prevented approval review from completing. The rejected actions did not execute; this was not a finding that the commands were unsafe. Subsequent user continuation did not clear that external limit. Required browser access and publication must resume once the approval service is available.

The original QA terminal handles are no longer available on September 30. Attempts to stop those exact sessions returned `Unknown process id`; this does not prove server or fixture cleanup. Inspect listeners and identify the fixture by its generated schema and fictional organization before cleanup. Preserve unrelated servers, development records, and all Docker volumes. No broad schema/database cleanup was attempted.

## Resume checklist

1. Read this checkpoint, inspect the working/staged diff, and preserve any newer user work. Check local PostgreSQL status; migration 004 was already applied, so do not edit it.
2. Run the ordinary root checks: `pnpm.cmd build`, `lint`, `typecheck`, `test:unit`, `test:integration`, and `test:guard`. Record final counts and distinguish execution restrictions from assertion failures. Integration fixtures must continue refusing every database except local `ark_test`.
3. Resume or recreate the disposable browser fixture after inspecting existing QA processes/schema. Load the finalized frontend and verify a two-stage Flow through create, full reload, typed bindings, invalid reorder, retained historical pins after an Agent edit, explicit pin upgrade, stale-tab conflict, offline recovery, and dirty navigation. Inspect desktop/mobile layout and console. Confirm cleanup afterward.
4. Update this record or add a new dated completion record with actual results. Keep history/restore, archive, templates, execution, and real model calls outside this increment.
5. Stage explicit reviewed files, inspect the staged diff for confidential content, run `pnpm.cmd check:staged`, and make a meaningful commit. Fetch/inspect origin, preserve remote work, push without force, and verify remote HEAD equals local HEAD. Existing authorization to synchronize persists; never skip the guard or claim publication before it succeeds.

After Flow acceptance, the next bounded feature is history browsing and restore as a new version with fresh authorization, revision checks, and dependency validation. Current JSON references have no relational edge table; future archive/transfer/deletion must account for inbound references explicitly.
