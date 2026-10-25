import { describe, expect, it } from "vitest";
import {
  SessionAdvanceRequestSchema,
  SessionClaimRequestSchema,
  SessionValuesSchema,
  SessionSnapshotSchema,
  SessionPreviewRequestSchema,
  StartSessionRequestSchema,
  SessionEventLogQuerySchema,
  SessionReconcileRequestSchema,
  stubStageOutputs,
  stubFinalOutputs,
  validateSessionInputs,
  type SessionSnapshot,
  type SessionValues,
} from "@ark/contracts";

const flowId = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const versionId = "ab286801-a441-4c81-b111-589de8611ff2";
const firstStage = "3c286801-a441-4c81-b111-589de8611ff2";
const secondStage = "7c286801-a441-4c81-b111-589de8611ff2";
const reference = { resourceId: flowId, versionId };
const snapshot: SessionSnapshot = {
  flow: {
    ...reference,
    definition: {
      name: "Stub flow",
      description: "",
      workspace: reference,
      inputs: [{ name: "task", type: "text" }],
      stages: [
        {
          id: firstStage,
          name: "Plan",
          agent: reference,
          inputs: [
            {
              name: "request",
              type: "text",
              source: { kind: "flow_input", port: "task" },
            },
          ],
          outputs: [{ name: "plan", type: "json" }],
        },
        {
          id: secondStage,
          name: "Review",
          agent: reference,
          inputs: [
            {
              name: "proposal",
              type: "json",
              source: {
                kind: "stage_output",
                stageId: firstStage,
                port: "plan",
              },
            },
          ],
          outputs: [{ name: "report", type: "text" }],
        },
      ],
      outputs: [
        {
          name: "result",
          type: "text",
          source: {
            kind: "stage_output",
            stageId: secondStage,
            port: "report",
          },
        },
      ],
    },
  },
  workspace: {
    ...reference,
    definition: {
      name: "Workspace",
      description: "",
      repositoryUrl: "https://github.com/example/repository",
      sourceRef: "main",
      defaultBranch: "main",
      sandboxImage: "node:24",
      workingDirectory: ".",
      actions: { install: "", test: "", lint: "", build: "" },
    },
  },
  agents: [
    {
      ...reference,
      definition: {
        name: "Agent",
        description: "",
        instructions: "Treat this as inert configuration",
        runtime: "stub",
        modelPreference: null,
        capabilities: [],
      },
    },
  ],
};
const inputValues: SessionValues = { task: { type: "text", value: "A task" } };

describe("durable stub session contracts", () => {
  it("bounds JSON nesting, nodes, UTF8 size, primitive types and total values", () => {
    const accepted = {
      task: { type: "json", value: { items: [null, true, 2, "hello"] } },
    };
    expect(SessionValuesSchema.parse(accepted)).toEqual(accepted);
    let deep: unknown = "leaf";
    for (let n = 0; n < 14; n++) deep = { child: deep };
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const value of [
      deep,
      cyclic,
      new Date(),
      NaN,
      Infinity,
      BigInt(1),
      undefined,
      Array.from({ length: 260 }, () => 0),
      "🚀".repeat(1100),
    ])
      expect(
        SessionValuesSchema.safeParse({ task: { type: "json", value } })
          .success,
      ).toBe(false);
    expect(
      SessionValuesSchema.safeParse({
        task: { type: "text", value: "bad\u0000text" },
      }).success,
    ).toBe(false);
    expect(
      SessionValuesSchema.safeParse(
        Object.fromEntries(
          Array.from({ length: 9 }, (_, n) => [
            `input${n}`,
            { type: "text", value: "ok" },
          ]),
        ),
      ).success,
    ).toBe(false);
    expect(
      SessionValuesSchema.safeParse({
        task: { type: "text", value: "a".repeat(4096) },
        more: { type: "text", value: "b".repeat(4096) },
      }).success,
    ).toBe(false);
  });
  it("requires exactly the pinned Flow input names and types", () => {
    expect(() => validateSessionInputs(snapshot, inputValues)).not.toThrow();
    for (const values of [
      {},
      { ...inputValues, extra: { type: "text", value: "extra" } },
      { task: { type: "json", value: {} } },
    ])
      expect(() =>
        validateSessionInputs(snapshot, values as SessionValues),
      ).toThrow();
  });
  it("validates complete pinned snapshots and rejects omitted or mismatched dependencies", () => {
    expect(SessionSnapshotSchema.parse(snapshot)).toEqual(snapshot);
    expect(
      SessionSnapshotSchema.safeParse({ ...snapshot, agents: [] }).success,
    ).toBe(false);
    expect(
      SessionSnapshotSchema.safeParse({
        ...snapshot,
        agents: [snapshot.agents[0], snapshot.agents[0]],
      }).success,
    ).toBe(false);
    expect(
      SessionSnapshotSchema.safeParse({
        ...snapshot,
        workspace: { ...snapshot.workspace, versionId: secondStage },
      }).success,
    ).toBe(false);
  });
  it("keeps preview free of creation controls and bounds every mutation realm", () => {
    const preview = { flow: reference, runnerId: flowId, inputValues };
    expect(SessionPreviewRequestSchema.parse(preview)).toEqual(preview);
    expect(
      SessionPreviewRequestSchema.safeParse({ ...preview, id: flowId }).success,
    ).toBe(false);
    expect(StartSessionRequestSchema.parse({ ...preview, id: flowId }).id).toBe(
      flowId,
    );
    expect(
      SessionClaimRequestSchema.parse({
        claimId: flowId,
        leaseToken: "a".repeat(64),
        runtime: "stub.v1",
      }).runtime,
    ).toBe("stub.v1");
    for (const patch of [
      { runtime: "real" },
      { leaseToken: "a".repeat(63) },
      { leaseToken: "A".repeat(64) },
      { generation: 2 },
    ])
      expect(
        SessionClaimRequestSchema.safeParse({
          claimId: flowId,
          leaseToken: "a".repeat(64),
          runtime: "stub.v1",
          ...patch,
        }).success,
      ).toBe(false);
    expect(
      SessionReconcileRequestSchema.safeParse({
        expectedRevision: 2,
        confirmedStopped: false,
      }).success,
    ).toBe(false);
  });
  it("requires explicit stopped confirmation and never accepts untyped stage results", () => {
    const base = {
      eventId: versionId,
      leaseId: flowId,
      leaseToken: "a".repeat(64),
      generation: 1,
      expectedRevision: 2,
    };
    expect(
      SessionAdvanceRequestSchema.parse({
        ...base,
        kind: "completed",
        confirmedStopped: true,
      }).kind,
    ).toBe("completed");
    for (const invalid of [
      { ...base, kind: "completed" },
      { ...base, kind: "stopped", confirmedStopped: false },
      {
        ...base,
        kind: "stage_completed",
        stageId: firstStage,
        outputs: { plan: "not typed" },
      },
      { ...base, kind: "completed", confirmedStopped: true, outputs: {} },
      { ...base, kind: "stopped", confirmedStopped: true, expectedRevision: 0 },
    ])
      expect(SessionAdvanceRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
  });
  it("replays typed bindings through deterministic bounded stub outputs without evaluating instructions", () => {
    const session = { snapshot, inputValues, stageResults: {}, stageIndex: 0 };
    const plan = stubStageOutputs(session);
    expect(plan).toEqual(stubStageOutputs(session));
    expect(plan.plan?.type).toBe("json");
    expect(JSON.stringify(plan)).not.toContain(
      snapshot.agents[0]!.definition.instructions,
    );
    const next = {
      ...session,
      stageIndex: 1,
      stageResults: { [firstStage]: plan },
    };
    const report = stubStageOutputs(next);
    expect(report.report?.type).toBe("text");
    expect(
      stubFinalOutputs({
        ...next,
        stageResults: { ...next.stageResults, [secondStage]: report },
      }),
    ).toEqual({ result: report.report });
    expect(() => stubStageOutputs({ ...next, stageResults: {} })).toThrow();
    expect(() => stubFinalOutputs(session)).toThrow();
  });
  it("rejects malformed, noninteger and oversized event cursors", () => {
    expect(SessionEventLogQuerySchema.parse({ after: "0" })).toEqual({
      after: 0,
    });
    expect(SessionEventLogQuerySchema.parse({ after: "2147483647" })).toEqual({
      after: 2147483647,
    });
    for (const after of ["-1", "1.1", "01", "2147483648", "x"])
      expect(SessionEventLogQuerySchema.safeParse({ after }).success).toBe(
        false,
      );
  });
});
