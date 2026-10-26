# Repository execution admission and preparation control

Recorded 2026-10-26 (Asia/Kolkata). [Repository contract](repository-execution.md) · [Progress](../progress/2026-10-26-02-repository-execution-control.md)

## Bounded decision

An explicit saved Workspace action becomes a standalone `repository.v1` execution, bound to its immutable plan ID/digest and exact Workspace version. It does not manufacture an unrelated Flow/Agent snapshot. Current Flows describe Agent stages and typed bindings; this one-command preparation boundary executes no Agent. A future Flow command stage must bind the same Workspace pin explicitly. V0.4 Flow sessions and their public schemas remain unchanged.

Migration 010 adds `repository_executions` and generalizes the existing `session_leases` ownership table: existing leases default to `stub.v1`; repository leases reference a repository execution instead of a Flow session. A CHECK requires exactly one owner appropriate to runtime. Composite foreign keys retain runner/team/organization/Workspace binding. The existing partial unique runner index remains global across **active and uncertain leases of both runtimes**. No parallel reservation ledger is introduced.

This backend slice implements preview/Start/read/cancel, explicit repository claim, preparation-only renewal/control, durable lifecycle events, and expiry. It authorizes no command start, process success, normal completion, or reservation release. Those operations require separately bound preparation/process/cleanup receipts and the real adapter next. There is no repository CLI worker or UI in this slice; existing stub-only workers never request repository work. Synthetic API fixtures verify protocol state only, not real preparation or cleanup.

## Human API

Paths begin `/api/teams/:teamId` and retain cookie, exact Host/Origin, strict JSON, and existing body limits.

- `POST /repository-execution-previews`: `{repositoryPlanId,expectedPlanDigest,runnerId}`. Current admin/developer plus their own explicit use grant, enrolled/approved/unrevoked runner, supported plan/policy, and active supported Workspace. Read-only: no execution/lease/audit.
- `POST /repository-executions`: preview fields plus client UUID `id`; atomically save immutable admission, `queued` state, first event, safe audit; 201 new/200 identical replay. Serialize the execution UUID before catalog lookup. A changed request, creator, or tenant conflicts generically. Execution IDs belong to their respective repository/stub namespaces; claim/lease UUIDs are globally exclusive in the shared lease table. Replay uses saved data under current human authorization and grants no new execution authority; it does not revisit catalog state or add audit.
- `GET /repository-executions?cursor=UUID`: fifty metadata summaries in UUID order; `nextCursor`. `GET /repository-executions/:executionId`: full admitted plan/provenance/lifecycle, freshly authorized for current team members.
- `POST /repository-executions/:executionId/cancel`: `{expectedRevision}`; current admin or currently eligible original starter. Queued work becomes `cancelled`; held work becomes `cancelling` and retains its reservation. Lifecycle revisions reject stale mutations.
- `GET /repository-executions/:executionId/events?after=N`: up to 100 JSON lifecycle events in revision order, `nextAfter`; current team members, bounded/session-scoped cursor. No SSE/UI is added here.

Saved plan reads alone are not admission authority. New admission verifies its stored digest, same tenant, exact resource/version ownership, active valid Workspace, current starter eligibility, and current compute grant/approval. Offline queuing is allowed. Runner metadata has no verified sandbox capability: compatibility remains `pending_runner_claim` until an authenticated request explicitly declares the repository runtime/policy. Such declaration is protocol opt-in, not evidence of image availability/trust or enforced isolation. Later archive/edit does not rewrite admitted work or identical Start replay.

## Claim and immutable ownership intent

`POST /api/runner/repository-executions/claim` accepts `{claimId,leaseToken,runtime:'repository.v1',policy:'docker-linux-offline.v1'}` with the existing runner bearer realm. Use a generated UUID and 32-byte hex secret before requesting; store its hash only. Generation remains 1. Same ID/token/runner/runtime replays the same assignment; altered pairing or another runtime's claim ID conflicts. New claims select only this runner's oldest eligible queued repository execution, skipping currently ineligible starters. Actor identity locks precede runner -> execution -> lease locks; no identity lock is acquired after the runner. New stub and repository claims serialize on the same runner and share its held-slot index.

At first claim fix server timestamps: `claimedAt`, run deadline+900s, preparation deadline=min(claim+120s,run deadline-30s). Queue time consumes neither. Lease expiry=min(server now+45s, preparation cutoff). Future command phase will need verified preparation plus a separate fixed <=300s command cutoff; preparation control cannot start that phase.

The returned job includes the admitted plan, lease/generation/status/`controlSequence`, current control decision, and a version1 ownership manifest derived solely from immutable execution/lease IDs, generation, and plan digest. Resource names are `ark-repo-LEASE_UUID-g1-prep`, `...-command`, and `...-workspace`. The server's committed identity/plan binding makes this intent reproducible before effects; the later adapter must also persist its secret-free local manifest before resource creation. Names/intent do not prove a resource exists or belongs to this process. Credentials/tokens never enter manifests, labels, events, logs, or receipts.

## Preparation renewal/control

`POST /api/runner/repository-executions/control` accepts `{controlId,executionId,leaseId,leaseToken,generation:1,expectedControlSequence,planDigest}`. It has no `confirmedStopped`, command, result, path, or caller deadline fields. Strict schemas reject those additions.

Controls serialize by the lease and advance a separate monotonically increasing control sequence; they do not change the execution lifecycle revision or append ordinary lifecycle events. Persist append-only receipts without the raw lease token. Exact receipt replay never extends expiry again and returns a fresh projection of current authority/cancellation/expiry/deadlines; different content under one control ID conflicts. Wrong execution/lease/token/generation or plan binding is denied. A stale control sequence conflicts and supplies no new authority.

Fresh controls recheck enabled starter identity, active organization/team membership, admin/developer role, explicit grant, runner approval/enrollment/revocation, lease status, cancellation, preparation cutoff, and run working cutoff. Renew an active eligible preparation lease only to min(now+45s,fixed preparation cutoff,run deadline-30s). Otherwise return `stop` and preserve the reservation; expiry/deadline/permission loss makes it uncertain and records one lifecycle transition, preserving `cancelling`. Uncertainty never becomes active again. A valid exact replay performs the same fresh authority check but no renewal or duplicate receipt.

Return server time, fixed deadlines, and `authorizedForMs` capped at 45000 with a 250ms safety allowance. `decision:'prepare'` permits only preparation while positive; all other projections say `stop`. The later worker measures this duration from its **request-start monotonic time**, avoiding network latency or local wall-clock skew extending authority. It stops starting work when a response is uncertain. Registration heartbeats do not renew work. An engine expiry scan for each runtime uses runner -> owner -> lease locks; the stub scan must exclude repository leases.

## Isolation and recovery gate

Stub claim/replay/advance/expiry paths explicitly require `stub.v1` leases; repository credentials cannot pass a repository lease through the old boolean stopped acknowledgement. Stub session/manual-reconcile endpoints do not reference repository owners. Repository reads/control use only the new tables/routes. Preserve the existing global held-runner index.

No repository completed/stopped/manual-reconcile endpoint exists yet. Cancellation and timeout do not release capacity. An unreachable daemon or unknown process state must retain uncertain ownership. Preparation/process/cleanup receipt schemas, trusted observed resource ownership/termination, report binding, and adapter enforcement are explicit next work, rather than pretending a Boolean or synthetic protocol check proves cleanup.

Acceptance: authoritative plan/Workspace binding; current human/compute rules and no-write preview; start replay/conflict/rollback and restart; literal runtime/policy isolation; global stub/repository exclusivity; queued/held cancellation; monotonic/idempotent controls and raw-token omission; fresh replay after permission/expiry/deadline loss; fixed preparation/run deadlines; engine expiry; strict HTTP/cursors; runtime table privileges and immutable admission/lease context; exact disposable-fixture cleanup. No real command or model call is an acceptance claim for this slice.
