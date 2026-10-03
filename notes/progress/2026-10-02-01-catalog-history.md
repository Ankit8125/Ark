# Catalog history and immutable restore

Recorded 2026-10-02 (Asia/Kolkata). [Current progress](README.md) · [Previous checkpoint](2026-10-01-01-flow-completion.md)

## Purpose and data flow

Add history browsing and restore to Workspaces, Agents, and Flows. A user opens revision metadata, reads a complete saved snapshot, and confirms restoring it. The API checks current identity, explicit team membership, write role, and expected current revision; reads the source from storage; validates its schema and Flow dependencies; then commits a new immutable revision and source audit together. Existing revisions stay intact.

This is the bounded history/restore increment within V0.2. Archive and templates remain separate. Session execution, runners, invitations, and real model calls remain later work.

## Changes

- Shared contracts add history metadata pages, bounded revision cursors, strict restore requests, and Flow historical route parameters.
- The shared catalog service adds history and restore while concrete services/routes keep the three resource kinds explicit. Existing tables, indexes, and runtime grants suffice; no migration is needed.
- Restore uses stored source content, fresh authorization and dependency checks, expected-revision locking, new version identity, safe source audit metadata, and response validation before commit.
- The web catalogs share history controls, complete read-only previews, confirmed restore, draft retention, conflict recovery, and abort/navigation handling.
- Focused contract, PostgreSQL, adapter, and DOM coverage extends the existing regression suites.
- Learning/findings guides explain the data flow, API, revision behavior, and limits; current architecture and roadmap point to this checkpoint.

## Checks and result

The history/restore increment is verified locally, including automated checks, browser acceptance, and fixture cleanup. V0.2 remains incomplete because archive and templates are separate work. Remote publication has not been requested or performed.

| Check                                                                                                     | Result                                                                                                           |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                                                          | Passed across shared packages, API, and production web bundle; Vite emitted a non-failing plugin timing advisory |
| `pnpm.cmd typecheck`                                                                                      | Passed across packages, web, API, and tests                                                                      |
| `pnpm.cmd lint`                                                                                           | Passed after removing the initial frontend unused-variable warning                                               |
| `node node_modules/vitest/vitest.mjs run tests/unit apps/web/src --pool=threads --maxWorkers=1`           | 140/140 passed across 13 files, using already-built shared packages                                              |
| `node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration --pool=threads --maxWorkers=1` | 81/81 passed across six files, using the already-built API and disposable local `ark_test` schemas               |
| `pnpm.cmd test:guard`                                                                                     | 7/7 passed                                                                                                       |
| `pnpm.cmd check:staged`                                                                                   | Passed for all 39 explicitly selected files                                                                      |

The first targeted integration run passed 16 of 17 cases. The failed isolation fixture reused a team name within one organization; it now generates distinct names. This was a test setup failure before the isolation assertions. The subsequent full 81-test run passed, including those assertions.

Independent backend review found no actionable issues. Frontend review caught an error-attribution issue: an unsupported current snapshot could be labeled as an unsupported selected historical snapshot. The API now identifies source failures through the safe `versionId` field error; the browser uses current failures to enter read-only conflict recovery while retaining the draft. Regression checks cover both cases.

The final independent review confirmed this fix in API, hook, adapters, and tests and reported no remaining actionable findings. Reviews supplement the executed checks; they are not a security certification.

Docker Desktop initially had no Linux engine pipe. After startup, `docker info` reported `linux`, the declared local PostgreSQL service became healthy, and `db:test:prepare` prepared the dedicated test database. Existing environment values and volumes were preserved. The sandbox initially blocked pnpm child processes with `spawn EPERM`; an approved retry built shared packages successfully.

## Browser acceptance

Playwright CLI with Chrome used the documented disposable API/web fixture on ports 3002/5184. UI setup created fictional organization `History QA October 2`, team `History Team`, and account `history@example.test`. Two revisions of each catalog were seeded through the local API. No development account was created.

Completed:

1. Workspace history listed revisions newest first and showed a complete revision-1 preview while preserving a dirty draft.
2. Canceling restore retained that draft. Confirming restore created revision 3; the restored fields matched the historical definition and persisted after a full reload.
3. Agent history and complete revision preview loaded. Offline restore retained the edited instructions and showed explicit recovery. Reconnecting and manually retrying restored revision 1 as revision 3; a full reload retained the original instructions.
4. Flow history showed both saved revisions and the complete original definition. Restoring revision 1 created revision 3. The current definition exactly matched the original stored snapshot, including both original Workspace/Agent version IDs. Every input, textarea, and select retained its value across a full reload, and the selectors displayed revision-1 pins while revision 3 was available for each dependency.
5. A second browser tab saved Flow revision 4. A restore attempted from the first tab's stale revision 3 received 409, kept its unsaved description, and disabled further restore until recovery. Canceling Load latest kept the draft; confirming it loaded revision 4 and the competing edit.
6. Visually inspected the history list and complete preview/restore controls at 1440×1000 and 390×844. Dates stacked on mobile, long identifiers wrapped, and measured document width did not exceed either viewport.
7. Reviewed both tabs' console histories. They contained normal React development information, the earlier fixture script's corrected 404, the deliberately offline request, the deliberate 409, and Vite's expected reconnect message after server shutdown. No unexpected application errors or warnings were observed.

This was an interactive Playwright CLI acceptance walkthrough. It does not add a browser regression suite or establish a full accessibility audit or network-deployment readiness. Role revocation, unsupported schemas, dependency transfer races, and audit rollback are separate API/DOM evidence.

## Interruption, resumption, and cleanup

The first browser walkthrough was interrupted because automatic approval review hit an account usage limit. The blocked command was not executed. This was a review-service failure, not a safety rejection; no workaround was attempted. QA server sessions 23136/92203 were stopped at that point, but their exit did not remove the generated schema.

After approval access returned on October 2, a read-only inspection identified `ark_test_50d93edff1728eb77f49` by the exact fictional organization/account, team UUID, and all three resource UUIDs. Only this fixture was resumed. The original Workspace/Agent browser results were retained, and the remaining Flow/recovery/visual checks completed.

The resumed browser session was closed. API session 68449 and web session 10186 shut down cleanly with exit code 0. Cleanup locked the generated schema's tables, rechecked the exact single organization/user/team, three resource IDs/kinds/current revisions, and ten snapshots, then removed only that fixture schema. A subsequent query confirmed the schema was absent, and ports 3002/5184 had no listeners. A read-only check of development reported restricted `ark_app`, four migrations, zero users, and zero resources. Database volumes and existing configuration were preserved.

Screenshots, scripts, and transient logs remain ignored under `output/playwright/` and `.playwright-cli/`. The fixture seeding script's initial `/api/auth/me` typo was corrected to `/api/me` before any catalog seeding. A native dialog handler let one CLI call return before the full continuation finished; subsequent snapshots and independent assertions verified the actual restore and reload result.

## Git and next step

Base commit: `a866b44c55f8c6abb0f001d8d3e131ee512d574a`. Local commit preparation completed on October 3. This record is included with the local history/restore feature commit; `git log -- notes/progress/2026-10-02-01-catalog-history.md` identifies that commit. Remote synchronization has not been requested. Independent review found no secrets, private source/research, unrelated edits, or broken relative Markdown links. Final manual review covered all 39 explicitly staged source, test, and documentation files. The staged guard and whitespace check passed; all 18 changed Markdown files had valid local links. Credentials, private planning, browser scripts, screenshots, and logs remained ignored.

Next bounded feature: archive with explicit behavior for inbound Flow references and restoration/unarchive rules. Do not add deletion or templates implicitly. Keep immutable dependency history accessible under current authorization, and establish acceptance tests before changing archive visibility.
