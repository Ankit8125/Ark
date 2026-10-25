import { z } from "zod";
import { CatalogTextSchema } from "./catalog-text.js";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";
import {
  RepositoryActionSchema,
  RepositoryCommandPlanSchema,
  RepositoryCommandSelectionSchema,
} from "./repository-command-plan.js";

// Format validation only. The API computes the SHA-256 digest over the UTF-8
// bytes returned by serializeRepositoryCommandPlan; a digest is not authority.
const planDigest = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
const metadata = z.strictObject({
  id: z.uuid().toLowerCase(),
  organizationId: z.uuid().toLowerCase(),
  teamId: z.uuid().toLowerCase(),
  createdBy: z.uuid().toLowerCase(),
  createdAt: z.iso.datetime(),
  workspaceName: CatalogTextSchema.trim().min(1).max(80),
  planDigest,
});

// Preview and saved-plan reads require current team membership. Save requires
// current admin/developer authority. Those checks belong to the API, not these
// data schemas; none of these requests enrolls, admits, or dispatches work.
export const RepositoryPlanPreviewRequestSchema = z.strictObject({
  workspace: ResourceVersionReferenceSchema,
  selection: RepositoryCommandSelectionSchema,
});
export const SaveRepositoryPlanRequestSchema =
  RepositoryPlanPreviewRequestSchema.extend({
    id: z.uuid().toLowerCase(),
  });
export const RepositoryPlanPreviewResponseSchema = z.strictObject({
  plan: RepositoryCommandPlanSchema,
  planDigest,
});
export const SavedRepositoryPlanSchema = metadata.extend({
  plan: RepositoryCommandPlanSchema,
});
export const RepositoryPlanResponseSchema = z.strictObject({
  repositoryPlan: SavedRepositoryPlanSchema,
});
export const RepositoryPlanSummarySchema = metadata.extend({
  workspace: ResourceVersionReferenceSchema,
  action: RepositoryActionSchema,
  status: z.literal("planned_unverified"),
});
export const RepositoryPlanListResponseSchema = z.strictObject({
  repositoryPlans: z.array(RepositoryPlanSummarySchema).max(50),
  nextCursor: z.uuid().toLowerCase().nullable(),
});
export const RepositoryPlanTeamParamsSchema = z.strictObject({
  teamId: z.uuid().toLowerCase(),
});
export const RepositoryPlanParamsSchema = RepositoryPlanTeamParamsSchema.extend(
  {
    planId: z.uuid().toLowerCase(),
  },
);
export const RepositoryPlanListQuerySchema = z.strictObject({
  cursor: z.uuid().toLowerCase().optional(),
});

export type RepositoryPlanPreviewRequest = z.infer<
  typeof RepositoryPlanPreviewRequestSchema
>;
export type SaveRepositoryPlanRequest = z.infer<
  typeof SaveRepositoryPlanRequestSchema
>;
export type RepositoryPlanPreviewResponse = z.infer<
  typeof RepositoryPlanPreviewResponseSchema
>;
export type SavedRepositoryPlan = z.infer<typeof SavedRepositoryPlanSchema>;
export type RepositoryPlanResponse = z.infer<
  typeof RepositoryPlanResponseSchema
>;
export type RepositoryPlanSummary = z.infer<typeof RepositoryPlanSummarySchema>;
export type RepositoryPlanListResponse = z.infer<
  typeof RepositoryPlanListResponseSchema
>;
