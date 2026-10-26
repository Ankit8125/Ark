# Admit one repository action and control preparation

Recorded 2026-10-26 (Asia/Kolkata). [Learning index](README.md) · [Saved plans](17-saved-repository-plans.md) · [Control contract](../findings/repository-execution-control.md) · [Progress](../progress/2026-10-26-02-repository-execution-control.md)

The backend now admits a standalone repository execution and exposes preparation-only claim/control. It is verified locally in the progress record: 79 distinct focused cases cover new schemas, repository APIs/control, existing stub sessions, and a populated migration upgrade. Shared/API builds, package type checks, and test TypeScript checks passed; migration 010/runtime privileges and fixture cleanup were checked with baseline data and the pre-existing test namespace preserved. This is a partial V0.5 protocol. There is no actual repository adapter, repository CLI worker, UI, or command execution yet. Synthetic API fixtures establish protocol behavior, not real preparation or cleanup.

## Why a separate execution

A [saved plan](17-saved-repository-plans.md) records one selected Workspace action, declared source/image identities, and a canonical digest. It needs no runner or use grant. Execution admission is a separate request that binds that immutable plan/digest and exact Workspace version to a runner and a current authorized starter.

This one-action execution does not fabricate a Flow or Agent snapshot. Existing Flows describe typed Agent stages; a future Flow command stage must explicitly bind the same Workspace pin. Agent instructions, capabilities, and model preferences remain inert.

```text
Saved plan ID + expected digest + chosen runner
  -> authorized preview: validates admission, saves nothing
  -> explicit Start UUID: immutable admission + queued state + event + audit
  -> repository-specific bearer claim: shared ownership + fixed clocks + manifest
  -> preparation-only control: renew within limits or return stop
  -> current members read lifecycle and JSON events

Preparation/process/cleanup evidence and command execution: later slices
```

`running` means the repository protocol has claimed ownership. It does not establish that a container or command has started.

## Human API

Paths begin with `/api/teams/:teamId`, retaining the signed-in cookie, exact Host/Origin checks, JSON mutations, and body limits.

| Method/path                                              | Behavior                                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST /repository-execution-previews`                    | `{repositoryPlanId, expectedPlanDigest, runnerId}` validates new admission without execution, lease, or audit writes. |
| `POST /repository-executions`                            | Preview fields plus client UUID `id`; 201 for creation or 200 for identical replay.                                   |
| `GET /repository-executions?cursor=UUID`                 | Up to 50 metadata summaries and nullable `nextCursor`, in UUID order.                                                 |
| `GET /repository-executions/:executionId`                | Complete admitted plan, provenance, state, and fixed clocks.                                                          |
| `POST /repository-executions/:executionId/cancel`        | `{expectedRevision}` requests cancellation under current actor authority.                                             |
| `GET /repository-executions/:executionId/events?after=N` | Up to 100 ordered JSON lifecycle events and nullable `nextAfter`. This is not an SSE stream.                          |

New preview/Start requires an active current admin/developer, their own explicit runner use grant, an enrolled/approved/unrevoked runner, supported plan/policy, and an active supported Workspace. Offline queuing is allowed. Current team members may read executions/events. A current admin or eligible original starter may cancel.

Start atomically saves immutable admission, queued state, first lifecycle event, and safe audit. Identical same-creator requests replay saved content without adding audit or consulting a subsequently edited/archived catalog. Changed request, creator, or tenant conflicts. The original starter's current eligibility and compute permission are rechecked when claiming or controlling work; a saved admission is not permanent authority.

## Shared ownership and explicit repository claim

Migration 010 adds repository executions, lifecycle events, and token-free control receipts. It extends the existing `session_leases` table with an immutable runtime discriminator and exactly one appropriate owner. Old leases remain `stub.v1`. The same unique index covers active and uncertain leases of both runtimes: one runner cannot hold a stub session and repository execution simultaneously.

`POST /api/runner/repository-executions/claim` uses the existing runner bearer credential and `{claimId, leaseToken, runtime:'repository.v1', policy:'docker-linux-offline.v1'}`. The later client must generate its UUID and 32-byte hex token before requesting, retaining the identical pairing across response loss. Only the token hash is stored. Claim/lease UUIDs are globally exclusive in the shared table; execution IDs remain in their runtime-specific namespaces.

Compatibility changes from `pending_runner_claim` to `repository_protocol_declared`. This records explicit protocol opt-in; it does not prove Linux/image availability, trust, or enforced limits. Existing `--stub-sessions` workers never send repository claims, and no repository CLI flag/worker exists yet.

The returned manifest binds execution ID, lease ID, generation 1, and plan digest. Its fixed names are `ark-repo-LEASE_UUID-g1-prep`, `...-command`, and `...-workspace`. These names establish reproducible ownership intent only. They do not prove that resources exist, belong to a process, are isolated, or have stopped. No token belongs in a manifest, resource label, event, log, or saved receipt.

## Preparation clocks and replay

At first claim, database time fixes a 900-second run deadline and a preparation deadline of claim time plus 120 seconds, bounded by the run deadline minus a 30-second cleanup reserve. Queue time consumes neither. A preparation lease lasts at most 45 seconds and can renew only within those fixed cutoffs. Renewals cannot restart the clocks. The 30-second reserve is a protocol allowance, not evidence that cleanup happened.

`POST /api/runner/repository-executions/control` takes `{controlId, executionId, leaseId, leaseToken, generation, expectedControlSequence, planDigest}`. It accepts no command, path, result, caller deadline, or `confirmedStopped` Boolean. Its separate control sequence avoids racing lifecycle revisions; ordinary renewals do not add lifecycle events.

Generate the control UUID before sending and keep the same payload on response loss. Exact receipt replay returns fresh authority/cancellation/expiry state without extending expiry again or duplicating the receipt. Changed payload under the same ID or a stale sequence conflicts. Current permission loss or deadline/lease expiry makes ownership uncertain, records the lifecycle change, and cannot reactivate the lease. A cancelling execution stays cancelling.

The response says `prepare` only with a positive `authorizedForMs`, bounded by the lease/work cutoff and a 250ms safety allowance; otherwise it says `stop` with zero authority. A later worker must measure the window from its request-start monotonic time. Network delay or local wall-clock skew must not extend permission. Registration heartbeats remain independent and do not renew repository ownership.

## Cancellation and the next evidence gate

Queued cancellation immediately becomes `cancelled`. Held cancellation becomes `cancelling` and keeps its runner reservation. The engine marks expired ownership uncertain without releasing capacity. Stub claim/progress/expiry and manual reconciliation exclude repository owners, so the old pure-stub stopped-confirmation shortcut cannot release repository work.

This slice has no repository command-start, completion, stopped/release, or manual-reconcile endpoint. Before adding those operations, define preparation/process/cleanup receipts and reports bound to the exact plan, lease, source/image observations, and owned resources. The later adapter must prove process termination and required cleanup; aborting a Docker client or submitting a Boolean cannot establish it. Unknown daemon/process state retains uncertainty. Process status and test quality remain separate, with absent tests treated as non-pass.

Run `pnpm.cmd db:prepare` after updating the checkout to apply through migration 010; the API never migrates on startup. Use the progress record for actual verification and cleanup evidence. No repository commands, models, provider credentials, publication, or deployment are introduced by this protocol.
