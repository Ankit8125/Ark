import { describe, expect, it } from "vitest";
import {
  CreateFlowRequestSchema,
  FlowDefinitionSchema,
  FlowListQuerySchema,
  FlowListResponseSchema,
  FlowParamsSchema,
  FlowResponseSchema,
  ResourceVersionReferenceSchema,
  ResourceVersionResponseSchema,
  UpdateFlowRequestSchema,
  type FlowDefinition,
} from "@ark/contracts";

const id = "ab286801-a441-4c81-b111-589de8611ff2";
const secondId = "3c286801-a441-4c81-b111-589de8611ff2";
const reference = { resourceId: id, versionId: secondId };
const definition: FlowDefinition = {
  name: "Plan and review",
  description: "  A typed sequence.\nPreserve these notes. 🚀  ",
  workspace: reference,
  inputs: [{ name: "task", type: "text" }],
  stages: [
    {
      id,
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
      id: secondId,
      name: "Review",
      agent: reference,
      inputs: [
        {
          name: "proposal",
          type: "json",
          source: { kind: "stage_output", stageId: id, port: "plan" },
        },
      ],
      outputs: [{ name: "report", type: "text" }],
    },
  ],
  outputs: [
    {
      name: "result",
      type: "text",
      source: { kind: "stage_output", stageId: secondId, port: "report" },
    },
  ],
};

describe("ordered flow contracts", () => {
  it("preserves order and description while normalizing labels, ports, and UUID pins", () => {
    const value = structuredClone(definition);
    value.name = ` ${value.name} `;
    value.stages[0]!.name = " Plan ";
    value.inputs[0]!.name = " task ";
    value.workspace = {
      resourceId: id.toUpperCase(),
      versionId: secondId.toUpperCase(),
    };
    value.stages[0]!.id = id.toUpperCase();
    value.stages[0]!.agent = value.workspace;
    value.stages[1]!.inputs[0]!.source = {
      kind: "stage_output",
      stageId: id.toUpperCase(),
      port: " plan ",
    };
    expect(FlowDefinitionSchema.parse(value)).toEqual(definition);
    expect(
      CreateFlowRequestSchema.parse({ id, schemaVersion: 1, definition }),
    ).toEqual({ id, schemaVersion: 1, definition });
  });

  it("rejects missing, self, forward, and cyclic stage references", () => {
    const missingId = "7c286801-a441-4c81-b111-589de8611ff2";
    for (const stageId of [id, secondId, missingId]) {
      const value = structuredClone(definition);
      value.stages[0]!.inputs[0]!.source = {
        kind: "stage_output",
        stageId,
        port: "report",
      };
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
    const reordered = {
      ...definition,
      stages: [...definition.stages].reverse(),
    };
    expect(FlowDefinitionSchema.safeParse(reordered).success).toBe(false);
    const missingOutput = structuredClone(definition);
    missingOutput.outputs[0]!.source.stageId = missingId;
    expect(FlowDefinitionSchema.safeParse(missingOutput).success).toBe(false);
  });

  it("requires existing source ports and exact declared value types", () => {
    for (const location of ["flow", "stage", "output"] as const) {
      for (const change of ["missing", "type"] as const) {
        const value = structuredClone(definition);
        const binding =
          location === "flow"
            ? value.stages[0]!.inputs[0]!
            : location === "stage"
              ? value.stages[1]!.inputs[0]!
              : value.outputs[0]!;
        if (change === "missing") binding.source.port = "missing";
        else binding.type = binding.type === "text" ? "json" : "text";
        expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
      }
    }
    const badKind = structuredClone(definition);
    const raw = badKind as unknown as { outputs: unknown[] };
    raw.outputs[0] = {
      name: "result",
      type: "text",
      source: { kind: "flow_input", port: "task" },
    };
    expect(FlowDefinitionSchema.safeParse(badKind).success).toBe(false);
  });

  it("rejects duplicate stage IDs, case-insensitive stage names, and per-list port names", () => {
    for (const change of ["id", "name"] as const) {
      const value = structuredClone(definition);
      value.stages[1]![change] = value.stages[0]![change].toUpperCase();
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
    for (const location of [
      "inputs",
      "outputs",
      "stageInputs",
      "stageOutputs",
    ] as const) {
      const value = structuredClone(definition);
      if (location === "stageInputs")
        value.stages[0]!.inputs.push({ ...value.stages[0]!.inputs[0]! });
      else if (location === "stageOutputs")
        value.stages[0]!.outputs.push({ ...value.stages[0]!.outputs[0]! });
      else if (location === "inputs")
        value.inputs.push({ ...value.inputs[0]! });
      else value.outputs.push({ ...value.outputs[0]! });
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
  });

  it("bounds stage and port collections and allows both supported value types", () => {
    expect(FlowDefinitionSchema.parse(definition)).toEqual(definition);
    const expectBound = (
      value: unknown,
      path: (string | number)[],
      code: string,
    ) => {
      const parsed = FlowDefinitionSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        expect(parsed.error.issues).toEqual(
          expect.arrayContaining([expect.objectContaining({ code, path })]),
        );
      }
    };
    for (const size of [0, 9]) {
      const code = size === 0 ? "too_small" : "too_big";
      expectBound(
        {
          ...definition,
          inputs: Array.from({ length: size }, (_, index) => ({
            name: index === 0 ? "task" : `task_${index}`,
            type: "text",
          })),
        },
        ["inputs"],
        code,
      );
      expectBound(
        {
          ...definition,
          outputs: Array.from({ length: size }, (_, index) => ({
            ...definition.outputs[0],
            name: `result_${index}`,
          })),
        },
        ["outputs"],
        code,
      );
      const stageInputs = structuredClone(definition);
      stageInputs.stages[0]!.inputs = Array.from(
        { length: size },
        (_, index) => ({
          ...definition.stages[0]!.inputs[0]!,
          name: `request_${index}`,
        }),
      );
      expectBound(stageInputs, ["stages", 0, "inputs"], code);
      const stageOutputs = structuredClone(definition);
      stageOutputs.stages[0]!.outputs = Array.from(
        { length: size },
        (_, index) => ({
          name: index === 0 ? "plan" : `plan_${index}`,
          type: "json",
        }),
      );
      expectBound(stageOutputs, ["stages", 0, "outputs"], code);
    }
    expectBound({ ...definition, stages: [] }, ["stages"], "too_small");
    const stages = [
      ...definition.stages,
      ...Array.from({ length: 19 }, (_, index) => ({
        ...definition.stages[0]!,
        id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        name: `Additional stage ${index}`,
      })),
    ];
    expectBound({ ...definition, stages }, ["stages"], "too_big");
    for (const type of ["string", "number", "boolean", "", null]) {
      const value = { ...definition, inputs: [{ name: "task", type }] };
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
  });

  it("accepts twenty distinct stages with eight inputs and outputs per list", () => {
    const ports = Array.from({ length: 8 }, (_, index) => ({
      name: `p${index}${"x".repeat(38)}`,
      type: "text" as const,
    }));
    const stages = Array.from({ length: 20 }, (_, index) => ({
      id: `10000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      name: `Stage ${index}${"x".repeat(80 - `Stage ${index}`.length)}`,
      agent: reference,
      inputs: ports.map((port) => ({
        ...port,
        source: { kind: "flow_input" as const, port: port.name },
      })),
      outputs: ports,
    }));
    const value: FlowDefinition = {
      ...definition,
      inputs: ports,
      stages,
      outputs: ports.map((port) => ({
        ...port,
        source: {
          kind: "stage_output",
          stageId: stages[19]!.id,
          port: port.name,
        },
      })),
    };
    expect(FlowDefinitionSchema.parse(value)).toEqual(value);
  });

  it("enforces identifier, text, and PostgreSQL Unicode limits", () => {
    for (const name of ["", "UPPER", "has-dash", "0task", "x".repeat(41)]) {
      const value = { ...definition, inputs: [{ name, type: "text" }] };
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
    for (const field of ["name", "description"] as const) {
      for (const text of ["bad\u0000text", "bad\ud800text", "bad\udffftext"]) {
        expect(
          FlowDefinitionSchema.safeParse({ ...definition, [field]: text })
            .success,
        ).toBe(false);
      }
      const length = field === "name" ? 80 : 2000;
      expect(
        FlowDefinitionSchema.safeParse({
          ...definition,
          [field]: "x".repeat(length),
        }).success,
      ).toBe(true);
      expect(
        FlowDefinitionSchema.safeParse({
          ...definition,
          [field]: "x".repeat(length + 1),
        }).success,
      ).toBe(false);
    }
    const blankStage = structuredClone(definition);
    blankStage.stages[0]!.name = " \t ";
    expect(FlowDefinitionSchema.safeParse(blankStage).success).toBe(false);
  });

  it("rejects omitted and unknown fields instead of dropping configuration", () => {
    for (const field of Object.keys(definition)) {
      const value = { ...definition } as Record<string, unknown>;
      delete value[field];
      expect(FlowDefinitionSchema.safeParse(value).success, field).toBe(false);
    }
    for (const value of [
      { ...definition, condition: "arbitrary code" },
      { ...definition, workspace: { ...reference, teamId: id } },
      {
        ...definition,
        stages: [{ ...definition.stages[0], command: "echo example" }],
      },
      {
        ...definition,
        inputs: [{ ...definition.inputs[0], value: "not a declaration" }],
      },
    ]) {
      expect(FlowDefinitionSchema.safeParse(value).success).toBe(false);
    }
    for (const value of [
      { resourceId: id },
      { versionId: id },
      { resourceId: "bad", versionId: id },
      { resourceId: id, versionId: "bad" },
      { ...reference, revision: 1 },
    ]) {
      expect(ResourceVersionReferenceSchema.safeParse(value).success).toBe(
        false,
      );
    }
  });

  it("validates write envelopes, routing, revisions, and pagination", () => {
    for (const value of [
      { id: "bad", schemaVersion: 1, definition },
      { id, schemaVersion: 2, definition },
      { id, schemaVersion: 1, definition, teamId: id },
    ]) {
      expect(CreateFlowRequestSchema.safeParse(value).success).toBe(false);
    }
    for (const revision of [0, -1, 1.5, 2_147_483_647, "1"]) {
      expect(
        UpdateFlowRequestSchema.safeParse({
          revision,
          schemaVersion: 1,
          definition,
        }).success,
      ).toBe(false);
    }
    expect(
      UpdateFlowRequestSchema.parse({
        revision: 1,
        schemaVersion: 1,
        definition,
      }).revision,
    ).toBe(1);
    expect(FlowParamsSchema.parse({ teamId: id, flowId: id })).toEqual({
      teamId: id,
      flowId: id,
    });
    expect(
      FlowParamsSchema.safeParse({ teamId: id, flowId: "bad" }).success,
    ).toBe(false);
    expect(FlowListQuerySchema.parse({})).toEqual({});
    expect(FlowListQuerySchema.parse({ cursor: id })).toEqual({ cursor: id });
    expect(FlowListQuerySchema.safeParse({ cursor: "bad" }).success).toBe(
      false,
    );
    expect(FlowListQuerySchema.safeParse({ limit: 1000 }).success).toBe(false);
    const summary = {
      id,
      teamId: id,
      name: definition.name,
      revision: 1,
      versionId: id,
      schemaVersion: 1,
      updatedAt: "2026-09-28T00:00:00.000Z",
    };
    expect(
      FlowListResponseSchema.safeParse({
        flows: Array(51).fill(summary),
        nextCursor: id,
      }).success,
    ).toBe(false);
  });

  it("preserves unfamiliar definitions on flow and historical-version reads", () => {
    const future = { ...definition, futurePolicy: { preserve: true } };
    const createdAt = "2026-09-28T00:00:00.000Z";
    const response = {
      flow: {
        id,
        teamId: id,
        versionId: id,
        name: definition.name,
        revision: 2,
        schemaVersion: 2,
        definition: future,
        updatedAt: createdAt,
        createdAt,
      },
    };
    expect(FlowResponseSchema.parse(response)).toEqual(response);
    const versionResponse = {
      version: {
        resourceId: id,
        teamId: id,
        versionId: secondId,
        revision: 1,
        schemaVersion: 2,
        definition: future,
        createdAt,
      },
    };
    expect(ResourceVersionResponseSchema.parse(versionResponse)).toEqual(
      versionResponse,
    );
    expect(FlowDefinitionSchema.safeParse(future).success).toBe(false);
  });
});
