# Local runner enrollment, heartbeat, and revocation

Recorded 2026-10-20 (Asia/Kolkata). [Current progress](README.md) · [Contract](../findings/runner-enrollment.md)

## Purpose and current status

Continue the first bounded V0.3 increment from local template commit `37571f5`. A team admin issues a ten-minute enrollment code; a foreground process exchanges it for its own credential and sends authenticated heartbeats. Team members can read registration and health metadata. A team admin can revoke the identity permanently. This connects a local process to the control plane; dispatch approval, grants, capacity, jobs, repository commands, containers, and model calls remain separate work. Full V0.3 is not complete.

The bounded enrollment/heartbeat/revocation increment is verified locally. All 166 integration tests and 281 distinct unit/DOM cases passed across the full and targeted runs, including the user's final 42/42 Compute rerun. Browser acceptance and exact fixture cleanup completed. Work resumed after October 15–16 usage interruptions. Earlier interrupted suite output was unavailable on October 20, so the resumed checks saved ignored local logs. The user subsequently requested no more time-consuming suite runs, then explicitly authorized the browser walkthrough, cleanup, and reviewed commit. No further suites were launched by the agent after that instruction.

## Files and behavior

- `packages/contracts/src/runners.ts` defines strict human/machine requests, distinct credential realms, exact token length/UUID pairing, public metadata, and timing constants. Only hashes reach storage.
- `packages/db/migrations/006_runner_enrollment.sql` adds team-owned runner state outside immutable catalog versions. Runtime privileges permit SELECT/INSERT/UPDATE and prohibit deletion. Migration 006 was already applied when inspected; it was preserved unchanged.
- `apps/api/src/runners.ts` and `runner-routes.ts` implement current explicit team-admin checks, one-use enrollment, replay of identical uncertain requests, issuer checks before consumption, server receipt-time heartbeats, derived offline state, lifecycle conflicts, atomic safe audits, and revocation. Host/Origin/JSON guards continue to apply. Human cookies and runner credentials cannot substitute for each other.
- `apps/api/src/identity.ts` checks wall-clock expiry and rechecks a locked session after membership waits; runner issue/revoke recheck again after runner/unique-key waits. Holding a lock cannot preserve an expired session's permission to mutate runner state.
- `apps/runner/` adds a foreground CLI with hidden or piped stdin, memory-only credentials, redirect refusal, request timeouts, bounded retries, cancellation, and sanitized status output. An uncertain enrollment retains its candidate identity while heartbeat recovery is temporarily unavailable. Input cleanup handles closed streams and terminal restore failure without exposing the code.
- `apps/web/src/features/compute/` and `Shell.tsx` expose admin enrollment/revoke and member reads. Codes are masked, remain in memory, retire after consumption/revocation, and clear on access/session/team loss. Retry preserves an uncertain issue's identity. Callback identity changes no longer interrupt reads or pagination. Read-only registration, health, and dispatch approval are separate fields.
- Guard rules detect literal runner credentials/enrollment codes without printing them. Regression tests cover backend roles/isolation/locks/replay/rollback, strict contracts, client recovery, hidden input, UI recovery, and guard behavior. Existing identity/catalog tests account for migration 006.

## Verification evidence

Earlier completed checks: production build, lint, strict type checks, 10 guard tests, 35 runner client tests, 7 focused runner schema/header tests, and the real `pnpm.cmd runner:local --help` command passed. The production build reports a main chunk slightly above 500 kB; the Compute page is already lazy-loaded. This is a size warning, not a failed build.

October 20 results are saved under ignored `output/playwright/runner-*-20261020.log`:

| Check | Actual result |
| --- | --- |
| `pnpm.cmd lint` | Passed, exit 0 |
| `pnpm.cmd typecheck` | All five packages and root test TypeScript passed, exit 0 |
| `pnpm.cmd test:guard` | 10/10 passed |
| Full PostgreSQL integration suite with threads and one worker | 166/166 passed in nine files |
| Full unit/DOM suite with threads and one worker | 199 passed in 18 files; Compute and CatalogHistory workers timed out before discovery, exit 1 |
| Targeted Compute + CatalogHistory recovery | 80 passed, two failed, exit 1; CatalogHistory passed all 40 cases |
| User-run final Compute check after fixture correction | 42/42 passed in one file; user supplied Vitest output, start 04:54:32, duration 18.87 seconds |

The two recovery failures used a fixture named `Private runner` and asserted that this substring was absent after access denial. The generic success-of-clearing explanation itself contains that phrase. The same test output confirmed that the enrollment code, runner input, and private list were cleared. The fixture and absence assertion now use `Confidential build host`, keeping the protection check while avoiding the explanatory-text collision. The user reran the corrected Compute file and supplied its 42/42 passing result. All 281 distinct unit/DOM cases are now covered by passing results: 199 from the full run, 40 CatalogHistory cases from recovery, and 42 Compute cases from the final user run. This is not a claim of one uninterrupted full-suite pass. The recovery log also contains React `act(...)` warnings; these were not counted as successful browser acceptance.

The user completed this focused command; another suite run is not needed for the test-only correction:

```powershell
node node_modules/vitest/vitest.mjs run apps/web/src/features/compute/ComputePage.test.tsx --pool=threads --maxWorkers=1
```

## Browser acceptance

Playwright CLI used the real API, PostgreSQL fixture, and a real foreground runner process. A loopback-only, authenticated QA helper piped the browser's code directly into the CLI's stdin; no code or runner credential was printed or persisted. Hidden terminal input has separate unit evidence; the browser walkthrough used the supported stdin pipe.

- A fictional owner/organization/team was created through setup. Compute showed its empty state and rejected an empty runner name.
- The first issue request committed but its browser response was deliberately dropped. Retry sent identical identity/name/code, kept the name locked during uncertainty, and produced one registration. The confirmed code was masked and absent from browser storage.
- A real CLI process enrolled and sent heartbeats. Attempting revocation from the older pending view received the expected lifecycle conflict. Refresh displayed Enrolled/Online and removed the consumed code.
- Restarting the QA API preserved the same running identity. A later heartbeat advanced the timestamp without changing the lifecycle revision. After stopping that process, an ordinary server read naturally became Offline after the 60-second threshold; no timestamp was modified to manufacture that state.
- A second real runner became Online. Hard reload preserved both registrations and did not recover enrollment secrets. Cancelled revocation kept the runner active. Confirmed revocation persisted across reload, retained its historical heartbeat, changed health to Unknown, and removed its revoke action. The process received authentication rejection and exited with code 1.
- A deliberate offline runner-list read retained loaded rows. Restoring network access and retrying recovered successfully, with the revoked heartbeat unchanged.
- Desktop 1440x1000 and mobile 390x844 screenshots were visually inspected. Labels, status, identifiers, forms, and actions remained readable; measured document widths equaled viewport widths at 1440 and 390 pixels.

Console review found the deliberate dropped response, stale 409, offline read, ordinary React development messages, and Chrome's informational note about a masked read-only field outside a form. No unexpected application error was observed. A CLI script yielded early at a confirmation dialog; its handler continued, and independent post-dialog UI/process assertions confirmed completion. An earlier automatic approval-review usage-limit failure was resolved by the later authorized walkthrough; the blocked attempt itself was never counted as evidence.

This is an interactive acceptance walkthrough, not a browser regression suite or full accessibility audit. No job, repository command, container workload, model call, or deployment was performed.

## Data preservation and cleanup

The October 20 read-only development check confirmed restricted `ark_app`, six migrations, zero users/resources/versions/runners, and SELECT/INSERT/UPDATE-only runner grants. Counts match the saved baseline. The earlier browser fixture `ark_test_258dc4f2e59154cfa013` was locked and positively checked to contain zero users/resources/versions/runners, then only that empty generated schema was removed.

A fresh browser fixture, `ark_test_b4181b5db33af923cd61`, held the fictional owner/organization/team and two runner registrations. Its owning helper stopped the test runner and removed only its generated schema. The named `ark-runners` browser closed. The UI process was identified by its exact Ark Vite command line and port before shutdown. Independent queries confirmed both identified runner QA schemas absent, ports 3002/3003/5184 closed, and development counts unchanged at zero users/resources/versions/runners with six migrations and restricted runner grants. Environment files and database volumes were preserved. QA scripts, screenshots, and logs remain ignored under `output/playwright/` and `.playwright-cli/`.

## Review, Git, and next bounded step

An independent final read-only review covered contracts, migration/grants, API authorization and lifecycle locking, CLI credential handling/recovery, Compute/Shell, guard changes, and synthetic fixtures. It found no actionable defect or confidential content. All 42 source/test/documentation files were explicitly staged and reviewed. Staged whitespace checks, 129 local links across 13 Markdown files, and `pnpm.cmd check:staged` passed. The first guard attempt identified a synthetic credential-bearing URL in a negative test; its dummy password was changed to the explicit `REPLACE_PASSWORD` placeholder, retaining the same nonempty-password rejection case. This fixture-only spelling change was not used to justify another suite run. No environment, private research, logs, QA artifacts, database files, or credentials were staged. The guard is heuristic and supplements manual review.

This record belongs to the runner feature commit, identifiable with `git log -- notes/progress/2026-10-20-01-runner-enrollment.md`; its base is `37571f5`. No push or deployment was requested or performed.

Next define dispatch approval and explicit compute grants, including current authorization, revocation, and stale-mutation semantics, before implementation. Enrollment and online health alone must never grant execution authority. Session orchestration and repository/model execution remain later increments. The user requested no repeated long suites without a new implementation change or unresolved concern.
