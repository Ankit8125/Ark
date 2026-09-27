import { z } from "zod";
import { CatalogTextSchema as text } from "./catalog-text.js";

const name = text.trim().min(1, "Enter an agent name.").max(80);

export const AgentCapabilitySchema = z.enum([
  "read_files",
  "edit_files",
  "run_commands",
]);

// These are saved preferences, not runtime permissions. Saving never executes
// instructions, calls a model, or grants access to files or commands.
export const AgentDefinitionSchema = z.strictObject({
  name,
  description: text.max(2000),
  instructions: text
    .max(16_000, "Use 16,000 characters or fewer.")
    .refine((value) => value.trim().length > 0, "Enter agent instructions."),
  runtime: z.literal("stub"),
  modelPreference: text
    .trim()
    .min(1, "Enter a model identifier, or leave the preference empty.")
    .max(200)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/,
      "Use a model identifier with letters, numbers, dots, dashes, underscores, colons, or slashes.",
    )
    .nullable(),
  capabilities: z
    .array(AgentCapabilitySchema)
    .max(3)
    .refine(
      (values) => new Set(values).size === values.length,
      "Choose each capability only once.",
    ),
});

export const CreateAgentRequestSchema = z.strictObject({
  id: z.uuid(),
  schemaVersion: z.literal(1),
  definition: AgentDefinitionSchema,
});
export const UpdateAgentRequestSchema = z.strictObject({
  revision: z.number().int().min(1).max(2_147_483_646),
  schemaVersion: z.literal(1),
  definition: AgentDefinitionSchema,
});
export const AgentParamsSchema = z.strictObject({
  teamId: z.uuid(),
  agentId: z.uuid(),
});
export const AgentListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});
export const AgentSummarySchema = z.strictObject({
  id: z.uuid(),
  teamId: z.uuid(),
  name,
  revision: z.number().int().positive(),
  versionId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
// Future schema versions remain readable without discarding unknown fields.
export const AgentSchema = AgentSummarySchema.extend({
  definition: z.unknown(),
  createdAt: z.iso.datetime(),
});
export const AgentResponseSchema = z.strictObject({ agent: AgentSchema });
export const AgentListResponseSchema = z.strictObject({
  agents: z.array(AgentSummarySchema).max(50),
  nextCursor: z.uuid().nullable(),
});

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentSummary = z.infer<typeof AgentSummarySchema>;
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;
