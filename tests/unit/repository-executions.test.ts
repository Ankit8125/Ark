import { describe, expect, it } from "vitest";
import {
  REPOSITORY_COMMAND_POLICY,
  REPOSITORY_COMMAND_RUNTIME,
  RepositoryExecutionCancelRequestSchema,
  RepositoryExecutionClaimRequestSchema,
  RepositoryExecutionClaimResponseSchema,
  RepositoryExecutionControlReceiptSchema,
  RepositoryExecutionControlRequestSchema,
  RepositoryExecutionControlSchema,
  RepositoryExecutionEventLogQuerySchema,
  RepositoryExecutionEventLogResponseSchema,
  RepositoryExecutionEventSchema,
  RepositoryExecutionJobSchema,
  RepositoryExecutionLeaseSchema,
  RepositoryExecutionListQuerySchema,
  RepositoryExecutionListResponseSchema,
  RepositoryExecutionOwnershipManifestSchema,
  RepositoryExecutionParamsSchema,
  RepositoryExecutionPreviewRequestSchema,
  RepositoryExecutionPreviewResponseSchema,
  RepositoryExecutionResponseSchema,
  RepositoryExecutionSchema,
  RepositoryExecutionStateSchema,
  RepositoryExecutionSummarySchema,
  RepositoryExecutionTeamParamsSchema,
  SessionClaimRequestSchema,
  SessionJobSchema,
  StartRepositoryExecutionRequestSchema,
  compileRepositoryCommandPlan,
  repositoryOwnershipManifest,
  type RepositoryExecution,
  type RepositoryExecutionControl,
  type RepositoryExecutionControlRequest,
  type RepositoryExecutionEvent,
  type RepositoryExecutionJob,
  type SavedRepositoryPlan,
} from "@ark/contracts";

const executionId = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const planId = "ab286801-a441-4c81-b111-589de8611ff2";
const leaseId = "3c286801-a441-4c81-b111-589de8611ff2";
const runnerId = "7c286801-a441-4c81-b111-589de8611ff2";
const controlId = "8c286801-a441-4c81-b111-589de8611ff2";
const reference = { resourceId: planId, versionId: runnerId };
const planDigest = "a".repeat(64);
const token = "d".repeat(64);
const timestamp = "2026-10-26T00:00:00.000Z";
const runDeadline = "2026-10-26T00:15:00.000Z";
const preparationDeadline = "2026-10-26T00:02:00.000Z";
const request = {
  repositoryPlanId: planId,
  expectedPlanDigest: planDigest,
  runnerId,
};

function savedPlan(): SavedRepositoryPlan {
  return {
    id: planId,
    organizationId: runnerId,
    teamId: runnerId,
    createdBy: runnerId,
    createdAt: timestamp,
    workspaceName: "Controlled fixture",
    planDigest,
    plan: compileRepositoryCommandPlan(
      {
        ...reference,
        definition: {
          name: "Controlled fixture",
          description: "Protocol intent only.",
          repositoryUrl: "https://github.com/example/project.git",
          sourceRef: "main",
          defaultBranch: "main",
          sandboxImage: "node:24",
          workingDirectory: ".",
          actions: { install: "", test: "pnpm test", lint: "", build: "" },
        },
      },
      {
        action: "test",
        commitOid: "abcdef0123456789abcdef0123456789abcdef01",
        imageDigest: `node@sha256:${"b".repeat(64)}`,
      },
    ),
  };
}
function execution(claimed = false): RepositoryExecution {
  return {
    id: executionId,
    organizationId: runnerId,
    teamId: runnerId,
    startedBy: runnerId,
    runnerId,
    repositoryPlanId: planId,
    planDigest,
    workspace: reference,
    workspaceName: "Controlled fixture",
    runtime: REPOSITORY_COMMAND_RUNTIME,
    policy: REPOSITORY_COMMAND_POLICY,
    state: claimed ? "running" : "queued",
    revision: claimed ? 2 : 1,
    blockReason: null,
    compatibility: claimed
      ? "repository_protocol_declared"
      : "pending_runner_claim",
    createdAt: timestamp,
    updatedAt: timestamp,
    claimedAt: claimed ? timestamp : null,
    runDeadlineAt: claimed ? runDeadline : null,
    preparationDeadlineAt: claimed ? preparationDeadline : null,
    plan: savedPlan().plan,
  };
}
function summary() {
  const { plan: _, ...value } = execution();
  return value;
}
function control(): RepositoryExecutionControl {
  return {
    decision: "prepare",
    reason: null,
    serverNow: timestamp,
    authorizedForMs: 44_750,
    workDeadlineAt: preparationDeadline,
    runDeadlineAt: runDeadline,
  };
}
function controlRequest(): RepositoryExecutionControlRequest {
  return {
    controlId,
    executionId,
    leaseId,
    leaseToken: token,
    generation: 1,
    expectedControlSequence: 0,
    planDigest,
  };
}
function job(): RepositoryExecutionJob {
  return {
    execution: execution(true),
    lease: {
      id: leaseId,
      generation: 1,
      status: "active",
      expiresAt: "2026-10-26T00:00:45.000Z",
      controlSequence: 0,
    },
    manifest: repositoryOwnershipManifest(executionId, leaseId, planDigest),
    control: control(),
  };
}
function event(): RepositoryExecutionEvent {
  return {
    executionId,
    id: controlId,
    sequence: 1,
    kind: "created",
    state: "queued",
    blockReason: null,
    createdAt: timestamp,
  };
}

describe("repository execution preparation-control contracts", () => {
  it("requires exact plan/runner admission fields, normalized UUIDs and a separate Start identity", () => {
    expect(
      RepositoryExecutionPreviewRequestSchema.parse({
        ...request,
        repositoryPlanId: planId.toUpperCase(),
        runnerId: runnerId.toUpperCase(),
      }),
    ).toEqual(request);
    expect(
      StartRepositoryExecutionRequestSchema.parse({
        ...request,
        id: executionId.toUpperCase(),
      }),
    ).toEqual({ ...request, id: executionId });
    expect(
      StartRepositoryExecutionRequestSchema.safeParse(request).success,
    ).toBe(false);
    for (const extra of [
      { id: executionId },
      { command: "replacement" },
      { plan: savedPlan().plan },
      { runtime: "stub.v1" },
      { confirmedStopped: true },
    ])
      expect(
        RepositoryExecutionPreviewRequestSchema.safeParse({
          ...request,
          ...extra,
        }).success,
      ).toBe(false);
    for (const digest of ["a".repeat(63), "A".repeat(64), `${planDigest}\n`])
      expect(
        RepositoryExecutionPreviewRequestSchema.safeParse({
          ...request,
          expectedPlanDigest: digest,
        }).success,
      ).toBe(false);
  });

  it("keeps preview compatibility pending instead of claiming verified sandbox capability", () => {
    const value = {
      repositoryPlan: savedPlan(),
      runnerId,
      compatibility: "pending_runner_claim",
    };
    expect(RepositoryExecutionPreviewResponseSchema.parse(value)).toEqual(
      value,
    );
    for (const change of [
      { compatibility: "repository_protocol_declared" },
      { verified: true },
      { lease: job().lease },
    ])
      expect(
        RepositoryExecutionPreviewResponseSchema.safeParse({
          ...value,
          ...change,
        }).success,
      ).toBe(false);
  });

  it("preserves the admitted plan and nullable queued deadlines without exposing later execution states or quality", () => {
    const value = execution();
    expect(
      RepositoryExecutionResponseSchema.parse({ repositoryExecution: value }),
    ).toEqual({ repositoryExecution: value });
    expect(value.claimedAt).toBeNull();
    expect(value.runDeadlineAt).toBeNull();
    expect(value.preparationDeadlineAt).toBeNull();
    for (const state of [
      "queued",
      "running",
      "blocked",
      "cancelling",
      "cancelled",
    ])
      expect(RepositoryExecutionStateSchema.safeParse(state).success).toBe(
        true,
      );
    for (const change of [
      { state: "completed" },
      { state: "failed" },
      { runtime: "stub.v1" },
      { policy: "unrestricted" },
      { quality: "passed" },
      { claimedAt: false },
      { preparationDeadlineAt: "tomorrow" },
      { workspace: { ...reference, versionId: executionId } },
    ])
      expect(
        RepositoryExecutionSchema.safeParse({ ...value, ...change }).success,
      ).toBe(false);
  });

  it("bounds summary pages and requires scoped strict route/pagination parameters", () => {
    const value = summary();
    expect(RepositoryExecutionSummarySchema.parse(value)).toEqual(value);
    expect(
      RepositoryExecutionSummarySchema.safeParse(execution()).success,
    ).toBe(false);
    expect(
      RepositoryExecutionListResponseSchema.parse({
        repositoryExecutions: [value],
        nextCursor: executionId.toUpperCase(),
      }).nextCursor,
    ).toBe(executionId);
    expect(
      RepositoryExecutionListResponseSchema.safeParse({
        repositoryExecutions: Array.from({ length: 51 }, () => value),
        nextCursor: null,
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionTeamParamsSchema.parse({
        teamId: runnerId.toUpperCase(),
      }),
    ).toEqual({ teamId: runnerId });
    expect(
      RepositoryExecutionParamsSchema.parse({
        teamId: runnerId,
        executionId: executionId.toUpperCase(),
      }),
    ).toEqual({ teamId: runnerId, executionId });
    expect(
      RepositoryExecutionParamsSchema.safeParse({
        teamId: runnerId,
        executionId,
        leaseId,
      }).success,
    ).toBe(false);
    expect(RepositoryExecutionListQuerySchema.parse({})).toEqual({});
    expect(
      RepositoryExecutionListQuerySchema.parse({
        cursor: executionId.toUpperCase(),
      }),
    ).toEqual({ cursor: executionId });
    expect(
      RepositoryExecutionListQuerySchema.safeParse({ offset: 1 }).success,
    ).toBe(false);
  });

  it("bounds lifecycle events and accepts only plain bounded event sequence cursors", () => {
    expect(RepositoryExecutionEventSchema.parse(event())).toEqual(event());
    expect(
      RepositoryExecutionEventLogResponseSchema.parse({
        events: [event()],
        nextAfter: null,
      }),
    ).toEqual({ events: [event()], nextAfter: null });
    expect(
      RepositoryExecutionEventLogResponseSchema.safeParse({
        events: Array.from({ length: 101 }, () => event()),
        nextAfter: 100,
      }).success,
    ).toBe(false);
    for (const change of [
      { kind: "completed" },
      { sequence: 0 },
      { state: "completed" },
      { leaseToken: token },
    ])
      expect(
        RepositoryExecutionEventSchema.safeParse({ ...event(), ...change })
          .success,
      ).toBe(false);
    expect(
      RepositoryExecutionEventLogQuerySchema.parse({ after: "0" }),
    ).toEqual({ after: 0 });
    expect(
      RepositoryExecutionEventLogQuerySchema.parse({ after: "2147483647" }),
    ).toEqual({ after: 2_147_483_647 });
    for (const after of [
      "-1",
      "01",
      "1.5",
      "1e2",
      "1\n",
      "1\r",
      "1\u2028",
      " 1",
      "2147483648",
    ])
      expect(
        RepositoryExecutionEventLogQuerySchema.safeParse({ after }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionEventLogQuerySchema.safeParse({
        after: "1",
        cursor: executionId,
      }).success,
    ).toBe(false);
  });

  it("permits only exact lifecycle cancellation and rejects boolean stop/release shortcuts", () => {
    expect(
      RepositoryExecutionCancelRequestSchema.parse({ expectedRevision: 1 }),
    ).toEqual({ expectedRevision: 1 });
    for (const expectedRevision of [0, -1, 1.5, "1", 2_147_483_648])
      expect(
        RepositoryExecutionCancelRequestSchema.safeParse({ expectedRevision })
          .success,
      ).toBe(false);
    for (const confirmedStopped of [true, false])
      expect(
        RepositoryExecutionCancelRequestSchema.safeParse({
          expectedRevision: 1,
          confirmedStopped,
        }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionCancelRequestSchema.safeParse({
        expectedRevision: 1,
        kind: "completed",
      }).success,
    ).toBe(false);
  });

  it("isolates repository claim runtime/policy from stub claims and validates a lowercase 32-byte lease token", () => {
    const claim = {
      claimId: leaseId,
      leaseToken: token,
      runtime: REPOSITORY_COMMAND_RUNTIME,
      policy: REPOSITORY_COMMAND_POLICY,
    };
    expect(
      RepositoryExecutionClaimRequestSchema.parse({
        ...claim,
        claimId: leaseId.toUpperCase(),
      }),
    ).toEqual(claim);
    expect(SessionClaimRequestSchema.safeParse(claim).success).toBe(false);
    for (const change of [
      { runtime: "stub.v1" },
      { policy: "docker-linux-networked.v1" },
      { leaseToken: "D".repeat(64) },
      { leaseToken: "d".repeat(63) },
      { leaseToken: `${token}\n` },
      { command: "pnpm test" },
      { confirmedStopped: true },
    ])
      expect(
        RepositoryExecutionClaimRequestSchema.safeParse({ ...claim, ...change })
          .success,
      ).toBe(false);
    expect(RepositoryExecutionClaimResponseSchema.parse({ job: null })).toEqual(
      { job: null },
    );
  });

  it("keeps control sequencing separate and omits the raw token from strict canonical receipts", () => {
    const value = controlRequest();
    expect(
      RepositoryExecutionControlRequestSchema.parse({
        ...value,
        controlId: controlId.toUpperCase(),
      }),
    ).toEqual(value);
    const { leaseToken: _, ...receipt } = value;
    expect(RepositoryExecutionControlReceiptSchema.parse(receipt)).toEqual(
      receipt,
    );
    expect(JSON.stringify(receipt)).not.toContain(token);
    expect(
      RepositoryExecutionControlReceiptSchema.safeParse(value).success,
    ).toBe(false);
    for (const expectedControlSequence of [-1, 0.5, "0", 2_147_483_647])
      expect(
        RepositoryExecutionControlRequestSchema.safeParse({
          ...value,
          expectedControlSequence,
        }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionControlRequestSchema.safeParse({
        ...value,
        expectedControlSequence: 2_147_483_646,
      }).success,
    ).toBe(true);
    for (const extra of [
      { expectedRevision: 2 },
      { command: "replacement" },
      { path: "/tmp" },
      { runDeadlineAt: runDeadline },
      { confirmedStopped: true },
      { confirmedStopped: false },
    ])
      expect(
        RepositoryExecutionControlRequestSchema.safeParse({
          ...value,
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionControlRequestSchema.safeParse({
        ...value,
        generation: 2,
      }).success,
    ).toBe(false);
  });

  it("derives deterministic copied ownership intent from normalized strict IDs and digest", () => {
    const manifest = repositoryOwnershipManifest(
      executionId.toUpperCase(),
      leaseId.toUpperCase(),
      planDigest,
    );
    expect(manifest).toEqual({
      version: 1,
      executionId,
      leaseId,
      generation: 1,
      planDigest,
      resources: {
        preparationContainer: `ark-repo-${leaseId}-g1-prep`,
        commandContainer: `ark-repo-${leaseId}-g1-command`,
        workspaceVolume: `ark-repo-${leaseId}-g1-workspace`,
      },
    });
    const second = repositoryOwnershipManifest(
      executionId,
      leaseId,
      planDigest,
    );
    expect(second).toEqual(manifest);
    expect(second.resources).not.toBe(manifest.resources);
    manifest.resources.commandContainer = "changed locally";
    expect(
      repositoryOwnershipManifest(executionId, leaseId, planDigest),
    ).toEqual(second);
    for (const id of [
      "not-a-uuid",
      `${executionId}/../other`,
      `${executionId}\n`,
    ])
      expect(() =>
        repositoryOwnershipManifest(id, leaseId, planDigest),
      ).toThrow();
    expect(() =>
      repositoryOwnershipManifest(executionId, "../volume", planDigest),
    ).toThrow();
    expect(() =>
      repositoryOwnershipManifest(executionId, leaseId, "A".repeat(64)),
    ).toThrow();
  });

  it("rejects injected, renamed, or cross-lease manifest resources and authority claims", () => {
    const manifest = repositoryOwnershipManifest(
      executionId,
      leaseId,
      planDigest,
    );
    for (const resources of [
      { ...manifest.resources, commandContainer: "other-container" },
      { ...manifest.resources, preparationContainer: "../../outside" },
      { ...manifest.resources, workspaceVolume: "/var/run/docker.sock" },
      { ...manifest.resources, command: "docker run" },
    ])
      expect(
        RepositoryExecutionOwnershipManifestSchema.safeParse({
          ...manifest,
          resources,
        }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionOwnershipManifestSchema.safeParse({
        ...manifest,
        leaseId: runnerId,
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionOwnershipManifestSchema.safeParse({
        ...manifest,
        generation: 2,
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionOwnershipManifestSchema.safeParse({
        ...manifest,
        verifiedCleanup: true,
      }).success,
    ).toBe(false);
  });

  it("allows only bounded positive preparation windows and zero-authority stop projections", () => {
    expect(RepositoryExecutionControlSchema.parse(control())).toEqual(
      control(),
    );
    expect(
      RepositoryExecutionControlSchema.safeParse({
        ...control(),
        authorizedForMs: 45_000,
      }).success,
    ).toBe(true);
    const stop = {
      ...control(),
      decision: "stop",
      reason: "uncertain",
      authorizedForMs: 0,
    };
    expect(RepositoryExecutionControlSchema.parse(stop)).toEqual(stop);
    for (const change of [
      { decision: "command" },
      { decision: "prepare", reason: "cancelling" },
      { authorizedForMs: 0 },
      { authorizedForMs: -1 },
      { authorizedForMs: 45_001 },
      { authorizedForMs: 1.5 },
      { authorizedForMs: true },
      { serverNow: "yesterday" },
      { workDeadlineAt: timestamp },
      { workDeadlineAt: "2026-10-26T00:16:00.000Z" },
    ])
      expect(
        RepositoryExecutionControlSchema.safeParse({ ...control(), ...change })
          .success,
      ).toBe(false);
    expect(
      RepositoryExecutionControlSchema.safeParse({
        ...stop,
        authorizedForMs: 1,
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionControlSchema.safeParse({ ...stop, reason: null })
        .success,
    ).toBe(false);
  });

  it("validates lease generation and bounded control sequence independently from lifecycle revisions", () => {
    const lease = job().lease;
    expect(RepositoryExecutionLeaseSchema.parse(lease)).toEqual(lease);
    expect(
      RepositoryExecutionLeaseSchema.safeParse({
        ...lease,
        controlSequence: 2_147_483_647,
      }).success,
    ).toBe(true);
    for (const change of [
      { generation: 0 },
      { generation: 2 },
      { controlSequence: -1 },
      { controlSequence: 0.5 },
      { controlSequence: 2_147_483_648 },
      { expiresAt: null },
      { leaseToken: token },
    ])
      expect(
        RepositoryExecutionLeaseSchema.safeParse({ ...lease, ...change })
          .success,
      ).toBe(false);
  });

  it("binds a preparation job to the exact execution, plan, lease and fixed deadlines", () => {
    const value = job();
    expect(
      RepositoryExecutionClaimResponseSchema.parse({ job: value }),
    ).toEqual({ job: value });
    expect(SessionJobSchema.safeParse(value).success).toBe(false);
    for (const manifest of [
      repositoryOwnershipManifest(planId, leaseId, planDigest),
      repositoryOwnershipManifest(executionId, runnerId, planDigest),
      repositoryOwnershipManifest(executionId, leaseId, "b".repeat(64)),
    ])
      expect(
        RepositoryExecutionJobSchema.safeParse({ ...value, manifest }).success,
      ).toBe(false);
    expect(
      RepositoryExecutionJobSchema.safeParse({
        ...value,
        execution: execution(),
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionJobSchema.safeParse({
        ...value,
        control: {
          ...value.control,
          runDeadlineAt: "2026-10-26T00:16:00.000Z",
        },
      }).success,
    ).toBe(false);
    expect(
      RepositoryExecutionJobSchema.safeParse({
        ...value,
        lease: { ...value.lease, expiresAt: "2026-10-26T00:00:10.000Z" },
      }).success,
    ).toBe(false);
  });

  it("retains uncertain or cancelling jobs only with stop authority, without a release/completion receipt", () => {
    const value = job();
    for (const state of ["blocked", "cancelling"] as const) {
      const held = {
        ...value,
        execution: {
          ...value.execution,
          state,
          blockReason: "lease_expired" as const,
        },
        lease: { ...value.lease, status: "uncertain" as const },
        control: {
          ...value.control,
          decision: "stop" as const,
          reason: "uncertain" as const,
          authorizedForMs: 0,
        },
      };
      expect(RepositoryExecutionJobSchema.safeParse(held).success).toBe(true);
      expect(
        RepositoryExecutionJobSchema.safeParse({ ...held, control: control() })
          .success,
      ).toBe(false);
    }
    expect(
      RepositoryExecutionJobSchema.safeParse({
        ...value,
        confirmedStopped: true,
      }).success,
    ).toBe(false);
  });
});
