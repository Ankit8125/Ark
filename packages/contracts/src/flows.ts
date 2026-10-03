import { z } from "zod";
import { CatalogTextSchema as text } from "./catalog-text.js";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";

const name = text.trim().min(1, "Enter a flow name.").max(80);
const portName = text
  .trim()
  .max(40)
  .regex(
    /^[a-z][a-z0-9_]*$/,
    "Start with a lowercase letter; use lowercase letters, numbers, and underscores.",
  );
export const FlowValueTypeSchema = z.enum(["text", "json"]);
export const FlowPortSchema = z.strictObject({
  name: portName,
  type: FlowValueTypeSchema,
});
export const FlowStageOutputSourceSchema = z.strictObject({
  kind: z.literal("stage_output"),
  stageId: z.uuid().toLowerCase(),
  port: portName,
});
export const FlowInputSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("flow_input"), port: portName }),
  FlowStageOutputSourceSchema,
]);
export const FlowInputBindingSchema = FlowPortSchema.extend({
  source: FlowInputSourceSchema,
});
export const FlowOutputBindingSchema = FlowPortSchema.extend({
  source: FlowStageOutputSourceSchema,
});
export const FlowStageSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  name: text.trim().min(1, "Enter a stage name.").max(80),
  agent: ResourceVersionReferenceSchema,
  inputs: z.array(FlowInputBindingSchema).min(1).max(8),
  outputs: z.array(FlowPortSchema).min(1).max(8),
});

// Ordered agent stages only. These declarations store no task values and cause
// no execution. A later runner must validate actual values against these types.
export const FlowDefinitionSchema = z
  .strictObject({
    name,
    description: text.max(2000),
    workspace: ResourceVersionReferenceSchema,
    inputs: z.array(FlowPortSchema).min(1).max(8),
    stages: z.array(FlowStageSchema).min(1).max(20),
    outputs: z.array(FlowOutputBindingSchema).min(1).max(8),
  })
  .superRefine((flow, context) => {
    type Path = (string | number)[];
    const issue = (path: Path, message: string) =>
      context.addIssue({ code: "custom", path, message });
    const uniquePorts = (ports: { name: string }[], path: Path) => {
      const seen = new Set<string>();
      ports.forEach((port, index) => {
        if (seen.has(port.name))
          issue(
            [...path, index, "name"],
            "Use a unique port name in this list.",
          );
        seen.add(port.name);
      });
    };
    uniquePorts(flow.inputs, ["inputs"]);
    uniquePorts(flow.outputs, ["outputs"]);
    const stages = new Map<
      string,
      { index: number; stage: z.infer<typeof FlowStageSchema> }
    >();
    const stageNames = new Set<string>();
    flow.stages.forEach((stage, index) => {
      if (stages.has(stage.id))
        issue(
          ["stages", index, "id"],
          "Each stage must have a unique identity.",
        );
      else stages.set(stage.id, { index, stage });
      if (stageNames.has(stage.name.toLowerCase()))
        issue(["stages", index, "name"], "Use a unique stage name.");
      stageNames.add(stage.name.toLowerCase());
      uniquePorts(stage.inputs, ["stages", index, "inputs"]);
      uniquePorts(stage.outputs, ["stages", index, "outputs"]);
    });
    const validateBinding = (
      binding: z.infer<typeof FlowInputBindingSchema>,
      beforeIndex: number,
      path: Path,
    ) => {
      const source = binding.source;
      let producer: z.infer<typeof FlowPortSchema> | undefined;
      if (source.kind === "flow_input") {
        producer = flow.inputs.find((port) => port.name === source.port);
      } else {
        const found = stages.get(source.stageId);
        if (!found || found.index >= beforeIndex) {
          issue([...path, "source"], "Choose an output from an earlier stage.");
          return;
        }
        producer = found.stage.outputs.find(
          (port) => port.name === source.port,
        );
      }
      if (!producer)
        issue([...path, "source"], "The selected source port does not exist.");
      else if (producer.type !== binding.type)
        issue(
          [...path, "type"],
          "The type must match the selected source port.",
        );
    };
    flow.stages.forEach((stage, index) =>
      stage.inputs.forEach((binding, portIndex) =>
        validateBinding(binding, index, ["stages", index, "inputs", portIndex]),
      ),
    );
    flow.outputs.forEach((binding, index) =>
      validateBinding(binding, flow.stages.length, ["outputs", index]),
    );
  });

export const CreateFlowRequestSchema = z.strictObject({
  id: z.uuid(),
  schemaVersion: z.literal(1),
  definition: FlowDefinitionSchema,
});
export const UpdateFlowRequestSchema = z.strictObject({
  revision: z.number().int().min(1).max(2_147_483_646),
  schemaVersion: z.literal(1),
  definition: FlowDefinitionSchema,
});
export const FlowParamsSchema = z.strictObject({
  teamId: z.uuid(),
  flowId: z.uuid(),
});
export const FlowVersionParamsSchema = FlowParamsSchema.extend({
  versionId: z.uuid(),
});
export const FlowListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});
export const FlowSummarySchema = z.strictObject({
  id: z.uuid(),
  teamId: z.uuid(),
  name,
  revision: z.number().int().positive(),
  versionId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
export const FlowSchema = FlowSummarySchema.extend({
  definition: z.unknown(),
  createdAt: z.iso.datetime(),
});
export const FlowResponseSchema = z.strictObject({ flow: FlowSchema });
export const FlowListResponseSchema = z.strictObject({
  flows: z.array(FlowSummarySchema).max(50),
  nextCursor: z.uuid().nullable(),
});

export type FlowValueType = z.infer<typeof FlowValueTypeSchema>;
export type FlowPort = z.infer<typeof FlowPortSchema>;
export type FlowInputSource = z.infer<typeof FlowInputSourceSchema>;
export type FlowInputBinding = z.infer<typeof FlowInputBindingSchema>;
export type FlowOutputBinding = z.infer<typeof FlowOutputBindingSchema>;
export type FlowStage = z.infer<typeof FlowStageSchema>;
export type FlowDefinition = z.infer<typeof FlowDefinitionSchema>;
export type CreateFlowRequest = z.infer<typeof CreateFlowRequestSchema>;
export type UpdateFlowRequest = z.infer<typeof UpdateFlowRequestSchema>;
export type Flow = z.infer<typeof FlowSchema>;
export type FlowSummary = z.infer<typeof FlowSummarySchema>;
export type FlowListResponse = z.infer<typeof FlowListResponseSchema>;
