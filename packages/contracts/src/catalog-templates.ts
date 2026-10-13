import { z } from "zod";
import { AgentDefinitionSchema } from "./agents.js";
import { WorkspaceDefinitionSchema } from "./workspaces.js";
import { FlowDefinitionSchema, FlowStageSchema } from "./flows.js";
import { CatalogTextSchema as text } from "./catalog-text.js";

export const CatalogTemplateKindSchema = z.enum(["workspace", "agent", "flow"]);
export type CatalogTemplateKind = z.infer<typeof CatalogTemplateKindSchema>;
export const CatalogTemplateParamsSchema = z.strictObject({
  teamId: z.uuid(),
  kind: CatalogTemplateKindSchema,
});

// Examples carry no repository choice or team-owned dependency references.
export const WorkspaceTemplateDefinitionSchema = WorkspaceDefinitionSchema.omit(
  { repositoryUrl: true },
);
const validationReference = {
  resourceId: "00000000-0000-4000-8000-000000000001",
  versionId: "00000000-0000-4000-8000-000000000002",
};
export const FlowTemplateDefinitionSchema = z
  .strictObject({
    name: FlowDefinitionSchema.shape.name,
    description: FlowDefinitionSchema.shape.description,
    inputs: FlowDefinitionSchema.shape.inputs,
    stages: z
      .array(FlowStageSchema.omit({ agent: true }))
      .min(1)
      .max(20),
    outputs: FlowDefinitionSchema.shape.outputs,
  })
  .superRefine((definition, context) => {
    // Reuse the real graph validator. Synthetic references are local to this
    // validation and never form part of a template payload or an editable copy.
    const parsed = FlowDefinitionSchema.safeParse({
      ...definition,
      workspace: validationReference,
      stages: definition.stages.map((stage) => ({
        ...stage,
        agent: validationReference,
      })),
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        context.addIssue({
          code: "custom",
          path: issue.path,
          message: issue.message,
        });
  });
const metadata = {
  id: text.regex(/^[a-z][a-z0-9-]{0,79}$/),
  templateVersion: z.number().int().min(1).max(2_147_483_647),
  schemaVersion: z.literal(1),
  title: text.trim().min(1).max(80),
  description: text.trim().min(1).max(500),
};
export const WorkspaceTemplateSchema = z.strictObject({
  ...metadata,
  kind: z.literal("workspace"),
  definition: WorkspaceTemplateDefinitionSchema,
});
export const AgentTemplateSchema = z.strictObject({
  ...metadata,
  kind: z.literal("agent"),
  definition: AgentDefinitionSchema,
});
export const FlowTemplateSchema = z.strictObject({
  ...metadata,
  kind: z.literal("flow"),
  definition: FlowTemplateDefinitionSchema,
});
export const CatalogTemplateSchema = z.discriminatedUnion("kind", [
  WorkspaceTemplateSchema,
  AgentTemplateSchema,
  FlowTemplateSchema,
]);
export const CatalogTemplateListResponseSchema = z
  .strictObject({
    templates: z.array(CatalogTemplateSchema).max(20),
  })
  .superRefine(({ templates }, context) => {
    const ids = new Set<string>();
    templates.forEach((template, index) => {
      if (ids.has(template.id))
        context.addIssue({
          code: "custom",
          path: ["templates", index, "id"],
          message: "Template IDs must be unique.",
        });
      ids.add(template.id);
    });
  });
export type CatalogTemplate = z.infer<typeof CatalogTemplateSchema>;
export type CatalogTemplateListResponse = z.infer<
  typeof CatalogTemplateListResponseSchema
>;
export type WorkspaceTemplate = z.infer<typeof WorkspaceTemplateSchema>;
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;
export type FlowTemplate = z.infer<typeof FlowTemplateSchema>;
