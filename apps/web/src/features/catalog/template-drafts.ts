import type {
  AgentDefinition,
  CatalogTemplate,
  FlowDefinition,
  FlowInputSource,
  WorkspaceDefinition,
} from "@ark/contracts";

export function workspaceFromTemplate(
  template: CatalogTemplate,
): WorkspaceDefinition {
  if (template.kind !== "workspace")
    throw new Error("Expected a workspace template");
  return { ...structuredClone(template.definition), repositoryUrl: "" };
}

export function agentFromTemplate(template: CatalogTemplate): AgentDefinition {
  if (template.kind !== "agent") throw new Error("Expected an agent template");
  return structuredClone(template.definition);
}

export function flowFromTemplate(template: CatalogTemplate): FlowDefinition {
  if (template.kind !== "flow") throw new Error("Expected a flow template");
  const definition = structuredClone(template.definition);
  const stageIds = new Map(
    definition.stages.map((stage) => [stage.id, crypto.randomUUID()]),
  );
  function remap<Source extends FlowInputSource>(source: Source): Source {
    if (source.kind === "flow_input") return source;
    const stageId = stageIds.get(source.stageId);
    if (!stageId) throw new Error("Template references an unknown stage");
    return { ...source, stageId };
  }
  return {
    ...definition,
    workspace: { resourceId: "", versionId: "" },
    stages: definition.stages.map((stage) => ({
      ...stage,
      id: stageIds.get(stage.id)!,
      agent: { resourceId: "", versionId: "" },
      inputs: stage.inputs.map((input) => ({
        ...input,
        source: remap(input.source),
      })),
    })),
    outputs: definition.outputs.map((output) => ({
      ...output,
      source: remap(output.source),
    })),
  };
}
