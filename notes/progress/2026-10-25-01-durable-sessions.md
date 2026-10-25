# V0.4 deterministic durable sessions

Recorded 2026-10-25 (Asia/Kolkata). [Current progress](README.md) · [Contract](../findings/durable-sessions.md)

## Purpose and scope

Continue from accepted/published compute-control commit `1db9db6`. V0.4 introduces real durable session orchestration around a pure deterministic stub: immutable resource pins, validated inputs, queued work, explicit runner opt-in, exclusive leases, idempotent progress, event replay, cancellation, and uncertain-work recovery. It does not execute repository commands or agent instructions, contact providers, or produce quality/test success evidence.

The [contract](../findings/durable-sessions.md) was recorded before implementation. Shared schemas and pure typed-binding/stub helpers are defined in `packages/contracts/src/sessions.ts`; additive migration `008_durable_sessions.sql` defines session state, immutable pinned inputs/snapshots, exclusive active-or-uncertain runner leases, and append-only event/receipt storage. Existing migrations remain unchanged.

## Implemented data flow

The Sessions draft selects one saved Flow version, a runner, and actual typed values. Read-only Preview validates admission and copies the pinned definitions. Explicit Queue saves the immutable request/snapshot, session, first event, and safe audit atomically. An opted-in foreground runner claims one persisted assignment, evaluates pure ordered stub stages, and sends receipts. The API checks current permission, lease/revision, bindings, and expected output before saving progress. The browser reads saved detail and a replayable journal independently of the runner process.

- Shared contracts own strict requests/responses, text/JSON limits, normalized UUIDs, snapshot consistency, and pure stage/final binding helpers.
- Migration 008 adds `execution_sessions`, `session_leases`, and `execution_events`, immutable snapshot enforcement, composite ownership, and an exclusive runner index covering active and uncertain leases. Previously applied migrations were preserved. Runtime events are SELECT/INSERT only; sessions and leases permit UPDATE but never DELETE.
- `apps/api/src/sessions.ts` and session routes implement preview/start/read, claim/progress receipts, cancellation, reconciliation, pagination, and finite SSE. Identity locks precede runner/session/lease locks. Current authorization is rechecked after waits and on receipt replay; an expired/unauthorized replay returns uncertain state without duplicating the original result. An ineligible queued starter cannot starve later authorized work. Cursor parsers reject final line terminators.
- A separate engine expires leases without releasing uncertain ownership. `pnpm.cmd dev` starts API, engine, and web. The runner's `--stub-sessions` flag enables work alongside its existing heartbeat loop; default operation remains heartbeat only. Claim/event identities survive response loss in memory, and shutdown uses a bounded independent stopped-acknowledgement window.
- The lazy Sessions UI provides typed preview/queue, immutable uncertain retries, saved pins/results, validated SSE replay, finite-stream reconnect, cancellation, and explicit admin reconciliation. Losing admission permission preserves readable sessions. Terminal detail transitions drain the durable journal before claiming history is current; failed tail reads remain retryable. Navigation protects drafts and warns that an uncertain queue request may already have saved work.
- README, contributor instructions, architecture/roadmap, findings, and the [session guide](../learning/15-durable-sessions.md) describe the new workflow and its limits. Agent instructions/capabilities remain inert.

## Checks actually completed

| Check | Result |
| --- | --- |
| `pnpm.cmd db:prepare` | Migration count 7 to 8; restricted development role and zero existing records preserved |
| Shared schemas and `tests/unit/sessions.test.ts` | 7/7 contract cases passed |
| Changed runner client and new worker files | 38/38 client and 18/18 worker cases passed |
| Sessions DOM file | 35 distinct cases passed across focused runs: initial 32, two admission-loss regressions, then four related terminal/replay cases including the new tail regression |
| Sessions PostgreSQL integration file | 32 distinct cases passed across focused runs: initial 26, two repaired HTTP SSE checks plus two receipt regressions, strict-cursor case, and queued API-restart case |
| `pnpm.cmd build` | Passed after final source corrections; existing main-bundle warning at about 505 kB, Sessions remains lazy-loaded |
| `pnpm.cmd typecheck` | Passed across packages and root tests; final build covers subsequent application edits and final test TypeScript was also checked separately |
| `pnpm.cmd lint` | Passed without warnings |

There are **130 distinct focused cases** across those files, not a claim that a full regression suite ran. Full unit/integration suites were deliberately skipped at the user's request. Earlier [V0.3](2026-10-24-01-compute-controls.md) and catalog evidence remains the broader baseline. No dependencies were added.

Initial integration results were 26/28: the two stream fixtures used `fetch`, whose Host handling did not preserve the explicit allowlist header on an ephemeral listener. Native HTTP with an explicit Host fixed the fixture without loosening production checks; both cases passed. One initial worker retry test aborted its mock delay before the intended lost-response retry; correcting that harness produced 18/18. Windows Vitest thread workers also timed out before DOM discovery on recovery attempts. Standalone DOM runs passed 32 and then two cases; a single-fork recovery passed the four final related cases. These startup failures are not passing-test evidence. Ignored logs remain under `output/playwright/sessions-*-20261025.log`.

## Browser acceptance

The Playwright CLI walkthrough used one generated `ark_test` schema, API/control ports 3002/3003, UI port 5184, a real reconciliation engine, and a real opt-in foreground runner with memory-only credentials. Disposable Workspace/Agent/Flow configuration was saved through ordinary APIs; Sessions interactions used the UI.

- Preview saved no session. Dropping an already-committed Start response locked the original draft; **Retry same queue request** recovered exactly one completed two-stage session with one creation event. Typed outputs, pins, `not_evaluated`, and reload persistence were checked.
- A twenty-stage session survived API and engine restarts with one claim, twenty stage events, and 23 total events. A transient 502 during the outage caused the documented manual reconnect state; reconnect restored all 23 UI journal rows. Separate integration coverage also recreated the API before a queued claim and after saved stage progress, preserving start/receipt replay.
- Browser resource timing confirmed finite two-second QA streams reconnecting at advancing saved cursors. The ordinary Playwright request observer omitted EventSource requests; resource timing resolved that harness false alarm. UI replay retained one row per durable event.
- While a twenty-stage session held the runner, a second session remained queued and cancelled without a claim. Active cancellation produced `cancelling`, then `cancelled` after stopped acknowledgement, with no final outputs.
- Abruptly stopping the disposable runner after stage one produced natural 45-second expiry: session `blocked`, reason `lease_expired`, lease `uncertain`, no final outputs. The waiting session had no lease. Reconciliation was disabled before revocation, and again until explicit stopped confirmation. Revoking the already-stopped runner and confirming through Sessions yielded `failed` and released every held lease. Remaining queued work was cancelled.
- After the terminal-tail correction, the recovered session displayed all five persisted events before reporting its history up to date. All fixture sessions were terminal before cleanup.
- Desktop 1440x1000 and mobile 390x844 screenshots were inspected, including the recovery detail and mobile navigation drawer. Document widths 1425 and 375 fit their viewports; labels, identifiers, and controls remained readable.

The console contained the deliberate dropped-response error, the restart's transient 502, and normal development messages; no unexpected application exception was observed. Some walkthrough attempts used a wrong option value, an old status label, an observer that omitted SSE, or read the list before a creation response completed. These were corrected in ignored QA helpers; they do not establish additional product failures. Browser evidence is an interactive walkthrough, not a browser regression suite or full accessibility audit.

## Cleanup, review, and Git

The owning helper removed only `ark_test_7d92de35dfcd50186742` and stopped its runner, API, and engine. The named browser closed; the UI process was identified by its exact Vite command line before stopping it. Independent checks verified that schema absent and ports 3002/3003/5184 closed. Development state stayed at restricted `ark_app`, eight migrations, and zero users/resources/versions/runners/grants/sessions/leases/events. New table privileges were checked again. Environment files, private research, and database volumes were preserved. QA helpers, logs, and screenshots remain ignored.

Independent backend and frontend reviews produced the receipt-authorization, strict-cursor, and terminal-tail corrections above. All 43 source/test/documentation files were explicitly staged and reviewed. Staged whitespace, 163 local links in 11 Markdown files, confidential-content review, and `pnpm.cmd check:staged` passed. No environment, private research, credentials, database data, or QA artifacts were staged. The guard is heuristic and supplements manual review. The feature's base is `1db9db6`; this record's feature commit is discoverable with `git log -- notes/progress/2026-10-25-01-durable-sessions.md`. Authorized synchronization fetches/inspects the destination, preserves remote work, pushes without force, and compares remote/local HEAD afterward.

## Result and next bounded step

The bounded V0.4 increment is accepted locally, including functional checks, browser acceptance, cleanup, and staged review. This completes only deterministic orchestration. There is no repository checkout, command/container execution, model call, quality verdict, deployment, or publication workflow.

Next define the bounded **V0.5 isolated repository preparation and real-command contract** before implementation: exact source revision, checkout/path ownership, exclusive workspace/process cleanup, real reports, and explicit non-pass when tests are absent. Keep saved configuration, process status, and quality evidence distinct.
