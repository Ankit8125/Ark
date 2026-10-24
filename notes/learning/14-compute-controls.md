# Runner approval and compute grants

Recorded 2026-10-20 (Asia/Kolkata). [Learning index](README.md) · [Contract](../findings/runner-compute-controls.md)

Enrollment answers “which process is this?” Heartbeats answer “when did it last contact Ark?” Compute controls answer two different questions: “has an admin approved this runner for work?” and “does this person have permission to use it?”

After pulling the change, run `pnpm.cmd db:prepare` to apply migration 007 and grant the restricted API role access to the new grant table. This preserves existing registrations and starts them unapproved, with no use grants. The API does not migrate at startup. See [current progress](../progress/README.md) for actual verification status.

## Configure permission

Connect a runner using the [enrollment guide](13-local-runners.md), then refresh **Compute**. A current team admin opens **Manage access** on that runner. Approve it for dispatch, and explicitly grant use to the intended team admins or developers. Each change asks for confirmation. Admins also need a grant to use the runner themselves.

The member list shows eligible candidates and retained grant records, with pagination. A disabled user, revoked membership, or reviewer/viewer role makes a retained grant ineffective. An admin can still remove that grant. Restoring an eligible membership/role restores a retained grant's effect unless it was removed.

Team members can inspect their own use permission. Read-only roles cannot inspect other members' grants or change approval. Invitations and general membership administration remain later work; this panel only manages compute permission for existing members.

| State | What it means |
| --- | --- |
| Enrolled | The runner exchanged its code for a machine credential. |
| Online | Ark recently received a heartbeat. |
| Approved | An admin has enabled this runner for future dispatch. |
| Use grant | An admin explicitly granted this member use of this runner. |
| Use allowed | The current member is eligible and granted, and the runner is enrolled, approved, and unrevoked. |

**Use allowed is a permission assessment, not a running job or readiness guarantee.** It excludes health, capacity, and compatibility. No session can execute yet. Future job admission and claim operations must check current permissions again.

## Withdraw or recover

Withdrawing approval suspends use for everyone while leaving the heartbeat process connected. Removing a member's grant affects only that person's permission. Revoking the runner permanently disables its credential, clears approval, and makes all grants ineffective. A replacement registration starts with fresh permissions.

Approval/grant changes advance the same lifecycle counter used by enrollment and runner revocation; heartbeats do not. If another admin changes the runner, a stale action is rejected. If a response is lost, refresh access to inspect the saved result before deciding whether to retry. Ark does not silently retry with a newer revision or treat a successful heartbeat as consent.
