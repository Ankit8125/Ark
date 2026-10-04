import { z } from "zod";

export const CatalogStatusSchema = z.enum(["active", "archived"]);
export type CatalogStatus = z.infer<typeof CatalogStatusSchema>;

// Lifecycle changes do not rewrite immutable definitions. Both counters are
// required so an archive/unarchive cycle invalidates a previously opened draft.
export const LifecycleRevisionSchema = z
  .number()
  .int()
  .min(1)
  .max(2_147_483_647);
export const ResourceLifecycleRequestSchema = z.strictObject({
  revision: z.number().int().min(1).max(2_147_483_647),
  lifecycleRevision: z.number().int().min(1).max(2_147_483_646),
});
export type ResourceLifecycleRequest = z.infer<
  typeof ResourceLifecycleRequestSchema
>;
