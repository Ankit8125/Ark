import { z } from "zod";
import { CatalogTextSchema } from "./catalog-text.js";

export const RUNNER_ENROLLMENT_TTL_SECONDS = 600;
export const RUNNER_HEARTBEAT_INTERVAL_SECONDS = 15;
export const RUNNER_OFFLINE_AFTER_SECONDS = 60;
export const EnrollmentTokenSchema = z
  .string()
  // The exact length also rejects a final newline, which JavaScript's $ accepts.
  .length(112)
  .regex(/^ark_enroll_[a-f0-9-]{36}_[a-f0-9]{64}$/)
  .refine(
    (value) => z.uuid().safeParse(value.split("_")[2]).success,
    "Invalid enrollment identity.",
  );
export const RunnerCredentialSchema = z
  .string()
  .length(112)
  .regex(/^ark_runner_[a-f0-9-]{36}_[a-f0-9]{64}$/)
  .refine(
    (value) => z.uuid().safeParse(value.split("_")[2]).success,
    "Invalid runner identity.",
  );
export const RunnerTeamParamsSchema = z.strictObject({ teamId: z.uuid() });
export const RunnerParamsSchema = z.strictObject({
  teamId: z.uuid(),
  runnerId: z.uuid(),
});
export const RunnerListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
});
export const CreateRunnerEnrollmentRequestSchema = z
  .strictObject({
    id: z.uuid(),
    name: CatalogTextSchema.trim()
      .min(1, "Enter a runner name.")
      .max(80, "Use 80 characters or fewer."),
    enrollmentToken: EnrollmentTokenSchema,
  })
  .superRefine((value, context) => {
    if (value.enrollmentToken.split("_")[2] !== value.id)
      context.addIssue({
        code: "custom",
        path: ["enrollmentToken"],
        message: "Enrollment identity must match the runner.",
      });
  });
export const EnrollRunnerRequestSchema = z.strictObject({
  runnerCredential: RunnerCredentialSchema,
});
export const RunnerHeartbeatRequestSchema = z.strictObject({});
export const RevokeRunnerRequestSchema = z.strictObject({
  expectedLifecycleRevision: z.number().int().min(1).max(2_147_483_647),
});
export const RunnerSchema = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  teamId: z.uuid(),
  name: CatalogTextSchema.trim().min(1).max(80),
  lifecycleRevision: z.number().int().min(1).max(2_147_483_647),
  createdAt: z.iso.datetime(),
  enrollmentExpiresAt: z.iso.datetime(),
  enrolledAt: z.iso.datetime().nullable(),
  lastHeartbeatAt: z.iso.datetime().nullable(),
  revokedAt: z.iso.datetime().nullable(),
  health: z.enum(["unknown", "online", "offline"]),
  dispatchApproved: z.literal(false),
});
export const RunnerResponseSchema = z.strictObject({
  runner: RunnerSchema,
  observedAt: z.iso.datetime(),
});
export const RunnerListResponseSchema = z.strictObject({
  runners: z.array(RunnerSchema).max(50),
  nextCursor: z.uuid().nullable(),
  observedAt: z.iso.datetime(),
});
export type Runner = z.infer<typeof RunnerSchema>;
export type RunnerResponse = z.infer<typeof RunnerResponseSchema>;
export type RunnerListResponse = z.infer<typeof RunnerListResponseSchema>;
export type CreateRunnerEnrollmentRequest = z.infer<
  typeof CreateRunnerEnrollmentRequestSchema
>;
export type EnrollRunnerRequest = z.infer<typeof EnrollRunnerRequestSchema>;
export type RevokeRunnerRequest = z.infer<typeof RevokeRunnerRequestSchema>;
