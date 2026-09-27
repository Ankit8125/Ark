import { z } from "zod";

// PostgreSQL text/jsonb cannot represent NUL or unpaired UTF-16 surrogates.
// Unicode mode treats valid surrogate pairs as one code point, preserving emoji.
const text = z.string().refine(
  // oxlint-disable-next-line no-control-regex -- Intentionally rejects PostgreSQL-incompatible characters.
  (value) => !/[\u0000\uD800-\uDFFF]/u.test(value),
  "Use valid Unicode text without null characters.",
);
const name = text.trim().min(1, "Enter a workspace name.").max(80);
const repositoryUrl = text
  .trim()
  .max(2048)
  .refine((value) => {
    // oxlint-disable-next-line no-control-regex -- URL parsing otherwise silently removes control characters.
    if (/[\u0000-\u0020\u007f]/.test(value)) return false;
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !!url.hostname &&
        url.pathname !== "/" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }, "Enter an HTTPS repository URL without credentials, query parameters, or fragments.");
const gitRef = text
  .trim()
  .min(1, "Enter a branch, tag, or commit.")
  .max(200)
  .refine(
    (value) =>
      /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(value) &&
      !value.includes("..") &&
      !value.includes("//") &&
      !value.endsWith(".") &&
      !value.endsWith("/") &&
      value
        .split("/")
        .every((part) => !part.startsWith(".") && !part.endsWith(".lock")),
    "Use a branch, tag, or commit name with letters, numbers, dashes, underscores, dots, and slashes.",
  );
const workingDirectory = text
  .trim()
  .min(1, "Enter a relative directory, or . for the repository root.")
  .max(200)
  .refine(
    (value) =>
      value === "." ||
      (/^[A-Za-z0-9_][A-Za-z0-9._/-]*$/.test(value) &&
        value
          .split("/")
          .every((part) => part !== "" && part !== "." && part !== "..")),
    "Use a relative directory such as . or apps/web; parent traversal is not allowed.",
  );
const command = text.max(1000, "Use 1,000 characters or fewer.");

// This is configuration only. Saving never fetches a URL, pulls an image, or executes a command.
export const WorkspaceDefinitionSchema = z.strictObject({
  name,
  description: text.max(2000),
  repositoryUrl,
  sourceRef: gitRef,
  defaultBranch: gitRef,
  sandboxImage: text
    .trim()
    .min(1, "Enter a container image reference.")
    .max(200)
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9._/:@-]*$/,
      "Enter an image reference without whitespace.",
    ),
  workingDirectory,
  actions: z.strictObject({
    install: command,
    test: command,
    lint: command,
    build: command,
  }),
});
export const CreateWorkspaceRequestSchema = z.strictObject({
  // Client-generated identity makes a retry of the same creation safe.
  id: z.uuid(),
  schemaVersion: z.literal(1),
  definition: WorkspaceDefinitionSchema,
});
export const UpdateWorkspaceRequestSchema = z.strictObject({
  revision: z.number().int().min(1).max(2_147_483_646),
  schemaVersion: z.literal(1),
  definition: WorkspaceDefinitionSchema,
});
export const WorkspaceParamsSchema = z.strictObject({
  teamId: z.uuid(),
  workspaceId: z.uuid(),
});
export const WorkspaceListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});
export const WorkspaceSummarySchema = z.strictObject({
  id: z.uuid(),
  teamId: z.uuid(),
  name,
  revision: z.number().int().positive(),
  versionId: z.uuid(),
  schemaVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
});
// Unknown versions can be displayed as read-only without stripping their stored fields.
export const WorkspaceSchema = WorkspaceSummarySchema.extend({
  definition: z.unknown(),
  createdAt: z.iso.datetime(),
});
export const WorkspaceResponseSchema = z.strictObject({
  workspace: WorkspaceSchema,
});
export const WorkspaceListResponseSchema = z.strictObject({
  workspaces: z.array(WorkspaceSummarySchema).max(50),
  nextCursor: z.uuid().nullable(),
});
export type WorkspaceDefinition = z.infer<typeof WorkspaceDefinitionSchema>;
export type CreateWorkspaceRequest = z.infer<
  typeof CreateWorkspaceRequestSchema
>;
export type UpdateWorkspaceRequest = z.infer<
  typeof UpdateWorkspaceRequestSchema
>;
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type WorkspaceSummary = z.infer<typeof WorkspaceSummarySchema>;
export type WorkspaceListResponse = z.infer<typeof WorkspaceListResponseSchema>;
