# Ordered Flow acceptance completed

Recorded 2026-10-01 (Asia/Kolkata). [Current progress](README.md) · [Implementation](2026-09-28-01-flows.md) · [Earlier incomplete checkpoint](2026-09-30-01-flow-verification.md)

## Result and data flow

The ordered Flow catalog increment is verified locally. A team can create, read, and edit a recipe containing a pinned Workspace, ordered Agent stages, named text/JSON ports, and explicit source bindings. Every save creates an immutable revision. Changing an Agent or Workspace does not change an existing Flow pin.

The browser validates the draft, then the API independently validates the graph and checks current identity, team membership, write role, and each resource/version pair. The same transaction locks dependencies and commits the resource pointer, snapshot, and audit. Historical dependency reads are separately authorized. Saving performs no repository access, command execution, or model call.

V0.2 as a whole remains incomplete. History browsing/restore, archive, and templates need separate bounded increments. Sessions remain a shell; runners, invitations, administration, and real model integrations are not implemented.

## Files and review

- Shared contracts: `packages/contracts/src/flows.ts`, `catalog-versions.ts`, exports, and Workspace/Agent version-route parameters.
- Database: new `004_flows.sql` and its registry entry. Earlier applied migrations were preserved.
- API: Flow routes, service, and dependency validator; shared catalog historical reads and transaction extension; complete field-error paths; Workspace/Agent historical routes.
- Browser: `apps/web/src/features/flows/`, Shell routing, and shared catalog loading/editor/navigation types. The editor keeps stable draft stage IDs, retained historical selections, and explicit invalid bindings.
- Coverage: Flow contract, integration, and 16 DOM cases; identity migration-count update. `tests/integration/restart.test.ts` received the bounded readiness correction described below.
- Guides and findings: Flow learning guide, architecture/tree, dependency/security findings, current indexes, and preserved dated checkpoints. No package or lockfile change.

Independent source review covered the schemas, lock coverage, paired version lookups, historical endpoints, dynamic fields, selectors, and shared editor recovery. No remaining actionable correctness/security issue was found. This review supplements the executed checks; it is not a security certification.

## Actual automated checks

Checks resumed across September 30–October 1 after approval review became available again.

| Check                                                                       | Result                                                                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm.cmd build`                                                            | Passed for all shared packages, API, and the production web bundle. Vite emitted a plugin timing advisory, without a build failure. |
| `pnpm.cmd lint`                                                             | Passed. The subsequent restart-test-only edit also passed targeted lint.                                                            |
| `pnpm.cmd typecheck`                                                        | Passed, including tests. Test TypeScript was checked again after the restart fixture change.                                        |
| `pnpm.cmd test:unit --pool=threads`                                         | 96/96 tests passed across 10 files, including all 41 catalog DOM cases.                                                             |
| `node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration` | 64/64 tests passed across five files against the already-built API. Same suites and configuration as the root integration command.  |
| `pnpm.cmd test:guard`                                                       | 7/7 passed. The publication guard is a separate staged-content check.                                                               |

The ordinary unit command initially passed 82 tests but failed overall because a fork worker timed out before starting the Workspace DOM suite. Retrying the complete suite with Vitest's thread pool passed all 96 assertions; configuration and test assertions were unchanged.

The initial full integration command passed 63 tests but failed the real-process restart readiness wait. An isolated retry reproduced that timeout. A disposable diagnostic observed the same API reach HTTP 200 readiness after 7.9 seconds, beyond the test's roughly five-second polling allowance, with no stderr output. The test now uses a 15-second wall-clock deadline, requests bounded to at most one second, safe status-only diagnostics, and a 45-second limit for the complete two-start lifecycle. All original bootstrap, persisted-session, and cleanup assertions remain. The isolated restart test and the complete 64-test suite then passed. Production startup behavior was unchanged.

Authorization, cross-team/kind/version rejection, immutable snapshots, concurrent replay, audit rollback, unknown schemas, and dependency revocation/transfer races are integration/DOM evidence. They are not inferred from screenshots.

## Real browser acceptance

Playwright CLI 0.1.21 and Chrome used API port 3002 and Vite port 5184 with a unique local `ark_test` schema and fictional identity data. No development account was created.

1. Created a Workspace and Agent through the UI, then a Flow with two stages: text input → Plan JSON output → Build text output. Both stages initially pinned Agent revision 1.
2. Compared all 22 input/textarea/select values before saving and after a full reload. Names, description, Workspace/Agent pairs, port types, and exact source references were equal.
3. Moved the consuming stage before its producer. Save was rejected with field validation; the draft and original source reference remained. Restoring the valid order saved successfully.
4. Edited the Agent to revision 2 in a separate tab. Reloading the Flow retained both revision-1 pins. Explicitly upgrading only stage 1 saved a new Flow revision, and a full reload retained stage 2 at revision 1.
5. Saved competing edits in two tabs. The stale save received a conflict, retained its draft, and loaded the current saved definition only after explicit discard confirmation.
6. Simulated offline access during a save. The draft survived; restoring connectivity and manually retrying saved revision 5. A full reload retained that result.
7. Dirty navigation displayed the Flow-specific stay/discard dialog. Stay retained the draft; discard returned to the list without overwriting the saved definition. Reopening confirmed the saved value.
8. Visually inspected full desktop (1440×1000 viewport) and mobile (390×844 viewport) captures. Controls remained readable and stacked on mobile; measured document width equaled viewport width at both sizes.
9. Reviewed console history from all three tabs. Only deliberately triggered HTTP 409 and offline network errors appeared, alongside normal React development information. No unexpected application errors or warnings were observed.

One script initially waited for the reload status `All changes saved` after an update, which correctly displays `Saved revision 2.` instead. Inspecting that state confirmed the save succeeded; subsequent checks waited for the appropriate status. A native-confirm handler also completed before the CLI's extra dialog command; the following snapshot and persisted revision confirmed recovery completed. These were walkthrough synchronization details, not application failures.

Screenshots and transient browser logs remain ignored under `output/playwright/` and `.playwright-cli/`. This was an interactive acceptance walkthrough, not a committed browser regression suite, exhaustive accessibility audit, or production deployment check.

## Database and cleanup

Migration 004 was already applied on September 28. The resumed read-only check confirmed `ark_app`, PostgreSQL 17.11, four migrations, and zero development users, Workspaces, Agents, or Flows. Compose remained healthy on 127.0.0.1:5434. Existing development data and Docker volumes were preserved.

The abandoned September 28 browser schema was identified uniquely using its fictional organization/account and exact Workspace/Agent IDs, rechecked under transaction locks, and removed. The new browser fixture was independently identified by its organization, account, team, and all three catalog IDs before shutdown. Chrome and both exact QA server sessions were closed. The new fixture's SIGINT cleanup succeeded: its schema was absent and ports 3002/5184 had no listeners. A final October 1 read-only check again found four migrations and zero development users/catalog records. No other schema, database, or volume was removed.

## Publication and next step

Base commit: `5048b079a35db27f57f4d8331f0ae344cd2c342a`. Origin was fetched again on October 1 and matched that base, with no remote divergence. All 58 selected source/test/documentation files passed manual public-content review and `pnpm.cmd check:staged`; the installed commit hook also passed. Whitespace checks passed, and all 38 public Markdown files had valid local links. Credentials, private planning, browser logs, and screenshots remained ignored.

Implementation commit `3374c32e02833c5de190c8e38c87ca7781fd4349` (`feat: add versioned ordered Flow catalog`) was pushed to `origin/main` without force. A fresh `git ls-remote origin refs/heads/main` returned the same full SHA as local HEAD, and the working tree was clean. This follow-up documentation change records that completed publication, without claiming that a commit can contain its own hash.

Next: history browsing and restore as a new immutable revision, with current authorization, expected-revision checks, and fresh Flow dependency validation. Keep archive/templates separate. The JSON references currently have no relational edge table; future archive, transfer, and deletion must account for inbound references explicitly.

To use the increment locally after pulling, keep the existing `.env` and volume:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

See the [Flow guide](../learning/09-flows.md) for a worked configuration example.
