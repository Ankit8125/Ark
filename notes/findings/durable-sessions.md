# V0.4 durable deterministic-stub sessions

Contract recorded 2026-10-25 (Asia/Kolkata). [Findings index](README.md)

## Boundary and authorization

PostgreSQL remains the authoritative queue, session state, lease store, and event journal. The API, reconciliation engine, and foreground runner have distinct entrypoints. No additional orchestration service/library is required. This increment executes only the pure `stub.v1` evaluator: no repository/filesystem access, child process, command, container, provider, secret lookup, or publication. Outputs carry `quality: not_evaluated` and cannot claim passed tests or real agent work.

A current explicit team admin/developer may preview/start a supported active Flow version using an enrolled, approved, unrevoked runner and their own explicit use grant. Online health is separate; offline work may queue. Validate exact input names/types and bounded JSON. Preview is read-only. Start atomically saves the request, immutable Flow/Workspace/Agent definitions and version references, queued state, first event, and safe audit. Identical creation IDs replay; different requests conflict. Catalog edits/archival after Start do not alter the copied snapshot or revoke permission. Current team members can read sessions and their contents; general resource sharing remains V1 work.

The starter's current enabled user, active organization/team membership, admin/developer role, and runner grant are rechecked at claim and ordinary progress/completion. The starter's browser logout alone does not stop durable work. Current session authorization applies separately to every human read, mutation, and event batch. Admins or the current eligible starter may cancel; only current team admins may reconcile uncertain work manually.

## Ownership, progress, and recovery

- Foreground runner work is explicit opt-in via `--stub-sessions`; default behavior remains heartbeat only. Machine credentials stay in memory, hash-only at rest, and separate from human cookies. Claim requests declare `stub.v1`; all pinned agents must support the existing stub runtime.
- Capacity is fixed to one held session per runner in this increment. A partial unique SQL index covers active AND uncertain leases. This is a logical runner reservation; actual checkout/path/container isolation belongs to V0.5.
- Runner generates a claim UUID and random 32-byte lease token before calling claim. Identical claim ID/token replays the saved assignment, including after response loss; changed details conflict. Persist only the token hash. Generation is 1 for this single-attempt increment; wrong generations are rejected. There are no automatic retries/new stage attempts; a fresh session represents a later run.
- A claimed session becomes running. The 45-second lease uses database wall-clock time and renews only after accepted stage progress. Runner registration heartbeats do not renew work leases. Claim, progress, cancellation, expiry, and recovery serialize in actor/recipient identity locks (when needed) -> runner -> session -> lease order. No path acquires identity locks after the runner.
- Worker event UUIDs and payloads are idempotent. Store receipt content with the lease token omitted, never its raw value. Identical replay returns current state without a second event/audit; changed payload under an event ID conflicts. Otherwise exact session revision, matching lease identity/generation/token, active unexpired lease, and current permission are required.
- Each stage resolves actual declared bindings from saved inputs/prior outputs. Server validates deterministic bounded outputs against the same pure evaluator before recording a completed stage. Normal final completion additionally requires every stage, correct final bindings, and explicit stopped confirmation. Terminal states never reopen.
- Queued cancel is immediately cancelled. Active/uncertain cancel enters cancelling and retains the lease. A matching runner may submit stopped confirmation even if approval/the starter's use permission was withdrawn; it may not submit ordinary progress. Stopped acknowledgement releases ownership and yields cancelled when cancelling, otherwise failed. Revoked machine credentials remain denied.
- Expiry marks a lease uncertain and a session blocked (or preserves cancelling). It never releases ownership or promotes a late result to success. Late stage/completion receipts can be retained as recovery evidence while work remains blocked; only stopped acknowledgement reconciles and releases. Original claim replay lets the still-running runner discover cancelling/uncertain state and stop.
- For a lost process/credential, an admin must first revoke the runner, then explicitly confirm the stub has stopped to reconcile a blocked/cancelling session. This releases ownership as failed/cancelled and audits the decision. It is not a general repository-process cleanup guarantee.

## HTTP contract

Human cookie endpoints under `/api/teams/:teamId`:

- `POST /session-previews`: `{ flow, runnerId, inputValues }` -> `{ snapshot, runnerId, inputValues }`.
- `POST /sessions`: preview fields plus client UUID `id` -> `{ session }` (201 create, 200 identical replay).
- `GET /sessions?cursor=UUID`: 50 summaries and next cursor; `GET /sessions/:sessionId`: complete pinned session and outputs.
- `POST /sessions/:sessionId/cancel`: `{ expectedRevision }`; `POST /sessions/:sessionId/reconcile`: `{ expectedRevision, confirmedStopped: true }`.
- `GET /sessions/:sessionId/event-log?after=N`: up to 100 ordered durable events, next sequence cursor.
- `GET /sessions/:sessionId/events`: SSE with optional `after=SESSION_UUID:SEQUENCE` and/or matching `Last-Event-ID`. Reject cross-session/malformed cursors. Emit `id: UUID:sequence`, `event: session`, JSON event data. Reauthorize before each batch/keepalive; no connection/transaction is held for the stream lifetime. Close bounded streams and replay on reconnect; terminal clients stop reconnecting.

Runner bearer endpoints:

- `POST /api/runner/sessions/claim`: `{ claimId, leaseToken, runtime: 'stub.v1' }` -> `{ job: { session, lease } | null }`.
- `POST /api/runner/sessions/advance`: common `{ eventId, leaseId, leaseToken, generation, expectedRevision }` plus `kind: 'stage_completed', stageId, outputs`, or `kind: 'completed', confirmedStopped: true`, or `kind: 'stopped', confirmedStopped: true` -> `{ session, lease }`.

All mutations retain exact Host/Origin/JSON requirements and the existing input body limit. No token enters URLs, events, logs, audits, or browser storage. Responses may contain larger authorized pinned snapshots; the HTTP mutation limit applies to requests, not saved definitions.

## Acceptance

Typed/bounded inputs and immutable pins; read-only preview; start replay/conflict/rollback; all role/team/org/credential boundaries; current authorization after waits and at dispatch/completion; concurrent exclusive claims; claim/result/completion response loss; wrong generations and stale revisions; natural deadline uncertainty retaining the slot; late recovery evidence; stop and manual reconciliation; cancel/complete races; queued/running API/engine restarts; ordered SSE replay and midstream authorization loss; restricted database privileges; runner retry/shutdown and memory-only credentials; UI draft/recovery, stream reconnect, cancellation/reconciliation, reload, and desktop/mobile behavior. Record actual focused checks, skipped full suites, and exact disposable-fixture cleanup before acceptance.
