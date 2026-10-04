# Catalog archive acceptance completed

Recorded 2026-10-04 (Asia/Kolkata). [Current progress](README.md) · [Implementation checkpoint](2026-10-03-01-catalog-archive.md)

## Purpose and data flow

Workspaces, Agents, and Flows can now be archived and unarchived. Archive changes catalog visibility while keeping names, complete definitions, version identities, and immutable history. The browser confirms a transition and sends the expected definition and lifecycle revisions. The API checks current authorization, locks the resource, verifies counters and dependency rules, and commits lifecycle metadata and audit together. A separate lifecycle counter makes drafts opened before an archive/unarchive cycle stale.

An active Flow's current references block Workspace/Agent archive. Historical and archived Flow definitions retain their pins but do not block it. Flow unarchive revalidates its original pins against active dependencies without upgrading them. Archived records remain readable, including history, and cannot be edited or restored. See the [contract](../findings/catalog-archive.md) and [user guide](../learning/11-catalog-archive.md).

## Files and changes

- `packages/contracts/src/catalog-lifecycle.ts` and concrete catalog contracts define status filtering, lifecycle metadata, and strict expected counters for edit, restore, archive, and unarchive.
- `packages/db/migrations/005_catalog_archive.sql` adds an archive timestamp, positive lifecycle counter, and status-list index. The migration registry advances to 005; applied migrations 001–004 are unchanged.
- `apps/api/src/versioned-catalog.ts`, `flow-dependencies.ts`, and concrete services/routes implement atomic lifecycle writes, filtered pagination, stale-request/replay protection, and dependency checks. Dependency archive scans active Flow heads in bounded pages without reversing Flow mutation lock order.
- `apps/web/src/features/catalog/` and concrete adapters/lists add URL-persisted Active/Archived filters, confirmed lifecycle actions, archived read-only state, and draft-preserving recovery. A regression fix clears an earlier restore failure warning after a successful lifecycle transition replaces the draft.
- New archive contract, PostgreSQL, list, and adapter tests extend existing identity/catalog suites. Documentation now reflects the verified archive boundary and templates as the next bounded increment.

## Automated checks

| Check                                                                                                     | Result                                                                                                                  |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                          | All packages passed; the final frontend recovery fix was followed by another successful `pnpm.cmd --dir apps/web build` |
| `pnpm.cmd lint`                                                                                           | Passed after the final regression change                                                                                |
| `pnpm.cmd typecheck`                                                                                      | All packages and test TypeScript checks passed after the final regression change                                        |
| `node node_modules/vitest/vitest.mjs run tests/unit apps/web/src --pool=threads --maxWorkers=1`           | 164/164 unit and DOM tests passed across 15 files                                                                       |
| `node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration --pool=threads --maxWorkers=1` | 114/114 PostgreSQL integration tests passed across 7 files                                                              |
| `pnpm.cmd test:guard`                                                                                     | 7/7 guard tests passed                                                                                                  |
| `pnpm.cmd db:prepare`                                                                                     | Migration 005 applied; restricted runtime role retained                                                                 |

The 33 new archive integration cases cover auth/isolation/revocation, stale lifecycle counters, immutable snapshots, name reservation, creation replay, unsupported definitions, audit/response rollback, filtered pagination, dependency scans beyond 50 records, and a populated 001–004 to 005 upgrade. Eight deterministic races exercise both lock orders for dependency archive versus Flow create/update/restore/unarchive. Existing identity, Workspace, Agent, Flow, and history suites also passed. Tests use generated schemas in local `ark_test` only.

Independent backend and frontend review completed. The frontend review found a stale restore-warning state; the fix and its regression test passed the final full unit/DOM suite. A separate scan of 45 changed/new source, contract, migration, and test files found no credentials, private content, or unrelated changes.

## Browser acceptance

The Playwright CLI walkthrough used a disposable `ark_test` schema, API port 3002, and web port 5184. Setup/login ran through the UI; catalog fixture seeding used the authenticated local API.

- Canceling Workspace archive retained a dirty draft. Confirming it while an active Flow referenced the Workspace returned the expected conflict and retained the draft.
- Archiving the Flow retained all 15 form values across a full reload. Every form control was read-only, complete history remained accessible, and restore actions were absent. The archived back link and Active/Archived filter persisted in the URL across reload.
- After the Flow was archived, Workspace archive succeeded. Flow unarchive then rejected the archived dependency without changing the Flow.
- An offline Agent archive retained unsaved instructions; a manual retry succeeded, and reload showed the saved read-only definition. Agent unarchive succeeded.
- A second tab archived and unarchived a Workspace while the first held an older draft. Save in the first tab conflicted and retained the draft. Load-latest cancel kept it; confirmation recovered editing, followed by a successful new Workspace revision.
- Flow unarchive with active dependencies retained all 15 values, its original definition revision/version identity, and the original Workspace revision 1 pin even though the Workspace was now at revision 2.
- Desktop 1440×1000 and mobile 390×844 editor/history/list captures were visually inspected. Controls and wrapped history rows were readable, with no horizontal document overflow. Both tabs' console logs contained only expected test responses and normal React development information.

This is interactive browser acceptance, not an automated browser regression suite, full accessibility audit, or network-release verification. Authorization and transaction-race evidence comes from the separate API/DOM tests. No paid model call, runner, deployment, invitation, template, or deletion workflow was added.

## Resumption and cleanup

The walkthrough resumed after interruption using the original running servers and identified fixture. A restricted port query initially hid those listeners; an elevated read-only check corrected that observation. An attempted second startup failed on occupied ports without replacing the original fixture. CLI label/dialog synchronization was corrected and final assertions were observed independently of early modal returns.

Chrome was closed. The original API helper stopped cleanly and removed its own generated schema; Vite stopped cleanly too. A separate query confirmed `ark_test_7e5c23a8be8f7d20cb51` was absent, and ports 3002/5184 had no listeners. Development remained at zero users, resources, and versions under `ark_app`, matching the pre-migration baseline, with five migrations now applied. Existing environment configuration and database volumes were preserved.

Screenshots, temporary helpers, and logs remain ignored under `output/playwright/` and `.playwright-cli/`. They are excluded from the feature commit.

## Git and next step

Base commit: `73db9427f6966b357448839ef05f349fd0688c1b`, the published history/restore checkpoint. This record belongs to the local archive feature commit, identifiable with `git log -- notes/progress/2026-10-04-01-archive-completion.md`. Archive publication has not been requested or performed.

Final review covered 67 explicitly staged source, migration, test, and documentation files. `pnpm.cmd check:staged` and the staged whitespace check passed. All 22 changed Markdown files had valid local links. Manual review found no credentials, private research/source, or unrelated edits; environment files and browser artifacts remain ignored. The guard is heuristic and complements the manual review.

Next: define the first bounded template increment, including ownership, editable copies, and Flow dependency pin rules, before implementation. V0.2 remains incomplete until its remaining template scope and acceptance criteria are met. Deletion and execution remain separate.
