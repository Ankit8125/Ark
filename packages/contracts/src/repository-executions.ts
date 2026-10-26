import { z } from "zod";
import { CatalogTextSchema } from "./catalog-text.js";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";
import {
  REPOSITORY_COMMAND_POLICY,
  REPOSITORY_COMMAND_RUNTIME,
  RepositoryCommandPlanSchema,
} from "./repository-command-plan.js";
import { SavedRepositoryPlanSchema } from "./repository-plans.js";

const planDigest = SavedRepositoryPlanSchema.shape.planDigest;
const revision = z.number().int().min(1).max(2_147_483_647);
const controlSequence = z.number().int().min(0).max(2_147_483_647);
const leaseToken = z
  .string()
  .length(64)
  .regex(/^[a-f0-9]{64}$/);
const blockReason = z.enum([
  "lease_expired",
  "permission_changed",
  "preparation_deadline",
  "run_deadline",
]);
const compatibility = z.enum([
  "pending_runner_claim",
  "repository_protocol_declared",
]);

export const RepositoryExecutionPreviewRequestSchema = z.strictObject({
  repositoryPlanId: z.uuid().toLowerCase(),
  expectedPlanDigest: planDigest,
  runnerId: z.uuid().toLowerCase(),
});
export const StartRepositoryExecutionRequestSchema =
  RepositoryExecutionPreviewRequestSchema.extend({
    id: z.uuid().toLowerCase(),
  });
export const RepositoryExecutionPreviewResponseSchema = z.strictObject({
  repositoryPlan: SavedRepositoryPlanSchema,
  runnerId: z.uuid().toLowerCase(),
  compatibility: z.literal("pending_runner_claim"),
});
export const RepositoryExecutionStateSchema = z.enum([
  "queued",
  "running",
  "blocked",
  "cancelling",
  "cancelled",
]);
export const RepositoryExecutionSummarySchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  organizationId: z.uuid().toLowerCase(),
  teamId: z.uuid().toLowerCase(),
  startedBy: z.uuid().toLowerCase(),
  runnerId: z.uuid().toLowerCase(),
  repositoryPlanId: z.uuid().toLowerCase(),
  planDigest,
  workspace: ResourceVersionReferenceSchema,
  workspaceName: CatalogTextSchema.trim().min(1).max(80),
  runtime: z.literal(REPOSITORY_COMMAND_RUNTIME),
  policy: z.literal(REPOSITORY_COMMAND_POLICY),
  state: RepositoryExecutionStateSchema,
  revision,
  blockReason: blockReason.nullable(),
  compatibility,
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  claimedAt: z.iso.datetime().nullable(),
  runDeadlineAt: z.iso.datetime().nullable(),
  preparationDeadlineAt: z.iso.datetime().nullable(),
});
export const RepositoryExecutionSchema =
  RepositoryExecutionSummarySchema.extend({
    plan: RepositoryCommandPlanSchema,
  }).superRefine((execution, context) => {
    if (
      execution.workspace.resourceId !== execution.plan.workspace.resourceId ||
      execution.workspace.versionId !== execution.plan.workspace.versionId
    )
      context.addIssue({
        code: "custom",
        path: ["workspace"],
        message: "Use the Workspace pin from the admitted repository plan.",
      });
  });
export const RepositoryExecutionResponseSchema = z.strictObject({
  repositoryExecution: RepositoryExecutionSchema,
});
export const RepositoryExecutionListResponseSchema = z.strictObject({
  repositoryExecutions: z.array(RepositoryExecutionSummarySchema).max(50),
  nextCursor: z.uuid().toLowerCase().nullable(),
});
export const RepositoryExecutionTeamParamsSchema = z.strictObject({
  teamId: z.uuid().toLowerCase(),
});
export const RepositoryExecutionParamsSchema =
  RepositoryExecutionTeamParamsSchema.extend({
    executionId: z.uuid().toLowerCase(),
  });
export const RepositoryExecutionListQuerySchema = z.strictObject({
  cursor: z.uuid().toLowerCase().optional(),
});
export const RepositoryExecutionCancelRequestSchema = z.strictObject({
  expectedRevision: revision,
});
export const RepositoryExecutionEventSchema = z.strictObject({
  executionId: z.uuid().toLowerCase(),
  id: z.uuid().toLowerCase(),
  sequence: revision,
  kind: z.enum(["created", "claimed", "cancel_requested", "lease_uncertain"]),
  state: RepositoryExecutionStateSchema,
  blockReason: blockReason.nullable(),
  createdAt: z.iso.datetime(),
});
export const RepositoryExecutionEventLogQuerySchema = z.strictObject({
  after: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    .refine((value) => value === value.trim(), "Use a plain event sequence.")
    .transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647))
    .optional(),
});
export const RepositoryExecutionEventLogResponseSchema = z.strictObject({
  events: z.array(RepositoryExecutionEventSchema).max(100),
  nextAfter: controlSequence.nullable(),
});
export const RepositoryExecutionClaimRequestSchema = z.strictObject({
  claimId: z.uuid().toLowerCase(),
  leaseToken,
  runtime: z.literal(REPOSITORY_COMMAND_RUNTIME),
  policy: z.literal(REPOSITORY_COMMAND_POLICY),
});
export const RepositoryExecutionLeaseSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  generation: z.literal(1),
  status: z.enum(["active", "uncertain", "released"]),
  expiresAt: z.iso.datetime(),
  controlSequence,
});

function resourceNames(leaseId: string) {
  const prefix = `ark-repo-${leaseId}-g1`;
  return {
    preparationContainer: `${prefix}-prep`,
    commandContainer: `${prefix}-command`,
    workspaceVolume: `${prefix}-workspace`,
  };
}

// Ownership intent only: these names neither observe a resource nor prove that
// it exists, is contained, has stopped, or is safe to remove.
export const RepositoryExecutionOwnershipManifestSchema = z
  .strictObject({
    version: z.literal(1),
    executionId: z.uuid().toLowerCase(),
    leaseId: z.uuid().toLowerCase(),
    generation: z.literal(1),
    planDigest,
    resources: z.strictObject({
      preparationContainer: z.string().max(100),
      commandContainer: z.string().max(100),
      workspaceVolume: z.string().max(100),
    }),
  })
  .superRefine((manifest, context) => {
    const expected = resourceNames(manifest.leaseId);
    for (const name of Object.keys(expected) as (keyof typeof expected)[])
      if (manifest.resources[name] !== expected[name])
        context.addIssue({
          code: "custom",
          path: ["resources", name],
          message: "Use the resource identity derived from this exact lease.",
        });
  });

export function repositoryOwnershipManifest(
  executionId: string,
  leaseId: string,
  digest: string,
): RepositoryExecutionOwnershipManifest {
  const identity = z
    .strictObject({
      executionId: z.uuid().toLowerCase(),
      leaseId: z.uuid().toLowerCase(),
      planDigest,
    })
    .parse({ executionId, leaseId, planDigest: digest });
  return RepositoryExecutionOwnershipManifestSchema.parse({
    version: 1,
    ...identity,
    generation: 1,
    resources: resourceNames(identity.leaseId),
  });
}

export const RepositoryExecutionControlSchema = z
  .strictObject({
    decision: z.enum(["prepare", "stop"]),
    reason: z
      .enum([
        "cancelled",
        "cancelling",
        "lease_expired",
        "permission_changed",
        "preparation_deadline",
        "run_deadline",
        "uncertain",
        "authorization_window",
      ])
      .nullable(),
    serverNow: z.iso.datetime(),
    authorizedForMs: z.number().int().min(0).max(45_000),
    workDeadlineAt: z.iso.datetime(),
    runDeadlineAt: z.iso.datetime(),
  })
  .superRefine((control, context) => {
    if (
      (control.decision === "prepare" &&
        (control.reason !== null || control.authorizedForMs === 0)) ||
      (control.decision === "stop" &&
        (control.reason === null || control.authorizedForMs !== 0))
    )
      context.addIssue({
        code: "custom",
        message:
          "Only a positive preparation window may authorize preparation.",
      });
    if (
      Date.parse(control.workDeadlineAt) > Date.parse(control.runDeadlineAt) ||
      (control.decision === "prepare" &&
        Date.parse(control.serverNow) + control.authorizedForMs >
          Date.parse(control.workDeadlineAt))
    )
      context.addIssue({
        code: "custom",
        path: ["workDeadlineAt"],
        message:
          "Keep preparation authority within the fixed work/run deadlines.",
      });
  });
export const RepositoryExecutionControlRequestSchema = z.strictObject({
  controlId: z.uuid().toLowerCase(),
  executionId: z.uuid().toLowerCase(),
  leaseId: z.uuid().toLowerCase(),
  leaseToken,
  generation: z.literal(1),
  expectedControlSequence: z.number().int().min(0).max(2_147_483_646),
  planDigest,
});
export const RepositoryExecutionControlReceiptSchema =
  RepositoryExecutionControlRequestSchema.omit({ leaseToken: true });
export const RepositoryExecutionJobSchema = z
  .strictObject({
    execution: RepositoryExecutionSchema,
    lease: RepositoryExecutionLeaseSchema,
    manifest: RepositoryExecutionOwnershipManifestSchema,
    control: RepositoryExecutionControlSchema,
  })
  .superRefine((job, context) => {
    if (
      job.manifest.executionId !== job.execution.id ||
      job.manifest.leaseId !== job.lease.id ||
      job.manifest.generation !== job.lease.generation ||
      job.manifest.planDigest !== job.execution.planDigest
    )
      context.addIssue({
        code: "custom",
        path: ["manifest"],
        message: "Bind ownership intent to this execution, lease, and plan.",
      });
    if (
      job.execution.claimedAt === null ||
      job.execution.runDeadlineAt === null ||
      job.execution.preparationDeadlineAt === null ||
      job.control.runDeadlineAt !== job.execution.runDeadlineAt ||
      (job.control.decision === "prepare" &&
        (job.execution.state !== "running" ||
          job.lease.status !== "active" ||
          Date.parse(job.control.serverNow) + job.control.authorizedForMs >
            Date.parse(job.lease.expiresAt)))
    )
      context.addIssue({
        code: "custom",
        path: ["control"],
        message:
          "Use the current claimed execution and active preparation lease.",
      });
  });
export const RepositoryExecutionClaimResponseSchema = z.strictObject({
  job: RepositoryExecutionJobSchema.nullable(),
});

export type RepositoryExecutionPreviewRequest = z.infer<
  typeof RepositoryExecutionPreviewRequestSchema
>;
export type StartRepositoryExecutionRequest = z.infer<
  typeof StartRepositoryExecutionRequestSchema
>;
export type RepositoryExecutionPreviewResponse = z.infer<
  typeof RepositoryExecutionPreviewResponseSchema
>;
export type RepositoryExecution = z.infer<typeof RepositoryExecutionSchema>;
export type RepositoryExecutionSummary = z.infer<
  typeof RepositoryExecutionSummarySchema
>;
export type RepositoryExecutionResponse = z.infer<
  typeof RepositoryExecutionResponseSchema
>;
export type RepositoryExecutionListResponse = z.infer<
  typeof RepositoryExecutionListResponseSchema
>;
export type RepositoryExecutionState = z.infer<
  typeof RepositoryExecutionStateSchema
>;
export type RepositoryExecutionTeamParams = z.infer<
  typeof RepositoryExecutionTeamParamsSchema
>;
export type RepositoryExecutionParams = z.infer<
  typeof RepositoryExecutionParamsSchema
>;
export type RepositoryExecutionListQuery = z.infer<
  typeof RepositoryExecutionListQuerySchema
>;
export type RepositoryExecutionCancelRequest = z.infer<
  typeof RepositoryExecutionCancelRequestSchema
>;
export type RepositoryExecutionEvent = z.infer<
  typeof RepositoryExecutionEventSchema
>;
export type RepositoryExecutionEventLogQuery = z.infer<
  typeof RepositoryExecutionEventLogQuerySchema
>;
export type RepositoryExecutionEventLogResponse = z.infer<
  typeof RepositoryExecutionEventLogResponseSchema
>;
export type RepositoryExecutionClaimRequest = z.infer<
  typeof RepositoryExecutionClaimRequestSchema
>;
export type RepositoryExecutionClaimResponse = z.infer<
  typeof RepositoryExecutionClaimResponseSchema
>;
export type RepositoryExecutionLease = z.infer<
  typeof RepositoryExecutionLeaseSchema
>;
export type RepositoryExecutionOwnershipManifest = z.infer<
  typeof RepositoryExecutionOwnershipManifestSchema
>;
export type RepositoryExecutionControl = z.infer<
  typeof RepositoryExecutionControlSchema
>;
export type RepositoryExecutionControlRequest = z.infer<
  typeof RepositoryExecutionControlRequestSchema
>;
export type RepositoryExecutionControlReceipt = z.infer<
  typeof RepositoryExecutionControlReceiptSchema
>;
export type RepositoryExecutionJob = z.infer<
  typeof RepositoryExecutionJobSchema
>;
