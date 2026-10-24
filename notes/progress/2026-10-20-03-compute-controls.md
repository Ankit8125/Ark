# Dispatch approval and compute grants

Recorded 2026-10-20 (Asia/Kolkata). [Current progress](README.md) · [Contract](../findings/runner-compute-controls.md)

Implementation and focused verification resumed after interruptions; the [October 24 continuation](2026-10-24-01-compute-controls.md) records the current evidence and remaining work. This entry preserves the original contract checkpoint.

## Purpose and scope

Continue from synchronized commit `fcd4332`. Add admin-controlled runner approval and explicit use grants for current team admins/developers. Registration, health, permission, compatibility, and capacity remain separate. There are no job claims, commands, model calls, or deployment.

The [contract](../findings/runner-compute-controls.md) defines endpoint shapes, current membership/role checks, retained-grant behavior, exact revision checks, lock ordering, and acceptance cases before backend/frontend implementation. The [guide](../learning/14-compute-controls.md) explains the controls and migration command.

## Implementation and verification

Work is in progress. Shared schemas and additive migration `007_runner_compute_controls.sql` are defined. Existing migrations remain unchanged. Backend/frontend implementation and focused verification are underway; no acceptance result for this increment is claimed yet. Full V0.3 remains incomplete until its acceptance evidence is recorded.

The previous runner increment's checks remain in its [dated record](2026-10-20-01-runner-enrollment.md). The user requested focused checks instead of repeated full suites.

## Next bounded step

Complete and verify these permission controls, record actual commands/results and disposable-fixture cleanup, then review the change. Durable session orchestration with a deterministic stub is the subsequent V0.4 increment, not part of this work.
