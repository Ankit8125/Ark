import { describe, expect, it } from "vitest";
import {
  AgentTemplateSchema,
  CatalogTemplateListResponseSchema,
  CatalogTemplateParamsSchema,
  CatalogTemplateSchema,
  FlowDefinitionSchema,
  FlowTemplateDefinitionSchema,
  FlowTemplateSchema,
  WorkspaceDefinitionSchema,
  WorkspaceTemplateSchema,
  type FlowTemplate,
} from "@ark/contracts";
import { listBuiltinTemplates } from "../../apps/api/src/catalog-templates.js";

const first = "00000000-0000-4000-8000-000000000011";
const second = "00000000-0000-4000-8000-000000000012";
const reference = {
  resourceId: "00000000-0000-4000-8000-000000000021",
  versionId: "00000000-0000-4000-8000-000000000022",
};
const metadata = {
  id: "example",
  templateVersion: 1,
  schemaVersion: 1 as const,
  title: "Example",
  description: "An editable starting point.",
};
const workspace = {
  ...metadata,
  kind: "workspace" as const,
  definition: {
    name: "Project workspace",
    description: "Configuration only.",
    sourceRef: "main",
    defaultBranch: "main",
    sandboxImage: "node:24",
    workingDirectory: ".",
    actions: {
      install: "pnpm install",
      test: "pnpm test",
      lint: "",
      build: "",
    },
  },
};
const agent = {
  ...metadata,
  kind: "agent" as const,
  definition: {
    name: "Implementation agent",
    description: "Inert preferences.",
    instructions: "  Inspect the request.\nPreserve this whitespace. 🚀  ",
    runtime: "stub" as const,
    modelPreference: null,
    capabilities: ["read_files" as const],
  },
};
const flow: FlowTemplate = {
  ...metadata,
  kind: "flow",
  definition: {
    name: "Implement and review",
    description: "Ordered example with no team dependencies.",
    inputs: [{ name: "task", type: "text" }],
    stages: [
      {
        id: first,
        name: "Implement",
        inputs: [
          {
            name: "task",
            type: "text",
            source: { kind: "flow_input", port: "task" },
          },
        ],
        outputs: [{ name: "changes", type: "text" }],
      },
      {
        id: second,
        name: "Review",
        inputs: [
          {
            name: "changes",
            type: "text",
            source: { kind: "stage_output", stageId: first, port: "changes" },
          },
        ],
        outputs: [{ name: "review", type: "text" }],
      },
    ],
    outputs: [
      {
        name: "result",
        type: "text",
        source: { kind: "stage_output", stageId: second, port: "review" },
      },
    ],
  },
};

describe("built-in catalog template contracts", () => {
  it("returns independent nested copies so changing one read cannot alter later reads", () => {
    for (const kind of ["workspace", "agent", "flow"] as const) {
      const original = listBuiltinTemplates(kind);
      const changed = listBuiltinTemplates(kind);
      const template = changed.templates[0]!;
      template.title = "Changed local copy";
      template.definition.name = "Changed name";
      if (template.kind === "workspace")
        template.definition.actions.test = "changed test command";
      else if (template.kind === "agent")
        template.definition.capabilities.push("edit_files");
      else {
        template.definition.stages[0]!.outputs[0]!.name = "changed_output";
        template.definition.outputs[0]!.source.port = "changed_binding";
      }
      changed.templates.length = 0;
      expect(listBuiltinTemplates(kind)).toEqual(original);
    }
  });

  it("accepts only a team UUID and singular catalog kind", () => {
    for (const kind of ["workspace", "agent", "flow"])
      expect(
        CatalogTemplateParamsSchema.parse({ teamId: first, kind }),
      ).toEqual({ teamId: first, kind });
    for (const invalid of [
      { teamId: "not-a-team", kind: "workspace" },
      { teamId: first, kind: "workspaces" },
      { teamId: first, kind: "session" },
      { teamId: first, kind: "flow", templateId: "example" },
    ])
      expect(CatalogTemplateParamsSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("validates all template kinds without filling repository or dependency choices", () => {
    expect(WorkspaceTemplateSchema.parse(workspace)).toEqual(workspace);
    expect(AgentTemplateSchema.parse(agent)).toEqual(agent);
    expect(FlowTemplateSchema.parse(flow)).toEqual(flow);
    expect(
      WorkspaceDefinitionSchema.safeParse(workspace.definition).success,
    ).toBe(false);
    expect(FlowDefinitionSchema.safeParse(flow.definition).success).toBe(false);
    const complete = {
      ...flow.definition,
      workspace: reference,
      stages: flow.definition.stages.map((stage) => ({
        ...stage,
        agent: reference,
      })),
    };
    expect(FlowDefinitionSchema.parse(complete)).toEqual(complete);
  });

  it("rejects embedded resource identities, repository choices, and dependency pins", () => {
    for (const invalid of [
      { ...workspace, resourceId: first },
      { ...workspace, teamId: first },
      { ...workspace, revision: 1 },
      {
        ...workspace,
        definition: {
          ...workspace.definition,
          repositoryUrl: "https://github.com/example/project.git",
        },
      },
      { ...flow, definition: { ...flow.definition, workspace: reference } },
      {
        ...flow,
        definition: {
          ...flow.definition,
          stages: flow.definition.stages.map((stage) => ({
            ...stage,
            agent: reference,
          })),
        },
      },
      {
        ...agent,
        definition: { ...agent.definition, apiKey: "not-a-credential" },
      },
    ])
      expect(CatalogTemplateSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects malformed metadata and unsupported kinds or definitions", () => {
    for (const patch of [
      { id: "" },
      { id: "Uppercase" },
      { id: "two words" },
      { id: "a".repeat(81) },
      { templateVersion: 0 },
      { templateVersion: 1.5 },
      { templateVersion: 2_147_483_648 },
      { schemaVersion: 2 },
      { title: " " },
      { description: " " },
      { kind: "session" },
      {
        definition: { ...workspace.definition, workingDirectory: "../private" },
      },
    ])
      expect(
        CatalogTemplateSchema.safeParse({ ...workspace, ...patch }).success,
      ).toBe(false);
    expect(
      AgentTemplateSchema.safeParse({
        ...agent,
        definition: { ...agent.definition, runtime: "live" },
      }).success,
    ).toBe(false);
  });

  it("rejects unknown nested fields instead of silently dropping them", () => {
    expect(
      WorkspaceTemplateSchema.safeParse({
        ...workspace,
        definition: {
          ...workspace.definition,
          actions: { ...workspace.definition.actions, deploy: "deploy" },
        },
      }).success,
    ).toBe(false);
    const changed = structuredClone(flow.definition);
    expect(
      FlowTemplateDefinitionSchema.safeParse({
        ...changed,
        stages: [{ ...changed.stages[0], extra: true }, changed.stages[1]],
      }).success,
    ).toBe(false);
    expect(
      FlowTemplateDefinitionSchema.safeParse({
        ...changed,
        outputs: [
          {
            ...changed.outputs[0],
            source: { ...changed.outputs[0]!.source, extra: true },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate template IDs and bounds the list envelope", () => {
    expect(CatalogTemplateListResponseSchema.parse({ templates: [] })).toEqual({
      templates: [],
    });
    expect(
      CatalogTemplateListResponseSchema.safeParse({
        templates: [workspace, agent],
      }).success,
    ).toBe(false);
    expect(
      CatalogTemplateListResponseSchema.safeParse({
        templates: [workspace],
        nextCursor: null,
      }).success,
    ).toBe(false);
    const templates = Array.from({ length: 20 }, (_, index) => ({
      ...workspace,
      id: `example-${index}`,
    }));
    expect(
      CatalogTemplateListResponseSchema.safeParse({ templates }).success,
    ).toBe(true);
    expect(
      CatalogTemplateListResponseSchema.safeParse({
        templates: [...templates, { ...workspace, id: "example-20" }],
      }).success,
    ).toBe(false);
  });

  it("retains the real Flow graph rules for incomplete template definitions", () => {
    const invalid: unknown[] = [];
    const duplicateId = structuredClone(flow.definition);
    duplicateId.stages[1]!.id = first;
    invalid.push(duplicateId);
    const duplicateName = structuredClone(flow.definition);
    duplicateName.stages[1]!.name = "IMPLEMENT";
    invalid.push(duplicateName);
    const duplicatePort = structuredClone(flow.definition);
    duplicatePort.inputs.push({ name: "task", type: "text" });
    invalid.push(duplicatePort);
    const forward = structuredClone(flow.definition);
    forward.stages[0]!.inputs[0]!.source = {
      kind: "stage_output",
      stageId: second,
      port: "review",
    };
    invalid.push(forward);
    const self = structuredClone(flow.definition);
    self.stages[0]!.inputs[0]!.source = {
      kind: "stage_output",
      stageId: first,
      port: "changes",
    };
    invalid.push(self);
    const missing = structuredClone(flow.definition);
    missing.stages[1]!.inputs[0]!.source = {
      kind: "stage_output",
      stageId: first,
      port: "missing",
    };
    invalid.push(missing);
    const mismatch = structuredClone(flow.definition);
    mismatch.stages[1]!.inputs[0]!.type = "json";
    invalid.push(mismatch);
    const output = structuredClone(flow.definition);
    output.outputs[0]!.source.stageId = reference.resourceId;
    invalid.push(output);
    invalid.push({ ...flow.definition, stages: [] });
    for (const definition of invalid)
      expect(FlowTemplateDefinitionSchema.safeParse(definition).success).toBe(
        false,
      );
  });
});
