# Durable sessions with a deterministic stub

Recorded 2026-10-25 (Asia/Kolkata). [Learning index](README.md) · [Contract](../findings/durable-sessions.md) · [V0.4 progress](../progress/2026-10-25-01-durable-sessions.md)

V0.4 is verified locally in the [October 25 record](../progress/2026-10-25-01-durable-sessions.md). Across recorded runs, 130 distinct focused cases passed: seven contracts, 38 runner-client, 18 worker, 35 Sessions DOM/API, and 32 API integration cases. Broad suites were not repeated.

Browser acceptance covered lost-start replay, a 20-stage session across API/engine restarts, finite SSE replay, queued/active cancellation, natural 45-second lease expiry, revoked-runner admin reconciliation, and desktop/mobile layouts. The exact disposable schema was confirmed absent and test ports closed. Development checks retained restricted `ark_app`, eight migrations, and zero observed application-record counts. The dated record preserves the detailed evidence and limits.

A saved Flow is a reusable recipe: it declares typed inputs, ordered stages, and pinned Workspace/Agent versions. A session is one saved use of that recipe with actual input values and a selected runner. It copies the selected definitions so later catalog edits or archival cannot silently change an already queued session. Flows can have different stage names, lengths, and bindings; the session follows the chosen Flow rather than a fixed product-wide sequence.

The current runner evaluates only `stub.v1`. It resolves the declared input bindings and produces predictable placeholder values. It does not read a repository, execute Workspace actions or Agent instructions, run commands/containers, call a model, or publish a change. Session quality remains `not_evaluated`, including when its state is `completed`. That completed state means the deterministic protocol finished; its outputs do not establish passed tests or real agent work.

## Prepare the local processes

Keep the existing `.env` and its matching database volume. From the project root in PowerShell:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

`db:prepare` explicitly applies migrations through **008**, which adds durable session storage. The API never migrates at startup. `dev` builds shared packages and starts the API, a separate lease-reconciliation engine, and the web UI. PostgreSQL remains the authoritative queue, session store, and journal. No new dependency, Temporal service, or other external workflow service is needed.

In **Compute**, a current team admin issues a new enrollment code. Start a separate foreground runner that explicitly accepts stub work:

```powershell
pnpm.cmd runner:local --stub-sessions
```

Enter the enrollment code at the hidden prompt. Keep the process open. Its machine credential and work tokens remain in process memory; restarting needs a fresh registration and enrollment. Use `pnpm.cmd runner:local` without the flag when you want the existing heartbeat-only behavior. A heartbeat-only runner does not claim queued sessions.

After enrollment, an admin separately approves the runner and grants your own account use. Admin status supplies no automatic use grant. Your account must currently be an enabled admin/developer in the selected team, with active organization/team memberships. The [runner](13-local-runners.md) and [compute-control](14-compute-controls.md) guides cover those earlier steps.

## Preview and queue a saved recipe

1. Open **Sessions** in the intended team. Admins/developers see the queue draft; reviewers/viewers can read saved sessions.
2. Explicitly select an active saved **Flow version**. Its revision and version ID are displayed. This screen initially offers each active Flow's current saved version; it does not silently upgrade a pin while you type.
3. Select an enrolled, approved, unrevoked **Runner** for which your own use grant is allowed. Health is separate: offline work may queue and wait for an opted-in foreground process.
4. Fill every declared input using its displayed name and type. Text allows at most 4096 characters. JSON must parse as bounded JSON with at most 4096 UTF-8 bytes, 256 nodes, and 12 levels. The full typed values object is bounded to 8192 bytes. The server independently enforces exact input names/types and all bounds.
5. Choose **Preview**. It checks current authorization, pins, compatibility, and values, then shows the pinned Workspace/Agent versions and stage count. It saves no session and reserves no runner capacity.
6. Choose **Queue stub session** to save the immutable snapshot and initial event atomically. Admission and later claim recheck current permission; a preview is an observation rather than a permission ticket.

```text
Saved Flow version + runner + actual typed inputs
  -> Preview: read-only validation and snapshot display
  -> Queue: saved session + immutable definitions/inputs + first event
  -> Runner claim: one held reservation for that runner
  -> Ordered pure stub stages: resolved bindings -> saved stage outputs
  -> Final output bindings -> completed protocol, quality not_evaluated
```

The browser generates the session creation UUID before sending Queue. If its response is lost, keep the open draft and choose **Retry same queue request**. The identity, pins, runner, and values remain the same; fields stay locked while that outcome is uncertain. The navigation guard protects the open draft, and reloading can still discard its in-memory request. A confirmed start clears the draft and opens the saved session. A definite validation/conflict error requires a fresh preview after correction. Do not invent a second creation ID to retry an uncertain request.

## Follow progress and events

Select a saved session to inspect its exact resource version IDs, starter, runner, state/revision, stage results, final outputs, and durable event log. Current team members can read these contents; broader resource-sharing policy remains future work. Saved session lists page 50 summaries at a time, and event-log requests page up to 100 events.

Live SSE events carry a cursor bound to the selected session and sequence. The UI checks the event schema/identity and deduplicates replay. Reconnecting resumes from the last verified sequence. The server rechecks the current human session before each batch/keepalive. Losing access clears private session data and closes the stream; signing in again or refreshing team access cannot rely on the old connection.

Streams have a bounded lifetime. A connection error triggers a fresh detail read so the UI can distinguish access loss from a temporary connection problem. Successful access checks allow bounded delayed reconnects; offline checks leave clear manual refresh/reconnect controls. A terminal session, changing the selected session/team, or leaving the page closes the previous stream. If detail becomes terminal before its final stream events arrive, the UI drains bounded HTTP journal pages from the last verified cursor before reporting that saved history is up to date. A failed or incomplete catch-up remains visibly retryable. **Refresh session** reads saved detail; **Refresh event log** reads the durable journal independently of the live connection.

## Understand ownership and permission

| Observation                | Meaning                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| Online runner              | A registration heartbeat arrived recently; it does not prove work permission or a free reservation. |
| Approved runner            | An admin enabled dispatch; each starter still needs their own grant and eligible current role.      |
| Queued session             | Its snapshot is saved and awaits a compatible opted-in claim.                                       |
| Running session            | A runner holds an active work lease and is progressing through the saved stages.                    |
| Blocked session            | Work needs recovery; an uncertain reservation stays held.                                           |
| Cancelling session         | Cancellation was requested, but held work must confirm it has stopped before release.               |
| Completed/failed/cancelled | Terminal protocol state; the session never reopens in place.                                        |

A work lease lasts **45 seconds**, measured by database time. Accepted stage progress renews it; the runner's 15-second registration heartbeat does not. Capacity is **one held session per runner**, counting both active and uncertain leases. The reconciliation engine marks an expired lease uncertain and blocks the session, or preserves `cancelling`; it does not free the slot just because time passed. This is logical ownership, not filesystem or container isolation.

Claim and ordinary progress/completion recheck the original starter's enabled identity, active organization/team memberships, admin/developer role, and explicit runner grant, as well as the runner's current authority. Logging out of that person's browser alone does not stop durable work. Removing their eligibility/grant or withdrawing runner approval prevents ordinary progress. A still-authenticated matching runner can acknowledge it has stopped for recovery even after ordinary use permission is withdrawn. A revoked runner credential is denied.

Claim IDs and worker event IDs support identical replay after response loss. Changed details under the same identity conflict; stale revisions, wrong generations, or ordinary late results cannot replace current ownership. There is no automatic new stage attempt in this increment. A fresh session represents a later run after the old ownership is resolved.

## Cancel or recover work

A current team admin or the currently eligible starter can request cancellation. Confirm the selected saved session. **Queued** work cancels immediately. Work with a held active/uncertain lease enters **cancelling** and keeps that reservation until the runner sends explicit stopped acknowledgement. The same stopped confirmation releases blocked work as failed, or cancelling work as cancelled. A late stage/completion response can be retained as recovery evidence; it cannot convert an expired lease into normal success.

If the foreground process or its memory-only credential is lost:

1. Stop the stub process and establish that it has stopped. Do not infer this from offline health alone.
2. In **Compute**, a current team admin revokes the affected runner registration.
3. Return to the blocked/cancelling saved session and choose **Refresh session** to recheck the runner observation.
4. Choose **Reconcile stopped stub**, explicitly confirm that the deterministic stub has stopped, then confirm reconciliation.

The backend independently requires current admin authorization, the current session revision, a revoked runner, and `confirmedStopped: true`. Successful reconciliation releases the retained reservation and ends the session as failed/cancelled. A stale or uncertain mutation response requires a fresh read before another decision. This acknowledgement is specific to the deterministic stub; it does not establish general cleanup of arbitrary repository processes or external effects.

The [V0.5 repository contract](../findings/repository-execution.md) and [shared planning slice](../progress/2026-10-25-02-repository-planning.md) now define explicit command intent without changing this runnable stub workflow. Actual repository fetching, source checkout, path/container isolation, command reports, model calls, approvals, and publication remain **V0.5+** work. The [planning guide](16-repository-planning.md) explains the first slice; the [V0.4 progress record](../progress/2026-10-25-01-durable-sessions.md) preserves its accepted checks and limits.
