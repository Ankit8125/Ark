# Dispatch approval and compute grants: verification

Recorded 2026-10-24 (Asia/Kolkata). [Current progress](README.md) · [Contract](../findings/runner-compute-controls.md)

## Purpose and implementation

Continue the [October 20 contract checkpoint](2026-10-20-03-compute-controls.md) from synchronized commit `fcd4332`. Implementation resumed after usage interruptions on October 21 and 24. Admin approval enables a runner for future work, while explicit per-user grants control who may use it. Every user, including an admin, needs a grant. Current role, enabled user state, and organization/team membership narrow the permission; retained grants can regain effect when eligibility is restored. Health, capacity, compatibility, and execution remain separate.

- Shared runner schemas add strict approval/grant mutations, admin grant rosters, and personal-use assessments. Machine authentication retains its separate realm.
- Additive migration `007_runner_compute_controls.sql` adds default-false approval and a composite-owned grant table. Previously applied migrations remain unchanged. Runtime privileges are SELECT/INSERT/UPDATE only.
- The API holds current actor and eligible-recipient locks before the runner lock, rechecks expiry after waits, and persists permission, lifecycle revision, and safe audit together. Exact revisions precede new-control no-ops. Revocation atomically clears approval; grants remain recorded but ineffective. Personal access reads current eligibility and permissions in one SQL snapshot, never an execution ticket.
- Compute adds on-demand access panels, exact runner/member confirmation, personal permission, paginated admin grants, and explicit refresh after stale or uncertain writes. Restricted data clears on access/session/team loss. A recipient becoming ineligible returns a refreshable roster error without incorrectly demoting the current admin.
- The [compute guide](../learning/14-compute-controls.md), runner/architecture guides, README, contributor instructions, roadmap, and focused findings explain the new controls and their execution boundary.

## Checks actually completed

| Check | Result |
| --- | --- |
| Shared build and focused runner contract tests, October 20 | 10/10 passed |
| `pnpm.cmd db:prepare`, October 20 | Migration count 6 to 7; users/resources/versions/runners unchanged at zero; restricted `ark_app`, grant-table SELECT/INSERT/UPDATE allowed and DELETE denied |
| `pnpm.cmd build`, October 24 | Passed; existing main-bundle size warning at approximately 503 kB; Compute remains lazy-loaded |
| `pnpm.cmd typecheck`, October 24 | All packages and root test TypeScript passed |
| `pnpm.cmd lint`, October 24 | Passed after moving a test-harness setter assignment into an effect |
| New PostgreSQL compute-control integration file | 25/25 passed in 45.12 seconds |
| Two focused Compute DOM/API files | Restricted-launcher worker startup failed before test discovery; outside-launcher recovery passed 80/80 in 45.98 seconds |

Ignored logs are under `output/playwright/compute-*-20261024.log`. Full unit/integration suites were intentionally not repeated, following the user's request for focused checks. The previous [runner acceptance](2026-10-20-01-runner-enrollment.md) remains the broader regression baseline. Build preceded the final recipient-error UI correction; the focused DOM tests, lint, and strict type checks cover that correction. No new dependencies were added.

## Browser acceptance and limits

The Playwright CLI walkthrough used a generated `ark_test` schema, API/control ports 3002/3003, UI port 5184, and a real foreground heartbeat process. Separate browser identities exercised the owner/admin and a granted developer.

- Setup, enrollment, and real heartbeats produced Enrolled/Online. The admin initially had no grant. Cancelled approval made no change; confirmed approval alone still left personal use disallowed.
- The owner grant committed while its browser response was deliberately dropped. Approval, grant, and revoke actions stayed blocked until Refresh reconciled the saved grant and current revision. Explicit owner and developer grants persisted across reload.
- Withdrawing approval suspended personal use while preserving both grants and heartbeats. Reapproval restored permission. After stopping the foreground process, health naturally became Offline while the explicitly granted permission remained Allowed; no timestamp was manufactured.
- A separately signed-in developer saw only personal permission, no enrollment or administrative controls. The developer's direct roster read returned 403.
- Revocation persisted unapproved state and ineffective retained grants. The developer's next personal read became Not allowed. The admin could still remove its retained grant after revocation; final persisted lifecycle revision was 9, with the developer grant retained and owner grant removed.
- Desktop 1440x1000 and mobile 390x844 screenshots were inspected for readable controls, identifiers, and statuses. Document widths of 1425 and 375 respectively fit the viewports. An initial QA assertion incorrectly required equal widths despite the scrollbar; correcting it to reject only excess width required no product change.

Console review showed the deliberate dropped-response error, the separate unauthenticated browser's expected initial 401, ordinary React development messages, and the masked-input informational note. No unexpected application error was observed. One CLI action used an obsolete element reference after a successful refresh; it performed no mutation and was repeated with a fresh snapshot. Browser acceptance is an interactive walkthrough, not a browser regression suite or full accessibility audit. No execution, provider call, or deployment occurred.

## Cleanup, review, and Git

The owning QA helper stopped the runner and removed only `ark_test_a1ba60d043f3362aeeb0`. Both named browser sessions closed. The UI process was identified by its exact Vite command line and port before stopping it. Independent queries verified the fixture absent, ports 3002/3003/5184 closed, and development counts preserved: restricted `ark_app`, seven migrations, zero users/resources/versions/runners. Grant-table SELECT/INSERT/UPDATE remained allowed, DELETE denied. Environment files and database volumes were preserved. QA scripts, logs, and screenshots remain ignored.

Independent review found no backend authorization/locking defect. Frontend review identified and corrected the recipient-ineligibility error handling; the passing focused DOM run includes its regression case. All 31 source/test/documentation files were explicitly staged and reviewed. Staged whitespace checks, 166 local links across 15 Markdown files, confidential-content review, and `pnpm.cmd check:staged` passed. No environment, private research, credentials, database data, or QA artifacts were staged. The guard is heuristic and supplements manual review. The feature commit is identifiable with `git log -- notes/progress/2026-10-24-01-compute-controls.md`; its base is `fcd4332`.

The bounded compute-control increment is accepted locally. Together with the previous runner acceptance, this completes the planned local V0.3 milestone. Full regression suites were intentionally skipped as recorded above; this is not a claim of a production-ready execution system.

## Next bounded step

Define the V0.4 durable session orchestration contract with a deterministic stub: idempotent start/events/completion, replay, exclusive ownership, uncertain recovery, and cancellation. Establish its acceptance cases before implementation. Repository commands and model calls remain later milestones.
