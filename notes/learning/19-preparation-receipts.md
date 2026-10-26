# Preparation receipts

Updated 2026-10-27 (Asia/Kolkata). [Learning index](README.md) · [Contract](../findings/repository-preparation-receipts.md) · [Progress](../progress/2026-10-27-01-preparation-receipts.md)

This backend journal is verified locally: the progress record preserves 37 distinct focused cases across runs, builds/type/lint checks, migration/privilege checks, and fixture preservation. It records what an authenticated runner reports about preparation. There is no repository worker or UI yet. Reports cannot start commands, complete executions, release a runner, or establish that tests passed.

## Intent, report, and authority

A saved plan describes the selected Workspace action and declared source/image. A repository claim reserves the runner and supplies a deterministic resource manifest. A preparation receipt records structured observations bound to that exact plan, lease, and generation.

```text
Saved plan + owned repository lease
  -> runner submits one final preparation receipt
  -> API checks exact identities and bounded observations
  -> immutable receipt + server receipt time + safe audit
  -> current team members may read the saved receipt

Execution, lease, control sequence, deadlines, and capacity stay unchanged
```

The status always says `runner_reported_unverified`. Matching source/image strings establish consistency with the plan, not proof that a checkout, image inspection, containment check, or isolated preparation happened. Manifest names remain expected identities; a later adapter must inspect real resource identities and labels.

## Observations and time

A `prepared` report includes the full commit, command-image repository digest and separate local image ID, resolved container directory, successful preparation-container exit, present workspace volume, and absent command container. Reported names and ownership must match the manifest. A canonical directory stays at or below `/workspace/repository`; this checks a reported path, not a filesystem. A contained symlink may resolve elsewhere within that root. The command image may differ from the preparation transport image.

A `failed` report uses a bounded reason such as source/image mismatch, invalid path, missing ownership, unsupported limits, transport failure, or interruption. Nullable source/image/path observations preserve bounded diagnostics. Logs, stdout, environment values, host paths, credentials, arbitrary labels, prose, and quality verdicts are excluded.

`elapsedMs` is a runner-reported duration. `receivedAt` is when the server saved the report. Neither changes fixed work clocks or establishes when work actually happened.

## Upload, replay, and reads

`POST /api/runner/repository-executions/preparation-receipts` authenticates the machine and exact owned lease. Generate the receipt UUID before sending and retain the same payload after response loss. There is at most one final receipt per lease: an identical retry returns the saved record without another audit; changed content or a different final receipt conflicts. The raw lease token is omitted from storage and responses.

An owned lease may report history after expiry, cancellation, approval removal, or loss of the starter's grant. Upload supplies no work authority. Revoked machine credentials still fail. Reporting does not renew a lease or release uncertain ownership.

Current team members read `GET /api/teams/:teamId/repository-executions/:executionId/preparation-receipt`. It returns the saved record or null for an accessible execution without a receipt. Current authorization is checked independently of the starter. The fixed canonical receipt digest detects changed saved content; it is not remote attestation.

## Remaining execution boundary

Process/cleanup receipts and command authorization need contracts bound to the exact preparation, concrete resources, fixed deadlines, and a real adapter's tested observations and enforcement. This journal grants neither command authority nor cleanup acceptance. Unknown process or daemon state retains the reservation. V0.5 remains incomplete.
