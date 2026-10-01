import type { FlowInputSource, FlowStage } from "@ark/contracts";

export type SourceChoice = { source: FlowInputSource; label: string };

export function sourceKey(source: FlowInputSource) {
  return source.kind === "flow_input"
    ? `flow:${source.port}`
    : `stage:${source.stageId}:${source.port}`;
}
export function fieldError(errors: Record<string, string[]>, path: string) {
  return Object.entries(errors).find(
    ([key]) => key === path || key.startsWith(`${path}.`),
  )?.[1][0];
}
export function stageSources(stages: FlowStage[]): SourceChoice[] {
  return stages.flatMap((stage, index) =>
    stage.outputs.map((port) => ({
      source: {
        kind: "stage_output" as const,
        stageId: stage.id,
        port: port.name,
      },
      label: `${index + 1}. ${stage.name || "Unnamed stage"} / ${port.name || "Unnamed output"} (${port.type})`,
    })),
  );
}
export function newStage(index: number, source: FlowInputSource): FlowStage {
  return {
    id: crypto.randomUUID(),
    name: `Stage ${index + 1}`,
    agent: { resourceId: "", versionId: "" },
    inputs: [{ name: "task", type: "text", source }],
    outputs: [{ name: "result", type: "text" }],
  };
}
