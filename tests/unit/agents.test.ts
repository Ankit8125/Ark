import { describe, expect, it } from "vitest";
import {
  AgentDefinitionSchema,
  AgentListQuerySchema,
  AgentListResponseSchema,
  AgentParamsSchema,
  AgentResponseSchema,
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
} from "@ark/contracts";

const id = "ab286801-a441-4c81-b111-589de8611ff2";
const definition = {
  name: "Code reviewer",
  description: "  Review the complete change.\nPreserve these notes. 🚀  ",
  instructions:
    "  Inspect the changed files.\n\nExplain findings with examples. 🚀  ",
  runtime: "stub",
  modelPreference: "example/model-v1",
  capabilities: ["read_files", "edit_files", "run_commands"],
};

describe("agent contracts", () => {
  it("preserves instructions, description, and every capability while normalizing identifiers", () => {
    expect(
      CreateAgentRequestSchema.parse({
        id,
        schemaVersion: 1,
        definition: {
          ...definition,
          name: ` ${definition.name} `,
          modelPreference: ` ${definition.modelPreference} `,
        },
      }),
    ).toEqual({ id, schemaVersion: 1, definition });
    expect(
      AgentDefinitionSchema.parse({
        ...definition,
        modelPreference: null,
        capabilities: [],
      }),
    ).toEqual({ ...definition, modelPreference: null, capabilities: [] });
  });

  it("accepts only the inert runtime and unique known capabilities", () => {
    for (const invalid of [
      { runtime: "openai" },
      { runtime: "shell" },
      { runtime: "" },
      { runtime: null },
      { capabilities: ["read_files", "read_files"] },
      { capabilities: ["network"] },
      {
        capabilities: [
          "read_files",
          "edit_files",
          "run_commands",
          "read_files",
        ],
      },
      { capabilities: "read_files" },
      { capabilities: null },
    ]) {
      expect(
        AgentDefinitionSchema.safeParse({ ...definition, ...invalid }).success,
      ).toBe(false);
    }
  });

  it("validates bounded opaque model identifiers", () => {
    for (const modelPreference of [
      "",
      " ",
      "-option",
      "example model",
      "example\nmodel",
      "example@model",
      "example?key=placeholder",
      "example#fragment",
      "example;run",
      "x".repeat(201),
      1,
    ]) {
      expect(
        AgentDefinitionSchema.safeParse({ ...definition, modelPreference })
          .success,
      ).toBe(false);
    }
    expect(
      AgentDefinitionSchema.parse({
        ...definition,
        modelPreference: "vendor/model_v1.2:preview",
      }).modelPreference,
    ).toBe("vendor/model_v1.2:preview");
  });

  it("rejects unknown and missing fields rather than silently dropping configuration", () => {
    for (const field of Object.keys(definition)) {
      const missing = { ...definition } as Record<string, unknown>;
      delete missing[field];
      expect(AgentDefinitionSchema.safeParse(missing).success, field).toBe(
        false,
      );
    }
    for (const invalid of [
      { ...definition, apiKey: "placeholder" },
      { ...definition, teamId: id },
      { ...definition, name: " " },
      { ...definition, instructions: " \t\n " },
    ]) {
      expect(AgentDefinitionSchema.safeParse(invalid).success).toBe(false);
    }
    for (const invalid of [
      { id: "invalid", schemaVersion: 1, definition },
      { id, schemaVersion: 2, definition },
      { id, schemaVersion: 1, definition, organizationId: id },
    ]) {
      expect(CreateAgentRequestSchema.safeParse(invalid).success).toBe(false);
    }
    for (const revision of [0, -1, 1.5, 2_147_483_647, "1"]) {
      expect(
        UpdateAgentRequestSchema.safeParse({
          revision,
          schemaVersion: 1,
          definition,
        }).success,
      ).toBe(false);
    }
    expect(
      UpdateAgentRequestSchema.parse({
        revision: 1,
        schemaVersion: 1,
        definition,
      }),
    ).toEqual({ revision: 1, schemaVersion: 1, definition });
  });

  it("rejects PostgreSQL-incompatible text while preserving valid Unicode", () => {
    for (const invalidText of [
      "invalid\u0000text",
      "invalid\ud800text",
      "invalid\udffftext",
    ]) {
      for (const field of [
        "name",
        "description",
        "instructions",
        "modelPreference",
      ]) {
        expect(
          AgentDefinitionSchema.safeParse({
            ...definition,
            [field]: invalidText,
          }).success,
          field,
        ).toBe(false);
      }
    }
    expect(AgentDefinitionSchema.parse(definition)).toEqual(definition);
  });

  it("enforces content, route, revision, and pagination bounds", () => {
    const maximal = {
      ...definition,
      name: "x".repeat(80),
      description: "x".repeat(2000),
      instructions: "x".repeat(16000),
      modelPreference: "x".repeat(200),
    };
    expect(AgentDefinitionSchema.parse(maximal)).toEqual(maximal);
    for (const [field, length] of [
      ["name", 81],
      ["description", 2001],
      ["instructions", 16001],
    ] as const) {
      expect(
        AgentDefinitionSchema.safeParse({
          ...definition,
          [field]: "x".repeat(length),
        }).success,
      ).toBe(false);
    }
    expect(AgentParamsSchema.parse({ teamId: id, agentId: id })).toEqual({
      teamId: id,
      agentId: id,
    });
    expect(
      AgentParamsSchema.safeParse({ teamId: id, agentId: "invalid" }).success,
    ).toBe(false);
    expect(AgentListQuerySchema.parse({})).toEqual({});
    expect(AgentListQuerySchema.parse({ cursor: id })).toEqual({ cursor: id });
    expect(AgentListQuerySchema.safeParse({ cursor: "bad" }).success).toBe(
      false,
    );
    expect(AgentListQuerySchema.safeParse({ limit: 10000 }).success).toBe(
      false,
    );
    const summary = {
      id,
      teamId: id,
      name: definition.name,
      revision: 1,
      versionId: id,
      schemaVersion: 1,
      updatedAt: "2026-09-27T00:00:00.000Z",
    };
    expect(
      AgentListResponseSchema.safeParse({
        agents: Array(51).fill(summary),
        nextCursor: id,
      }).success,
    ).toBe(false);
  });

  it("retains unknown stored definitions for read-only forward compatibility", () => {
    const futureDefinition = {
      ...definition,
      futurePolicy: { preserve: true },
    };
    const response = {
      agent: {
        id,
        teamId: id,
        versionId: id,
        name: definition.name,
        revision: 2,
        schemaVersion: 2,
        definition: futureDefinition,
        updatedAt: "2026-09-27T00:00:00.000Z",
        createdAt: "2026-09-26T00:00:00.000Z",
      },
    };
    expect(AgentResponseSchema.parse(response)).toEqual(response);
    expect(AgentDefinitionSchema.safeParse(futureDefinition).success).toBe(
      false,
    );
  });
});
