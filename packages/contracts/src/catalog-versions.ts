import { z } from "zod";

// Both identities are required: a valid version UUID alone does not prove that
// it belongs to the selected resource, kind, or authorized team.
export const ResourceVersionReferenceSchema = z.strictObject({
  resourceId: z.uuid().toLowerCase(),
  versionId: z.uuid().toLowerCase(),
});
export const ResourceVersionSchema = z.strictObject({
  resourceId: z.uuid(),
  teamId: z.uuid(),
  versionId: z.uuid(),
  revision: z.number().int().positive(),
  schemaVersion: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  // A historical read never drops fields from an unsupported schema.
  definition: z.unknown(),
});
export const ResourceVersionResponseSchema = z.strictObject({
  version: ResourceVersionSchema,
});
export const ResourceVersionSummarySchema = ResourceVersionSchema.omit({
  definition: true,
});
export const ResourceVersionListResponseSchema = z.strictObject({
  versions: z.array(ResourceVersionSummarySchema).max(50),
  nextCursor: z.number().int().min(1).max(2_147_483_647).nullable(),
});
export const ResourceVersionListQuerySchema = z.strictObject({
  cursor: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(2_147_483_647))
    .optional(),
});
// The server copies the selected snapshot. Clients cannot supply replacement
// fields or select a new current revision during a restore.
export const RestoreResourceRequestSchema = z.strictObject({
  versionId: z.uuid().toLowerCase(),
  revision: z.number().int().min(1).max(2_147_483_646),
});
export type ResourceVersionReference = z.infer<
  typeof ResourceVersionReferenceSchema
>;
export type ResourceVersion = z.infer<typeof ResourceVersionSchema>;
export type ResourceVersionSummary = z.infer<
  typeof ResourceVersionSummarySchema
>;
export type ResourceVersionListResponse = z.infer<
  typeof ResourceVersionListResponseSchema
>;
export type RestoreResourceRequest = z.infer<
  typeof RestoreResourceRequestSchema
>;
