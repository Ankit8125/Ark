import { z } from "zod";
import { CatalogTextSchema } from "./catalog-text.js";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";
import {
  REPOSITORY_COMMAND_LIMITS,
  REPOSITORY_CONTAINER_ROOT,
  RepositoryCommandPlanSchema,
  RepositoryCommitOidSchema,
  RepositoryImageDigestSchema,
  type RepositoryCommandPlan,
} from "./repository-command-plan.js";
import {
  RepositoryExecutionOwnershipManifestSchema,
  repositoryOwnershipManifest,
} from "./repository-executions.js";

const digest = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
const identifier = z.uuid().toLowerCase();
const elapsedMs = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const resourceName = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9][a-z0-9_.-]*$/)
  .refine((value) => value === value.trim(), "Use a plain resource name.");

// This is a canonical container-path claim, not an inspection of a filesystem.
// Contained symlinks may resolve somewhere other than the configured lexical path.
export const RepositoryPreparationDirectorySchema = CatalogTextSchema.max(
  222,
).refine((value) => {
  if (/[\p{Cc}\\]/u.test(value)) return false;
  if (value === REPOSITORY_CONTAINER_ROOT) return true;
  if (!value.startsWith(`${REPOSITORY_CONTAINER_ROOT}/`)) return false;
  return value
    .slice(REPOSITORY_CONTAINER_ROOT.length + 1)
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}, "Report a canonical directory inside the repository container root.");

export const RepositoryPreparationBindingSchema = z.strictObject({
  executionId: identifier,
  leaseId: identifier,
  generation: z.literal(1),
  planDigest: digest,
});

export const RepositoryPreparationCommandImageSchema = z.strictObject({
  repositoryDigest: RepositoryImageDigestSchema,
  imageId: z
    .string()
    .length(71)
    .regex(/^sha256:[a-f0-9]{64}$/),
  os: z.literal("linux"),
});

const preparedEvidence = z.strictObject({
  version: z.literal(1),
  outcome: z.literal("prepared"),
  elapsedMs: elapsedMs.max(REPOSITORY_COMMAND_LIMITS.preparationSeconds * 1000),
  sourceCommitOid: RepositoryCommitOidSchema,
  commandImage: RepositoryPreparationCommandImageSchema,
  resolvedWorkingDirectory: RepositoryPreparationDirectorySchema,
  resources: z.strictObject({
    preparationContainer: z.strictObject({
      name: resourceName,
      id: digest,
      status: z.literal("exited"),
      exitCode: z.literal(0),
      ownership: RepositoryPreparationBindingSchema,
    }),
    workspaceVolume: z.strictObject({
      name: resourceName,
      status: z.literal("present"),
      ownership: RepositoryPreparationBindingSchema,
    }),
    commandContainer: z.strictObject({
      name: resourceName,
      status: z.literal("absent"),
    }),
  }),
});
const failedEvidence = z.strictObject({
  version: z.literal(1),
  outcome: z.literal("failed"),
  elapsedMs,
  reason: z.enum([
    "source_unavailable",
    "source_mismatch",
    "image_unavailable",
    "image_mismatch",
    "path_invalid",
    "ownership_mismatch",
    "limits_unenforced",
    "transport_failed",
    "interrupted",
    "unknown",
  ]),
  sourceCommitOid: RepositoryCommitOidSchema.nullable(),
  commandImage: RepositoryPreparationCommandImageSchema.nullable(),
  resolvedWorkingDirectory: RepositoryPreparationDirectorySchema.nullable(),
});

export const RepositoryPreparationEvidenceSchema = z.discriminatedUnion(
  "outcome",
  [preparedEvidence, failedEvidence],
);
export type RepositoryPreparationBinding = z.infer<
  typeof RepositoryPreparationBindingSchema
>;
export type RepositoryPreparationEvidence = z.infer<
  typeof RepositoryPreparationEvidenceSchema
>;

function checkEvidenceBinding(
  binding: RepositoryPreparationBinding,
  evidence: RepositoryPreparationEvidence,
  context: z.RefinementCtx,
): void {
  if (evidence.outcome !== "prepared") return;
  const names = repositoryOwnershipManifest(
    binding.executionId,
    binding.leaseId,
    binding.planDigest,
  ).resources;
  for (const role of [
    "preparationContainer",
    "workspaceVolume",
    "commandContainer",
  ] as const) {
    if (evidence.resources[role].name !== names[role])
      context.addIssue({
        code: "custom",
        path: ["evidence", "resources", role, "name"],
        message: "Use this lease's exact manifest resource name.",
      });
  }
  for (const role of ["preparationContainer", "workspaceVolume"] as const) {
    const ownership = evidence.resources[role].ownership;
    if (
      ownership.executionId !== binding.executionId ||
      ownership.leaseId !== binding.leaseId ||
      ownership.generation !== binding.generation ||
      ownership.planDigest !== binding.planDigest
    )
      context.addIssue({
        code: "custom",
        path: ["evidence", "resources", role, "ownership"],
        message: "Report ownership bound to this execution, lease, and plan.",
      });
  }
}

const payload = z.strictObject({
  id: identifier,
  ...RepositoryPreparationBindingSchema.shape,
  evidence: RepositoryPreparationEvidenceSchema,
});
export const RepositoryPreparationReceiptPayloadSchema = payload.superRefine(
  (value, context) => checkEvidenceBinding(value, value.evidence, context),
);
export const RepositoryPreparationReceiptRequestSchema = payload
  .extend({ leaseToken: digest })
  .superRefine((value, context) =>
    checkEvidenceBinding(value, value.evidence, context),
  );

const boundEvidence = z
  .strictObject({
    binding: RepositoryPreparationBindingSchema,
    evidence: RepositoryPreparationEvidenceSchema,
  })
  .superRefine((value, context) =>
    checkEvidenceBinding(value.binding, value.evidence, context),
  );

export const SavedRepositoryPreparationReceiptSchema = z
  .strictObject({
    id: identifier,
    ...RepositoryPreparationBindingSchema.shape,
    workspace: ResourceVersionReferenceSchema,
    organizationId: identifier,
    teamId: identifier,
    reportedByRunnerId: identifier,
    evidenceStatus: z.literal("runner_reported_unverified"),
    receivedAt: z.iso.datetime(),
    reportDigest: digest,
    manifest: RepositoryExecutionOwnershipManifestSchema,
    evidence: RepositoryPreparationEvidenceSchema,
  })
  .superRefine((receipt, context) => {
    checkEvidenceBinding(receipt, receipt.evidence, context);
    if (
      receipt.manifest.executionId !== receipt.executionId ||
      receipt.manifest.leaseId !== receipt.leaseId ||
      receipt.manifest.generation !== receipt.generation ||
      receipt.manifest.planDigest !== receipt.planDigest
    )
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "Bind the manifest to this receipt's immutable context.",
      });
  });
export const RepositoryPreparationReceiptResponseSchema = z.strictObject({
  preparationReceipt: SavedRepositoryPreparationReceiptSchema,
});
export const RepositoryPreparationReceiptReadResponseSchema = z.strictObject({
  preparationReceipt: SavedRepositoryPreparationReceiptSchema.nullable(),
});

/**
 * Frozen version-1 token-free serialization. Strict schemas reconstruct every
 * nested object's declared field order before JSON.stringify, including JSONB
 * reads. Hash these UTF-8 bytes without a BOM/newline. A different field order,
 * normalization, or evidence meaning requires a new supported receipt version.
 * This journal contains reported observations and never authorizes work.
 */
export function serializeRepositoryPreparationReceiptPayload(
  value: unknown,
): string {
  return JSON.stringify(RepositoryPreparationReceiptPayloadSchema.parse(value));
}

/** Validate reported preparation against immutable intent; this is not trust. */
export function validateRepositoryPreparationEvidence(
  binding: RepositoryPreparationBinding,
  plan: RepositoryCommandPlan,
  evidence: unknown,
): RepositoryPreparationEvidence {
  const value = boundEvidence.parse({ binding, evidence });
  const admitted = RepositoryCommandPlanSchema.parse(plan);
  if (value.evidence.outcome === "prepared") {
    const issues: z.core.$ZodIssue[] = [];
    if (value.evidence.sourceCommitOid !== admitted.source.commitOid)
      issues.push({
        code: "custom",
        path: ["evidence", "sourceCommitOid"],
        message: "Report the exact admitted source commit.",
      });
    if (value.evidence.commandImage.repositoryDigest !== admitted.image.pinned)
      issues.push({
        code: "custom",
        path: ["evidence", "commandImage", "repositoryDigest"],
        message: "Report the exact admitted command-image repository digest.",
      });
    if (issues.length) throw new z.ZodError(issues);
  }
  return value.evidence;
}

export type RepositoryPreparationReceiptRequest = z.infer<
  typeof RepositoryPreparationReceiptRequestSchema
>;
export type RepositoryPreparationReceiptPayload = z.infer<
  typeof RepositoryPreparationReceiptPayloadSchema
>;
export type SavedRepositoryPreparationReceipt = z.infer<
  typeof SavedRepositoryPreparationReceiptSchema
>;
export type RepositoryPreparationReceiptResponse = z.infer<
  typeof RepositoryPreparationReceiptResponseSchema
>;
export type RepositoryPreparationReceiptReadResponse = z.infer<
  typeof RepositoryPreparationReceiptReadResponseSchema
>;
