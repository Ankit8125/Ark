import { createHash } from "node:crypto";
import {
  RepositoryCommandPlanSchema,
  RepositoryPreparationReceiptPayloadSchema,
  RepositoryPreparationReceiptReadResponseSchema,
  RepositoryPreparationReceiptResponseSchema,
  SavedRepositoryPreparationReceiptSchema,
  repositoryOwnershipManifest,
  serializeRepositoryPreparationReceiptPayload,
  validateRepositoryPreparationEvidence,
  type RepositoryCommandPlan,
  type RepositoryPreparationReceiptPayload,
  type RepositoryPreparationReceiptReadResponse,
  type RepositoryPreparationReceiptRequest,
  type RepositoryPreparationReceiptResponse,
  type SavedRepositoryPreparationReceipt,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";
import { repositoryPlanDigest } from "./repository-plans.js";
import { runnerBearer } from "./runners.js";
import { authenticateWorkRunner } from "./work-authorization.js";

interface ExecutionContext {
  id: string;
  organization_id: string;
  team_id: string;
  runner_id: string;
  workspace_id: string;
  workspace_version_id: string;
  plan_digest: string;
  plan: RepositoryCommandPlan;
}
interface ReceiptRow {
  id: string;
  execution_id: string;
  lease_id: string;
  generation: number;
  runtime: string;
  organization_id: string;
  team_id: string;
  reported_by_runner_id: string;
  workspace_id: string;
  workspace_version_id: string;
  plan_digest: string;
  request: unknown;
  report_digest: string;
  received_at: Date;
  evidence_status: string;
}
interface LeaseIdentity {
  id: string;
  generation: number;
}

const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const conflict = () =>
  new ApiFailure(
    409,
    "ID_CONFLICT",
    "This preparation receipt identity already has different details.",
  );
const leaseDenied = () =>
  new ApiFailure(
    401,
    "LEASE_UNAUTHENTICATED",
    "The work lease is unavailable or no longer valid.",
  );
const notFound = () =>
  new ApiFailure(
    404,
    "NOT_FOUND",
    "The requested repository execution was not found.",
  );

async function executionContext(
  client: PoolClient,
  id: string,
  access?: TeamAccess,
  runnerId?: string,
  lock = false,
): Promise<ExecutionContext | undefined> {
  return (
    await client.query<ExecutionContext>(
      `SELECT e.id,e.organization_id,e.team_id,e.runner_id,e.workspace_id,e.workspace_version_id,e.plan_digest,p.plan
       FROM repository_executions e JOIN repository_plans p ON p.id=e.repository_plan_id
       WHERE e.id=$1 AND ($2::uuid IS NULL OR e.organization_id=$2)
       AND ($3::uuid IS NULL OR e.team_id=$3) AND ($4::uuid IS NULL OR e.runner_id=$4)
       ${lock ? "FOR UPDATE OF e" : ""}`,
      [
        id,
        access?.organizationId ?? null,
        access?.team.id ?? null,
        runnerId ?? null,
      ],
    )
  ).rows[0];
}

function plan(context: ExecutionContext): RepositoryCommandPlan {
  const value = RepositoryCommandPlanSchema.parse(context.plan);
  if (
    repositoryPlanDigest(value) !== context.plan_digest ||
    value.workspace.resourceId !== context.workspace_id ||
    value.workspace.versionId !== context.workspace_version_id
  )
    throw new Error("Repository preparation context integrity check failed.");
  return value;
}

function binding(payload: RepositoryPreparationReceiptPayload) {
  return {
    executionId: payload.executionId,
    leaseId: payload.leaseId,
    generation: payload.generation,
    planDigest: payload.planDigest,
  };
}

function savedReceipt(
  row: ReceiptRow,
  context: ExecutionContext,
): SavedRepositoryPreparationReceipt {
  const payload = RepositoryPreparationReceiptPayloadSchema.parse(row.request);
  if (
    row.execution_id !== context.id ||
    row.reported_by_runner_id !== context.runner_id ||
    row.team_id !== context.team_id ||
    row.organization_id !== context.organization_id ||
    row.workspace_id !== context.workspace_id ||
    row.workspace_version_id !== context.workspace_version_id ||
    row.plan_digest !== context.plan_digest ||
    row.runtime !== "repository.v1" ||
    payload.id !== row.id ||
    payload.executionId !== row.execution_id ||
    payload.leaseId !== row.lease_id ||
    payload.generation !== row.generation ||
    payload.planDigest !== row.plan_digest ||
    hash(serializeRepositoryPreparationReceiptPayload(payload)) !==
      row.report_digest
  )
    throw new Error("Saved preparation receipt integrity check failed.");
  validateRepositoryPreparationEvidence(
    binding(payload),
    plan(context),
    payload.evidence,
  );
  return SavedRepositoryPreparationReceiptSchema.parse({
    id: row.id,
    executionId: row.execution_id,
    leaseId: row.lease_id,
    generation: row.generation,
    planDigest: row.plan_digest,
    workspace: {
      resourceId: row.workspace_id,
      versionId: row.workspace_version_id,
    },
    organizationId: row.organization_id,
    teamId: row.team_id,
    reportedByRunnerId: row.reported_by_runner_id,
    evidenceStatus: row.evidence_status,
    receivedAt: row.received_at.toISOString(),
    reportDigest: row.report_digest,
    manifest: repositoryOwnershipManifest(
      row.execution_id,
      row.lease_id,
      row.plan_digest,
    ),
    evidence: payload.evidence,
  });
}

async function existingReceipt(
  client: PoolClient,
  payload: RepositoryPreparationReceiptPayload,
): Promise<ReceiptRow | undefined> {
  // Both lookups use unique keys. Receipts are immutable and need no UPDATE lock.
  const rows = (
    await client.query<ReceiptRow>(
      "SELECT * FROM repository_preparation_receipts WHERE id=$1 OR lease_id=$2",
      [payload.id, payload.leaseId],
    )
  ).rows;
  if (rows.length > 1) throw conflict();
  return rows[0];
}

function replay(
  row: ReceiptRow,
  context: ExecutionContext,
  payload: RepositoryPreparationReceiptPayload,
): RepositoryPreparationReceiptResponse {
  if (
    row.id !== payload.id ||
    row.lease_id !== payload.leaseId ||
    row.execution_id !== payload.executionId ||
    row.reported_by_runner_id !== context.runner_id ||
    serializeRepositoryPreparationReceiptPayload(row.request) !==
      serializeRepositoryPreparationReceiptPayload(payload)
  )
    throw conflict();
  return RepositoryPreparationReceiptResponseSchema.parse({
    preparationReceipt: savedReceipt(row, context),
  });
}

export class RepositoryPreparationReceiptService {
  private readonly pool: Pool;
  private readonly identity: IdentityService;

  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  async upload(
    authorization: string | undefined,
    input: RepositoryPreparationReceiptRequest,
  ): Promise<{
    created: boolean;
    response: RepositoryPreparationReceiptResponse;
  }> {
    const credential = runnerBearer(authorization, "runner");
    const { leaseToken: _, ...safeInput } = input;
    const payload = RepositoryPreparationReceiptPayloadSchema.parse(safeInput);
    const serialized = serializeRepositoryPreparationReceiptPayload(payload);
    return withTransaction(this.pool, async (client) => {
      // Reporting grants no work authority. Only current machine identity and
      // its exact immutable ownership are needed, including for late history.
      const runner = await authenticateWorkRunner(client, credential, true);
      const context = await executionContext(
        client,
        payload.executionId,
        undefined,
        runner.id,
        true,
      );
      if (!context) throw leaseDenied();
      const lease = (
        await client.query<LeaseIdentity>(
          `SELECT id,generation FROM session_leases WHERE id=$1 AND runtime='repository.v1'
           AND repository_execution_id=$2 AND runner_id=$3 AND team_id=$4 AND organization_id=$5
           AND workspace_id=$6 AND token_hash=$7 FOR UPDATE`,
          [
            payload.leaseId,
            context.id,
            runner.id,
            runner.team_id,
            runner.organization_id,
            context.workspace_id,
            hash(input.leaseToken),
          ],
        )
      ).rows[0];
      if (
        !lease ||
        lease.generation !== payload.generation ||
        context.plan_digest !== payload.planDigest
      )
        throw leaseDenied();
      const compiled = plan(context);
      const existing = await existingReceipt(client, payload);
      if (existing)
        return { created: false, response: replay(existing, context, payload) };
      try {
        validateRepositoryPreparationEvidence(
          binding(payload),
          compiled,
          payload.evidence,
        );
      } catch (error) {
        if (!(error instanceof ZodError)) throw error;
        throw new ApiFailure(
          400,
          "INVALID_PREPARATION_EVIDENCE",
          "Use preparation observations bound to this exact plan and ownership.",
        );
      }
      const inserted = (
        await client.query<ReceiptRow>(
          `INSERT INTO repository_preparation_receipts(id,execution_id,lease_id,generation,organization_id,team_id,reported_by_runner_id,workspace_id,workspace_version_id,plan_digest,request,report_digest)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) ON CONFLICT DO NOTHING RETURNING *`,
          [
            payload.id,
            context.id,
            lease.id,
            lease.generation,
            context.organization_id,
            context.team_id,
            runner.id,
            context.workspace_id,
            context.workspace_version_id,
            context.plan_digest,
            serialized,
            hash(serialized),
          ],
        )
      ).rows[0];
      if (!inserted) {
        const winner = await existingReceipt(client, payload);
        if (!winner) throw conflict();
        return { created: false, response: replay(winner, context, payload) };
      }
      await client.query(
        "INSERT INTO audit_events(organization_id,actor_user_id,action,target_id,metadata) VALUES($1,NULL,'repository_preparation.received',$2,$3::jsonb)",
        [
          context.organization_id,
          payload.id,
          JSON.stringify({
            teamId: context.team_id,
            runnerId: runner.id,
            executionId: context.id,
            leaseId: lease.id,
          }),
        ],
      );
      return {
        created: true,
        response: RepositoryPreparationReceiptResponseSchema.parse({
          preparationReceipt: savedReceipt(inserted, context),
        }),
      };
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    executionId: string,
  ): Promise<RepositoryPreparationReceiptReadResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const context = await executionContext(client, executionId, access);
      if (!context) throw notFound();
      const row = (
        await client.query<ReceiptRow>(
          "SELECT * FROM repository_preparation_receipts WHERE execution_id=$1",
          [executionId],
        )
      ).rows[0];
      const result = RepositoryPreparationReceiptReadResponseSchema.parse({
        preparationReceipt: row ? savedReceipt(row, context) : null,
      });
      await this.identity.recheckSessionExpiry(access, client);
      return result;
    });
  }
}
