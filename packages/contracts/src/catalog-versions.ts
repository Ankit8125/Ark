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
export type ResourceVersionReference = z.infer<
  typeof ResourceVersionReferenceSchema
>;
export type ResourceVersion = z.infer<typeof ResourceVersionSchema>;
