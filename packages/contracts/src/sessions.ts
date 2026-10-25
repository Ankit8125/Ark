import { z } from "zod";
import { AgentDefinitionSchema } from "./agents.js";
import { CatalogTextSchema } from "./catalog-text.js";
import { FlowDefinitionSchema } from "./flows.js";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";
import { WorkspaceDefinitionSchema } from "./workspaces.js";

export const SESSION_LEASE_SECONDS = 45;
export const SESSION_STUB_RUNTIME = "stub.v1" as const;
export type SessionJson =
  | null
  | boolean
  | number
  | string
  | SessionJson[]
  | { [key: string]: SessionJson };
function boundedJson(value: unknown): boolean {
  const pending = [{ value, depth: 0 }];
  let nodes = 0;
  while (pending.length) {
    const item = pending.pop()!;
    if (++nodes > 256 || item.depth > 12) return false;
    const current = item.value;
    if (
      current === null ||
      typeof current === "boolean" ||
      typeof current === "string"
    )
      continue;
    if (typeof current === "number") {
      if (!Number.isFinite(current)) return false;
      continue;
    }
    if (typeof current !== "object") return false;
    if (
      !Array.isArray(current) &&
      Object.getPrototypeOf(current) !== Object.prototype &&
      Object.getPrototypeOf(current) !== null
    )
      return false;
    for (const child of Object.values(current))
      pending.push({ value: child, depth: item.depth + 1 });
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length <= 4096;
  } catch {
    return false;
  }
}
export const SessionValueSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("text"),
    value: CatalogTextSchema.max(4096),
  }),
  z.strictObject({
    type: z.literal("json"),
    value: z.custom<SessionJson>(
      boundedJson,
      "Use bounded JSON with at most 12 levels.",
    ),
  }),
]);
export const SessionValuesSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/), SessionValueSchema)
  .superRefine((value, context) => {
    if (
      Object.keys(value).length > 8 ||
      new TextEncoder().encode(JSON.stringify(value)).length > 8192
    )
      context.addIssue({
        code: "custom",
        message: "Use at most 8 values and 8192 bytes.",
      });
  });
const revision = z.number().int().min(1).max(2_147_483_647);
const snapshot = <T extends z.ZodType>(definition: T) =>
  ResourceVersionReferenceSchema.extend({ definition });
export const SessionSnapshotSchema = z
  .strictObject({
    flow: snapshot(FlowDefinitionSchema),
    workspace: snapshot(WorkspaceDefinitionSchema),
    agents: z.array(snapshot(AgentDefinitionSchema)).min(1).max(20),
  })
  .superRefine((value, context) => {
    const key = (reference: { resourceId: string; versionId: string }) =>
      `${reference.resourceId}:${reference.versionId}`;
    const agents = new Set(value.agents.map(key));
    if (
      key(value.workspace) !== key(value.flow.definition.workspace) ||
      agents.size !== value.agents.length ||
      value.flow.definition.stages.some(
        (stage) => !agents.has(key(stage.agent)),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Snapshot definitions must match every pinned dependency.",
      });
  });
export const SessionPreviewRequestSchema = z.strictObject({
  flow: ResourceVersionReferenceSchema,
  runnerId: z.uuid().toLowerCase(),
  inputValues: SessionValuesSchema,
});
export const StartSessionRequestSchema = SessionPreviewRequestSchema.extend({
  id: z.uuid().toLowerCase(),
});
export const SessionPreviewResponseSchema = z.strictObject({
  snapshot: SessionSnapshotSchema,
  runnerId: z.uuid().toLowerCase(),
  inputValues: SessionValuesSchema,
});
export const SessionStateSchema = z.enum([
  "queued",
  "running",
  "blocked",
  "cancelling",
  "cancelled",
  "failed",
  "completed",
]);
export const SessionSummarySchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  organizationId: z.uuid().toLowerCase(),
  teamId: z.uuid().toLowerCase(),
  startedBy: z.uuid().toLowerCase(),
  runnerId: z.uuid().toLowerCase(),
  flowResourceId: z.uuid().toLowerCase(),
  flowVersionId: z.uuid().toLowerCase(),
  flowName: CatalogTextSchema.trim().min(1).max(80),
  state: SessionStateSchema,
  revision,
  stageIndex: z.number().int().min(0).max(20),
  blockReason: z
    .enum([
      "lease_expired",
      "permission_changed",
      "runner_stopped",
      "recovery_required",
    ])
    .nullable(),
  runtime: z.literal(SESSION_STUB_RUNTIME),
  quality: z.literal("not_evaluated"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export const ExecutionSessionSchema = SessionSummarySchema.extend({
  snapshot: SessionSnapshotSchema,
  inputValues: SessionValuesSchema,
  stageResults: z.record(z.uuid().toLowerCase(), SessionValuesSchema),
  outputs: SessionValuesSchema.nullable(),
});
export const SessionResponseSchema = z.strictObject({
  session: ExecutionSessionSchema,
});
export const SessionListResponseSchema = z.strictObject({
  sessions: z.array(SessionSummarySchema).max(50),
  nextCursor: z.uuid().toLowerCase().nullable(),
});
export const SessionTeamParamsSchema = z.strictObject({
  teamId: z.uuid().toLowerCase(),
});
export const SessionParamsSchema = SessionTeamParamsSchema.extend({
  sessionId: z.uuid().toLowerCase(),
});
export const SessionListQuerySchema = z.strictObject({
  cursor: z.uuid().toLowerCase().optional(),
});
export const SessionCancelRequestSchema = z.strictObject({
  expectedRevision: revision,
});
export const SessionReconcileRequestSchema = SessionCancelRequestSchema.extend({
  confirmedStopped: z.literal(true),
});
export const SessionEventSchema = z.strictObject({
  sessionId: z.uuid().toLowerCase(),
  sequence: revision,
  id: z.uuid().toLowerCase(),
  kind: z.enum([
    "created",
    "claimed",
    "stage_completed",
    "cancelling",
    "lease_uncertain",
    "cancelled",
    "failed",
    "completed",
    "recovery_recorded",
  ]),
  state: SessionStateSchema,
  stageIndex: z.number().int().min(0).max(20),
  createdAt: z.iso.datetime(),
});
export const SessionEventLogQuerySchema = z.strictObject({
  after: z
    .string()
    .regex(/^(0|[1-9]\d*)$/)
    // JavaScript's $ also matches before a final line terminator. Do not let
    // Number() silently normalize a malformed cursor after regex validation.
    .refine((value) => value === value.trim(), "Use a plain event sequence.")
    .transform(Number)
    .pipe(z.number().int().min(0).max(2_147_483_647))
    .optional(),
});
export const SessionEventLogResponseSchema = z.strictObject({
  events: z.array(SessionEventSchema).max(100),
  nextAfter: z.number().int().min(0).max(2_147_483_647).nullable(),
});
export const SessionLeaseSchema = z.strictObject({
  id: z.uuid().toLowerCase(),
  generation: revision,
  status: z.enum(["active", "uncertain", "released"]),
  expiresAt: z.iso.datetime(),
});
export const SessionJobSchema = z.strictObject({
  session: ExecutionSessionSchema,
  lease: SessionLeaseSchema,
});
export const SessionClaimRequestSchema = z.strictObject({
  claimId: z.uuid().toLowerCase(),
  leaseToken: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  runtime: z.literal(SESSION_STUB_RUNTIME),
});
export const SessionClaimResponseSchema = z.strictObject({
  job: SessionJobSchema.nullable(),
});
const progress = {
  eventId: z.uuid().toLowerCase(),
  leaseId: z.uuid().toLowerCase(),
  leaseToken: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  generation: revision,
  expectedRevision: revision,
};
export const SessionAdvanceRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...progress,
    kind: z.literal("stage_completed"),
    stageId: z.uuid().toLowerCase(),
    outputs: SessionValuesSchema,
  }),
  z.strictObject({
    ...progress,
    kind: z.literal("completed"),
    confirmedStopped: z.literal(true),
  }),
  z.strictObject({
    ...progress,
    kind: z.literal("stopped"),
    confirmedStopped: z.literal(true),
  }),
]);
export type SessionValue = z.infer<typeof SessionValueSchema>;
export type SessionValues = z.infer<typeof SessionValuesSchema>;
export type SessionSnapshot = z.infer<typeof SessionSnapshotSchema>;
export type SessionPreviewRequest = z.infer<typeof SessionPreviewRequestSchema>;
export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;
export type SessionPreviewResponse = z.infer<
  typeof SessionPreviewResponseSchema
>;
export type ExecutionSession = z.infer<typeof ExecutionSessionSchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionState = z.infer<typeof SessionStateSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
export type SessionEventLogResponse = z.infer<
  typeof SessionEventLogResponseSchema
>;
export type SessionLease = z.infer<typeof SessionLeaseSchema>;
export type SessionJob = z.infer<typeof SessionJobSchema>;
export type SessionClaimRequest = z.infer<typeof SessionClaimRequestSchema>;
export type SessionClaimResponse = z.infer<typeof SessionClaimResponseSchema>;
export type SessionAdvanceRequest = z.infer<typeof SessionAdvanceRequestSchema>;
export type SessionCancelRequest = z.infer<typeof SessionCancelRequestSchema>;
export type SessionReconcileRequest = z.infer<
  typeof SessionReconcileRequestSchema
>;

export function validateSessionInputs(
  snapshot: SessionSnapshot,
  values: SessionValues,
): void {
  const ports = snapshot.flow.definition.inputs;
  if (
    Object.keys(values).length !== ports.length ||
    ports.some(
      (port) =>
        !Object.hasOwn(values, port.name) ||
        values[port.name]!.type !== port.type,
    )
  )
    throw new Error("Supply exactly the declared Flow input names and types.");
}
export function stubStageOutputs(
  session: Pick<
    ExecutionSession,
    "snapshot" | "inputValues" | "stageResults" | "stageIndex"
  >,
): SessionValues {
  const stage = session.snapshot.flow.definition.stages[session.stageIndex];
  if (!stage) throw new Error("No pending stage.");
  const resolved = Object.fromEntries(
    stage.inputs.map((binding) => {
      const source = binding.source;
      const values =
        source.kind === "flow_input"
          ? session.inputValues
          : session.stageResults[source.stageId];
      const value =
        values && Object.hasOwn(values, source.port)
          ? values[source.port]
          : undefined;
      if (!value || value.type !== binding.type)
        throw new Error("A stage input is unavailable.");
      return [binding.name, value];
    }),
  );
  return SessionValuesSchema.parse(
    Object.fromEntries(
      stage.outputs.map((port) => [
        port.name,
        port.type === "text"
          ? {
              type: "text",
              value: `[stub.v1] ${stage.name}.${port.name} (${Object.keys(resolved).sort().join(", ")})`,
            }
          : {
              type: "json",
              value: {
                runtime: SESSION_STUB_RUNTIME,
                stageId: stage.id,
                port: port.name,
                inputPorts: Object.keys(resolved).sort(),
              },
            },
      ]),
    ),
  );
}
export function stubFinalOutputs(
  session: Pick<ExecutionSession, "snapshot" | "stageResults">,
): SessionValues {
  return SessionValuesSchema.parse(
    Object.fromEntries(
      session.snapshot.flow.definition.outputs.map((binding) => {
        const values = session.stageResults[binding.source.stageId];
        const value =
          values && Object.hasOwn(values, binding.source.port)
            ? values[binding.source.port]
            : undefined;
        if (!value || value.type !== binding.type)
          throw new Error("A final output is unavailable.");
        return [binding.name, value];
      }),
    ),
  );
}
