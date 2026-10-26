# Repository preparation receipts

Recorded 2026-10-26 (Asia/Kolkata), before implementation. [Control contract](repository-execution-control.md) · [Progress](../progress/2026-10-27-01-preparation-receipts.md)

## Boundary and trust

Persist one immutable final preparation receipt per repository lease. An authenticated runner reports structured observations; the server validates their syntax and exact admitted context. The fixed evidence status is `runner_reported_unverified`. Ingestion, replay, and reads never change execution state/revision, lifecycle events, lease status/expiry/control sequence, or runner capacity. An acknowledgement contains only the saved receipt, never a work ticket. No command-start, completion, cleanup/release, or recovery endpoint is introduced.

Preparation reporting is useful before the real adapter: it establishes bounded identities, replay, durable diagnostics, and authorized reads. Synthetic fixtures establish these contracts, not actual source/image inspection, containment, preparation, or cleanup. A caller cannot submit an adapter identity or claim trusted/verified evidence. A real adapter and its verified observation/enforcement path are required before these observations can participate in future command authorization.

## Machine API and exact identity

`POST /api/runner/repository-executions/preparation-receipts` takes `{id,executionId,leaseId,leaseToken,generation:1,planDigest,evidence}`. The current enrolled, unrevoked runner bearer and the exact owned `repository.v1` lease/token/generation/execution/plan must match. Headers and strict JSON/body/query checks remain unchanged. No human cookie supplies machine authority.

Lock runner -> execution -> lease, with no later identity locks. Upload remains allowed after work expiry, cancellation, approval removal, or starter/grant loss: it records history and grants no work. Revoked machine credentials remain invalid. Do not assess/renew the lease as a reporting side effect. Claim UUIDs remain shared with stub work; stub leases cannot report preparation.

The client generates a receipt UUID before upload and retries the same normalized content after response loss. Return 201 for new storage or 200 for identical replay; another payload under that ID, another owner, or a second final receipt under a different ID conflicts generically. Receipt IDs are globally unique and each lease has at most one receipt. Insert, safe audit, response/integrity validation commit atomically. Defensive insert-conflict handling applies the same replay rules after waiting. No raw lease token is persisted or returned.

## Strict evidence version 1

Both outcomes contain `version:1`, `outcome`, and a nonnegative safe-integer `elapsedMs`. This is a reported monotonic duration, not server time or proof of timely work. Server `receivedAt` is ingestion provenance only and cannot extend fixed deadlines.

`outcome:'prepared'` requires:

- `elapsedMs` at most the fixed 120-second preparation budget.
- `sourceCommitOid` equal to the admitted full commit.
- `commandImage:{repositoryDigest,imageId,os:'linux'}`: the repository digest equals the admitted command-image pin; the local ID has separate `sha256:64-hex` syntax. The preparation transport image may differ and is not inferred from the command image.
- `resolvedWorkingDirectory`: canonical absolute container directory equal to `/workspace/repository` or strictly beneath it. Reject dot/empty segments, backslashes, control characters, and prefix lookalikes. A contained symlink may resolve to a different directory within this root. This validates the report's shape, not a filesystem.
- `resources.preparationContainer:{name,id,status:'exited',exitCode:0,ownership}` and `resources.workspaceVolume:{name,status:'present',ownership}`; `resources.commandContainer:{name,status:'absent'}`. Names exactly match the server-derived ownership manifest. A container ID is a full lowercase 64-hex value.
- Each `ownership:{executionId,leaseId,generation:1,planDigest}` exactly matches the admitted lease binding. It is a structured report of ownership labels, not an arbitrary label map or adoption permission. The future adapter must observe actual resource labels/identities rather than merely copying expected intent.

`outcome:'failed'` contains `reason` from `source_unavailable`, `source_mismatch`, `image_unavailable`, `image_mismatch`, `path_invalid`, `ownership_mismatch`, `limits_unenforced`, `transport_failed`, `interrupted`, or `unknown`, plus nullable `sourceCommitOid`, `commandImage`, and `resolvedWorkingDirectory`. These bounded observations can preserve source/image mismatches. Failed outcomes claim no successful preparation or resource ownership. Unknown paths/labels are represented by the reason, never raw host paths or another resource's arbitrary labels.

There are no command replacements, stdout/stderr, logs, environment values, credentials, free-form diagnostic messages, caller deadlines, quality verdicts, or stopped-confirmation fields. Those require separate protected contracts. All objects reject unknown fields.

## Storage and human reads

Add migration 011; never change applied migrations. The append-only receipt table binds ID, execution/lease/generation/plan/runner/tenant to existing immutable context through composite foreign keys. Store the normalized token-free request, its version-1 SHA-256 canonical digest, and server receipt time. Runtime privileges are SELECT/INSERT only; an immutable trigger rejects UPDATE/DELETE. At most one receipt per lease bounds storage.

`GET /api/teams/:teamId/repository-executions/:executionId/preparation-receipt` returns `{preparationReceipt:record|null}` to current team members. An inaccessible/missing execution is a generic 404; an accessible execution with no receipt returns null. Current authorization and final browser-session expiry checks are required, including after waits. The record includes IDs, Workspace pin, tenant/runner provenance, deterministic server manifest, token-free evidence, digest, server receipt time, and literal evidence status. Reads/replay verify saved digest and context. No new quality or execution authority is inferred.

## Later process and cleanup gate

Future command authorization must bind the exact accepted preparation, current compute/lease authority, fixed command/run deadlines, and an implemented adapter's tested observation/enforcement path. Future process receipts must bind that server-issued command authorization, concrete resource identity, exact source/image/action, exit/signal/timeout and bounded output/report checksums. Quality remains separate; no/zero/unsupported tests are non-pass. Cleanup receipts must bind the same ownership and observed process termination/resource cleanup; uncertainty retains capacity. Neither a Boolean nor this unverified journal may release ownership. No unused process/cleanup request schemas are added in this slice.

Acceptance: strict schema/canonical serialization and binding, one final receipt/replay/conflicts/concurrent insertion, runtime/token/generation/tenant isolation, accepted late history with no control effects, revoked bearer denial, exact prepared matches and bounded failed diagnostics, atomic audit/response rollback, authorized reads/session expiry, immutable table/runtime privileges, additive migration preservation, and exact disposable fixture cleanup. Use focused checks without rerunning broad suites.
