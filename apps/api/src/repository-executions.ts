import { createHash, randomUUID } from "node:crypto";
import {
  RepositoryExecutionClaimResponseSchema,
  RepositoryExecutionControlReceiptSchema,
  RepositoryExecutionEventLogResponseSchema,
  RepositoryExecutionJobSchema,
  RepositoryExecutionListResponseSchema,
  RepositoryExecutionPreviewResponseSchema,
  RepositoryExecutionResponseSchema,
  RepositoryExecutionSchema,
  StartRepositoryExecutionRequestSchema,
  WorkspaceDefinitionSchema,
  compileRepositoryCommandPlan,
  repositoryOwnershipManifest,
  serializeRepositoryCommandPlan,
  SESSION_LEASE_SECONDS,
  type RepositoryCommandPlan,
  type RepositoryExecution,
  type RepositoryExecutionClaimRequest,
  type RepositoryExecutionClaimResponse,
  type RepositoryExecutionControlRequest,
  type RepositoryExecutionEventLogResponse,
  type RepositoryExecutionJob,
  type RepositoryExecutionListResponse,
  type RepositoryExecutionPreviewRequest,
  type RepositoryExecutionPreviewResponse,
  type RepositoryExecutionResponse,
  type SavedRepositoryPlan,
  type StartRepositoryExecutionRequest,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";
import {
  loadSavedRepositoryPlan,
  repositoryPlanDigest,
} from "./repository-plans.js";
import { runnerBearer } from "./runners.js";
import {
  authenticateWorkRunner,
  lockWorkRunner,
  lockWorkStarter,
  mayUseWorkRunner,
} from "./work-authorization.js";

type State = RepositoryExecution["state"];
type BlockReason = RepositoryExecution["blockReason"];
interface ExecutionRow {
  id: string;
  organization_id: string;
  team_id: string;
  started_by: string;
  runner_id: string;
  repository_plan_id: string;
  plan_digest: string;
  workspace_id: string;
  workspace_version_id: string;
  workspace_name: string;
  request: unknown;
  state: State;
  revision: number;
  block_reason: BlockReason;
  claimed_at: Date | null;
  run_deadline_at: Date | null;
  preparation_deadline_at: Date | null;
  created_at: Date;
  updated_at: Date;
  plan: RepositoryCommandPlan;
}
interface LeaseRow {
  id: string;
  runtime: "stub.v1" | "repository.v1";
  session_id: string | null;
  repository_execution_id: string | null;
  runner_id: string;
  team_id: string;
  organization_id: string;
  workspace_id: string;
  generation: number;
  token_hash: string;
  expires_at: Date;
  status: "active" | "uncertain" | "released";
  control_sequence: number;
}
interface EventRow {
  execution_id: string;
  sequence: number;
  id: string;
  kind: "created" | "claimed" | "cancel_requested" | "lease_uncertain";
  state: State;
  block_reason: BlockReason;
  created_at: Date;
}

const fromExecutions =
  "FROM repository_executions e JOIN repository_plans p ON p.id=e.repository_plan_id";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const conflict = (
  message = "The repository execution changed. Re-read its current state.",
) => new ApiFailure(409, "REPOSITORY_EXECUTION_CONFLICT", message);
const notFound = () =>
  new ApiFailure(
    404,
    "NOT_FOUND",
    "The requested repository execution was not found.",
  );
const leaseDenied = () =>
  new ApiFailure(
    401,
    "LEASE_UNAUTHENTICATED",
    "The work lease is unavailable or no longer valid.",
  );
const idConflict = () =>
  new ApiFailure(
    409,
    "ID_CONFLICT",
    "This repository execution identity already has different details.",
  );

async function clock(client: PoolClient): Promise<Date> {
  return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
    .rows[0]!.now;
}
function metadata(row: Omit<ExecutionRow, "plan" | "request">) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    startedBy: row.started_by,
    runnerId: row.runner_id,
    repositoryPlanId: row.repository_plan_id,
    planDigest: row.plan_digest,
    workspace: {
      resourceId: row.workspace_id,
      versionId: row.workspace_version_id,
    },
    workspaceName: row.workspace_name,
    runtime: "repository.v1" as const,
    policy: "docker-linux-offline.v1" as const,
    state: row.state,
    revision: row.revision,
    blockReason: row.block_reason,
    compatibility: row.claimed_at
      ? ("repository_protocol_declared" as const)
      : ("pending_runner_claim" as const),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    claimedAt: row.claimed_at?.toISOString() ?? null,
    runDeadlineAt: row.run_deadline_at?.toISOString() ?? null,
    preparationDeadlineAt: row.preparation_deadline_at?.toISOString() ?? null,
  };
}
function execution(row: ExecutionRow): RepositoryExecution {
  const value = RepositoryExecutionSchema.parse({
    ...metadata(row),
    plan: row.plan,
  });
  if (repositoryPlanDigest(value.plan) !== row.plan_digest)
    throw new Error("Repository execution plan integrity check failed.");
  return value;
}
function response(row: ExecutionRow): RepositoryExecutionResponse {
  return RepositoryExecutionResponseSchema.parse({
    repositoryExecution: execution(row),
  });
}
function replay(
  row: ExecutionRow,
  access: TeamAccess,
  input: StartRepositoryExecutionRequest,
): RepositoryExecutionResponse {
  if (
    row.organization_id !== access.organizationId ||
    row.team_id !== access.team.id ||
    row.started_by !== access.userId ||
    JSON.stringify(StartRepositoryExecutionRequestSchema.parse(row.request)) !==
      JSON.stringify(input)
  )
    throw idConflict();
  return response(row);
}
async function loadExecution(
  client: PoolClient,
  id: string,
  access?: TeamAccess,
  lock = false,
): Promise<ExecutionRow | undefined> {
  return (
    await client.query<ExecutionRow>(
      `SELECT e.*,p.plan ${fromExecutions} WHERE e.id=$1
      AND ($2::uuid IS NULL OR e.organization_id=$2) AND ($3::uuid IS NULL OR e.team_id=$3)
      ${lock ? "FOR UPDATE OF e" : ""}`,
      [id, access?.organizationId ?? null, access?.team.id ?? null],
    )
  ).rows[0];
}
async function loadLease(
  client: PoolClient,
  id: string,
  lock = false,
): Promise<LeaseRow | undefined> {
  return (
    await client.query<LeaseRow>(
      `SELECT * FROM session_leases WHERE id=$1 ${lock ? "FOR UPDATE" : ""}`,
      [id],
    )
  ).rows[0];
}
async function event(
  client: PoolClient,
  row: ExecutionRow,
  kind: EventRow["kind"],
): Promise<void> {
  await client.query(
    `INSERT INTO repository_execution_events(execution_id,sequence,id,kind,state,block_reason)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [row.id, row.revision, randomUUID(), kind, row.state, row.block_reason],
  );
}
async function audit(
  client: PoolClient,
  row: ExecutionRow,
  actor: string | null,
  action: string,
): Promise<void> {
  await client.query(
    "INSERT INTO audit_events(organization_id,actor_user_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",
    [
      row.organization_id,
      actor,
      action,
      row.id,
      JSON.stringify({
        teamId: row.team_id,
        runnerId: row.runner_id,
        repositoryPlanId: row.repository_plan_id,
      }),
    ],
  );
}
async function transition(
  client: PoolClient,
  row: ExecutionRow,
  state: State,
  reason: BlockReason,
): Promise<ExecutionRow> {
  if (row.revision >= 2_147_483_647)
    throw conflict("The lifecycle revision cannot advance.");
  const updated = (
    await client.query<ExecutionRow>(
      "UPDATE repository_executions SET state=$2,block_reason=$3,revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *",
      [row.id, state, reason],
    )
  ).rows[0]!;
  return { ...row, ...updated };
}
function deadlineReason(
  row: ExecutionRow,
  lease: LeaseRow,
  now: Date,
): BlockReason {
  if (!row.run_deadline_at || !row.preparation_deadline_at) throw leaseDenied();
  if (
    now.getTime() >=
    row.run_deadline_at.getTime() - row.plan.limits.cleanupSeconds * 1000
  )
    return "run_deadline";
  if (now >= row.preparation_deadline_at) return "preparation_deadline";
  return now >= lease.expires_at ? "lease_expired" : null;
}
async function assess(
  client: PoolClient,
  row: ExecutionRow,
  lease: LeaseRow,
  permitted: boolean,
): Promise<{ row: ExecutionRow; lease: LeaseRow }> {
  if (lease.status !== "active") return { row, lease };
  const reason =
    deadlineReason(row, lease, await clock(client)) ??
    (!permitted ? "permission_changed" : null);
  if (!reason) return { row, lease };
  lease = (
    await client.query<LeaseRow>(
      "UPDATE session_leases SET status='uncertain' WHERE id=$1 RETURNING *",
      [lease.id],
    )
  ).rows[0]!;
  row = await transition(
    client,
    row,
    row.state === "cancelling" ? "cancelling" : "blocked",
    reason,
  );
  await event(client, row, "lease_uncertain");
  return { row, lease };
}
async function job(
  client: PoolClient,
  row: ExecutionRow,
  lease: LeaseRow,
  permitted: boolean,
): Promise<RepositoryExecutionJob> {
  if (!row.run_deadline_at || !row.preparation_deadline_at) throw leaseDenied();
  const now = await clock(client);
  const workDeadline = new Date(
    Math.min(
      row.preparation_deadline_at.getTime(),
      row.run_deadline_at.getTime() - row.plan.limits.cleanupSeconds * 1000,
    ),
  );
  let reason: RepositoryExecutionJob["control"]["reason"] =
    row.state === "cancelled"
      ? "cancelled"
      : row.state === "cancelling"
        ? "cancelling"
        : (row.block_reason ??
          (lease.status !== "active"
            ? "uncertain"
            : !permitted
              ? "permission_changed"
              : deadlineReason(row, lease, now)));
  let authorizedForMs = Math.max(
    0,
    Math.min(
      45000,
      lease.expires_at.getTime() - now.getTime(),
      workDeadline.getTime() - now.getTime(),
    ) - 250,
  );
  if (!reason && (row.state !== "running" || authorizedForMs === 0))
    reason = "authorization_window";
  if (reason) authorizedForMs = 0;
  return RepositoryExecutionJobSchema.parse({
    execution: execution(row),
    lease: {
      id: lease.id,
      generation: lease.generation,
      status: lease.status,
      expiresAt: lease.expires_at.toISOString(),
      controlSequence: lease.control_sequence,
    },
    manifest: repositoryOwnershipManifest(row.id, lease.id, row.plan_digest),
    control: {
      decision: reason ? "stop" : "prepare",
      reason,
      serverNow: now.toISOString(),
      authorizedForMs,
      workDeadlineAt: workDeadline.toISOString(),
      runDeadlineAt: row.run_deadline_at.toISOString(),
    },
  });
}

export class RepositoryExecutionService {
  private readonly pool: Pool;
  private readonly identity: IdentityService;
  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  private async admission(
    client: PoolClient,
    access: TeamAccess,
    input: RepositoryExecutionPreviewRequest,
  ): Promise<SavedRepositoryPlan> {
    let saved: SavedRepositoryPlan;
    try {
      saved = await loadSavedRepositoryPlan(
        client,
        access,
        input.repositoryPlanId,
      );
    } catch (error) {
      if (!(error instanceof ApiFailure) || error.statusCode !== 404)
        throw error;
      throw new ApiFailure(
        400,
        "INVALID_DEPENDENCY",
        "Choose an available repository plan from this team.",
      );
    }
    if (saved.planDigest !== input.expectedPlanDigest)
      throw new ApiFailure(
        409,
        "PLAN_CONFLICT",
        "Use the selected saved plan's exact digest.",
      );
    const version = (
      await client.query<{ schema_version: number; definition: unknown }>(
        `SELECT v.schema_version,v.definition FROM resources r JOIN resource_versions v ON v.resource_id=r.id AND v.id=$2
       WHERE r.id=$1 AND r.organization_id=$3 AND r.team_id=$4 AND r.kind='workspace' AND r.archived_at IS NULL FOR SHARE OF r`,
        [
          saved.plan.workspace.resourceId,
          saved.plan.workspace.versionId,
          access.organizationId,
          access.team.id,
        ],
      )
    ).rows[0];
    const parsed =
      version?.schema_version === 1
        ? WorkspaceDefinitionSchema.safeParse(version.definition)
        : null;
    if (!parsed?.success)
      throw new ApiFailure(
        400,
        "INVALID_DEPENDENCY",
        "Choose an active supported Workspace plan.",
      );
    const compiled = compileRepositoryCommandPlan(
      { ...saved.plan.workspace, definition: parsed.data },
      {
        action: saved.plan.action.kind,
        commitOid: saved.plan.source.commitOid,
        imageDigest: saved.plan.image.pinned,
      },
    );
    if (
      serializeRepositoryCommandPlan(compiled) !==
      serializeRepositoryCommandPlan(saved.plan)
    )
      throw new Error(
        "Saved repository configuration does not match its immutable Workspace version.",
      );
    const runner = await lockWorkRunner(
      client,
      input.runnerId,
      access.organizationId,
      access.team.id,
    );
    if (!(await mayUseWorkRunner(client, runner, access.userId, true)))
      throw new ApiFailure(
        403,
        "COMPUTE_FORBIDDEN",
        "An enrolled, approved runner and your explicit use grant are required.",
      );
    await this.identity.recheckSessionExpiry(access, client);
    return saved;
  }

  async preview(
    token: string | undefined,
    teamId: string,
    input: RepositoryExecutionPreviewRequest,
  ): Promise<RepositoryExecutionPreviewResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      const saved = await this.admission(client, access, input);
      return RepositoryExecutionPreviewResponseSchema.parse({
        repositoryPlan: saved,
        runnerId: input.runnerId,
        compatibility: "pending_runner_claim",
      });
    });
  }
  async start(
    token: string | undefined,
    teamId: string,
    input: StartRepositoryExecutionRequest,
  ): Promise<{ created: boolean; response: RepositoryExecutionResponse }> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('ark:repository-execution'),hashtext($1::text))",
        [input.id],
      );
      await this.identity.recheckSessionExpiry(access, client);
      const existing = await loadExecution(client, input.id);
      if (existing) {
        await this.identity.recheckSessionExpiry(access, client);
        return { created: false, response: replay(existing, access, input) };
      }
      const saved = await this.admission(client, access, input);
      const inserted = (
        await client.query<ExecutionRow>(
          `INSERT INTO repository_executions(id,organization_id,team_id,started_by,runner_id,repository_plan_id,plan_digest,workspace_id,workspace_version_id,workspace_name,request,state)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'queued') ON CONFLICT(id) DO NOTHING RETURNING *`,
          [
            input.id,
            access.organizationId,
            teamId,
            access.userId,
            input.runnerId,
            saved.id,
            saved.planDigest,
            saved.plan.workspace.resourceId,
            saved.plan.workspace.versionId,
            saved.workspaceName,
            JSON.stringify(input),
          ],
        )
      ).rows[0];
      await this.identity.recheckSessionExpiry(access, client);
      if (!inserted) {
        const winner = await loadExecution(client, input.id);
        if (!winner) throw idConflict();
        await this.identity.recheckSessionExpiry(access, client);
        return { created: false, response: replay(winner, access, input) };
      }
      const row = { ...inserted, plan: saved.plan };
      await event(client, row, "created");
      await audit(client, row, access.userId, "repository_execution.created");
      await this.identity.recheckSessionExpiry(access, client);
      return { created: true, response: response(row) };
    });
  }
  async get(
    token: string | undefined,
    teamId: string,
    id: string,
  ): Promise<RepositoryExecutionResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const row = await loadExecution(client, id, access);
      if (!row) throw notFound();
      await this.identity.recheckSessionExpiry(access, client);
      return response(row);
    });
  }
  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<RepositoryExecutionListResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const rows = (
        await client.query<Omit<ExecutionRow, "plan" | "request">>(
          `SELECT id,organization_id,team_id,started_by,runner_id,repository_plan_id,plan_digest,workspace_id,workspace_version_id,
                workspace_name,state,revision,block_reason,claimed_at,run_deadline_at,preparation_deadline_at,created_at,updated_at
         FROM repository_executions WHERE organization_id=$1 AND team_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51`,
          [access.organizationId, teamId, cursor ?? null],
        )
      ).rows;
      const page = rows.slice(0, 50);
      await this.identity.recheckSessionExpiry(access, client);
      return RepositoryExecutionListResponseSchema.parse({
        repositoryExecutions: page.map(metadata),
        nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
      });
    });
  }
  async events(
    token: string | undefined,
    teamId: string,
    id: string,
    after = 0,
  ): Promise<RepositoryExecutionEventLogResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const row = await loadExecution(client, id, access);
      if (!row) throw notFound();
      if (after > row.revision)
        throw new ApiFailure(
          400,
          "INVALID_CURSOR",
          "The event cursor is ahead of this execution.",
        );
      const rows = (
        await client.query<EventRow>(
          "SELECT * FROM repository_execution_events WHERE execution_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101",
          [id, after],
        )
      ).rows;
      const page = rows.slice(0, 100);
      await this.identity.recheckSessionExpiry(access, client);
      return RepositoryExecutionEventLogResponseSchema.parse({
        events: page.map((e) => ({
          executionId: e.execution_id,
          id: e.id,
          sequence: e.sequence,
          kind: e.kind,
          state: e.state,
          blockReason: e.block_reason,
          createdAt: e.created_at.toISOString(),
        })),
        nextAfter: rows.length > 100 ? page.at(-1)!.sequence : null,
      });
    });
  }
  async cancel(
    token: string | undefined,
    teamId: string,
    id: string,
    expected: number,
  ): Promise<RepositoryExecutionResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      const candidate = await loadExecution(client, id, access);
      if (!candidate) throw notFound();
      if (
        access.team.role !== "admin" &&
        candidate.started_by !== access.userId
      )
        throw new ApiFailure(
          403,
          "FORBIDDEN",
          "Only a team admin or the eligible starter can cancel this execution.",
        );
      await lockWorkRunner(
        client,
        candidate.runner_id,
        access.organizationId,
        teamId,
      );
      let row = (await loadExecution(client, id, access, true))!;
      const lease = (
        await client.query<LeaseRow>(
          "SELECT * FROM session_leases WHERE repository_execution_id=$1 AND runtime='repository.v1' FOR UPDATE",
          [id],
        )
      ).rows[0];
      await this.identity.recheckSessionExpiry(access, client);
      if (row.revision !== expected) throw conflict();
      if (row.state === "cancelled" || row.state === "cancelling")
        return response(row);
      row = await transition(
        client,
        row,
        lease && lease.status !== "released" ? "cancelling" : "cancelled",
        row.block_reason,
      );
      await event(client, row, "cancel_requested");
      await audit(
        client,
        row,
        access.userId,
        "repository_execution.cancel_requested",
      );
      await this.identity.recheckSessionExpiry(access, client);
      return response(row);
    });
  }

  async claim(
    authorization: string | undefined,
    input: RepositoryExecutionClaimRequest,
  ): Promise<RepositoryExecutionClaimResponse> {
    const credential = runnerBearer(authorization, "runner");
    const tokenHash = hash(input.leaseToken);
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await withTransaction(this.pool, async (client) => {
        const discovered = await authenticateWorkRunner(client, credential);
        const firstLease = await loadLease(client, input.claimId);
        if (
          firstLease &&
          (firstLease.runtime !== "repository.v1" ||
            firstLease.runner_id !== discovered.id ||
            firstLease.token_hash !== tokenHash)
        )
          throw conflict("This claim identity already has different details.");
        const candidate = firstLease
          ? await loadExecution(client, firstLease.repository_execution_id!)
          : (
              await client.query<ExecutionRow>(
                `SELECT e.*,p.plan ${fromExecutions}
               JOIN users u ON u.id=e.started_by AND u.disabled_at IS NULL
               JOIN organization_memberships om ON om.user_id=u.id AND om.organization_id=e.organization_id AND om.revoked_at IS NULL
               JOIN team_memberships tm ON tm.user_id=u.id AND tm.team_id=e.team_id AND tm.organization_id=e.organization_id AND tm.revoked_at IS NULL AND tm.role IN ('admin','developer')
               JOIN runner_use_grants g ON g.runner_id=e.runner_id AND g.user_id=u.id AND g.granted
               WHERE e.runner_id=$1 AND e.state='queued' AND p.plan->>'runtime'='repository.v1' AND p.plan#>>'{sandbox,policy}'=$2
               ORDER BY e.created_at,e.id LIMIT 1`,
                [discovered.id, input.policy],
              )
            ).rows[0];
        const eligible = candidate
          ? await lockWorkStarter(client, candidate)
          : false;
        const runner = await authenticateWorkRunner(client, credential, true);
        let lease = await loadLease(client, input.claimId);
        if (
          lease &&
          (lease.runtime !== "repository.v1" ||
            lease.runner_id !== runner.id ||
            lease.token_hash !== tokenHash)
        )
          throw conflict("This claim identity already has different details.");
        if (lease && lease.repository_execution_id !== candidate?.id)
          return { retry: true } as const;
        const permitted = candidate
          ? await mayUseWorkRunner(
              client,
              runner,
              candidate.started_by,
              eligible,
            )
          : false;
        if (lease) {
          let row = (await loadExecution(
            client,
            lease.repository_execution_id!,
            undefined,
            true,
          ))!;
          lease = (await loadLease(client, lease.id, true))!;
          ({ row, lease } = await assess(client, row, lease, permitted));
          return { job: await job(client, row, lease, permitted) };
        }
        const held = await client.query(
          "SELECT 1 FROM session_leases WHERE runner_id=$1 AND status IN ('active','uncertain')",
          [runner.id],
        );
        if (held.rowCount || !candidate || !permitted) return { job: null };
        let row = (await loadExecution(client, candidate.id, undefined, true))!;
        if (row.state !== "queued") return { job: null };
        if (row.revision >= 2_147_483_647)
          throw conflict("The lifecycle revision cannot advance.");
        const now = await clock(client);
        const runDeadline = new Date(
          now.getTime() + row.plan.limits.runSeconds * 1000,
        );
        const preparationDeadline = new Date(
          Math.min(
            now.getTime() + row.plan.limits.preparationSeconds * 1000,
            runDeadline.getTime() - row.plan.limits.cleanupSeconds * 1000,
          ),
        );
        const updated = (
          await client.query<ExecutionRow>(
            "UPDATE repository_executions SET state='running',revision=revision+1,updated_at=clock_timestamp(),claimed_at=$2,run_deadline_at=$3,preparation_deadline_at=$4 WHERE id=$1 RETURNING *",
            [row.id, now, runDeadline, preparationDeadline],
          )
        ).rows[0]!;
        row = { ...row, ...updated };
        lease = (
          await client.query<LeaseRow>(
            `INSERT INTO session_leases(id,runtime,repository_execution_id,runner_id,team_id,organization_id,workspace_id,token_hash,expires_at,status)
           VALUES($1,'repository.v1',$2,$3,$4,$5,$6,$7,$8,'active') ON CONFLICT(id) DO NOTHING RETURNING *`,
            [
              input.claimId,
              row.id,
              runner.id,
              runner.team_id,
              runner.organization_id,
              row.workspace_id,
              tokenHash,
              new Date(
                Math.min(
                  now.getTime() + SESSION_LEASE_SECONDS * 1000,
                  preparationDeadline.getTime(),
                ),
              ),
            ],
          )
        ).rows[0];
        if (!lease)
          throw conflict("This claim identity already has different details.");
        if (lease.expires_at <= (await clock(client)))
          throw conflict(
            "The claim expired while waiting. Retry the same identity.",
          );
        await event(client, row, "claimed");
        await audit(client, row, null, "repository_execution.claimed");
        ({ row, lease } = await assess(client, row, lease, permitted));
        return { job: await job(client, row, lease, permitted) };
      });
      if (!("retry" in result))
        return RepositoryExecutionClaimResponseSchema.parse(result);
    }
    throw conflict("The claim changed concurrently. Retry the same identity.");
  }

  async control(
    authorization: string | undefined,
    input: RepositoryExecutionControlRequest,
  ): Promise<RepositoryExecutionJob> {
    const credential = runnerBearer(authorization, "runner");
    return withTransaction(this.pool, async (client) => {
      const discovered = await authenticateWorkRunner(client, credential);
      const firstLease = await loadLease(client, input.leaseId);
      if (
        !firstLease ||
        firstLease.runtime !== "repository.v1" ||
        firstLease.runner_id !== discovered.id ||
        firstLease.repository_execution_id !== input.executionId ||
        firstLease.token_hash !== hash(input.leaseToken)
      )
        throw leaseDenied();
      const candidate = await loadExecution(client, input.executionId);
      if (!candidate) throw leaseDenied();
      const eligible = await lockWorkStarter(client, candidate);
      const runner = await authenticateWorkRunner(client, credential, true);
      let row = (await loadExecution(
        client,
        input.executionId,
        undefined,
        true,
      ))!;
      let lease = (await loadLease(client, input.leaseId, true))!;
      if (
        lease.generation !== input.generation ||
        row.plan_digest !== input.planDigest
      )
        throw conflict("Use this lease's exact generation and plan binding.");
      const { leaseToken: _, ...safeInput } = input;
      const receipt = RepositoryExecutionControlReceiptSchema.parse(safeInput);
      const prior = (
        await client.query<{ request: unknown }>(
          "SELECT request FROM repository_control_receipts WHERE lease_id=$1 AND id=$2",
          [lease.id, input.controlId],
        )
      ).rows[0];
      if (
        prior &&
        JSON.stringify(
          RepositoryExecutionControlReceiptSchema.parse(prior.request),
        ) !== JSON.stringify(receipt)
      )
        throw conflict("This control identity already has different details.");
      const permitted = await mayUseWorkRunner(
        client,
        runner,
        row.started_by,
        eligible,
      );
      ({ row, lease } = await assess(client, row, lease, permitted));
      if (prior) return job(client, row, lease, permitted);
      if (
        lease.control_sequence !== input.expectedControlSequence ||
        lease.control_sequence >= 2_147_483_647
      )
        throw conflict("Use the current control sequence.");
      const now = await clock(client);
      const shouldRenew =
        permitted &&
        row.state === "running" &&
        lease.status === "active" &&
        !deadlineReason(row, lease, now);
      const expires = shouldRenew
        ? new Date(
            Math.min(
              now.getTime() + SESSION_LEASE_SECONDS * 1000,
              row.preparation_deadline_at!.getTime(),
              row.run_deadline_at!.getTime() -
                row.plan.limits.cleanupSeconds * 1000,
            ),
          )
        : lease.expires_at;
      lease = (
        await client.query<LeaseRow>(
          "UPDATE session_leases SET control_sequence=control_sequence+1,expires_at=$2 WHERE id=$1 RETURNING *",
          [lease.id, expires],
        )
      ).rows[0]!;
      await client.query(
        "INSERT INTO repository_control_receipts(lease_id,execution_id,id,sequence,request) VALUES($1,$2,$3,$4,$5::jsonb)",
        [
          lease.id,
          row.id,
          input.controlId,
          lease.control_sequence,
          JSON.stringify(receipt),
        ],
      );
      // Time can advance during receipt persistence; a reply is never an old
      // cached preparation ticket, and expiry remains a durable held reservation.
      ({ row, lease } = await assess(client, row, lease, permitted));
      return job(client, row, lease, permitted);
    });
  }

  async expireLeases(): Promise<number> {
    const candidates = (
      await this.pool.query<LeaseRow>(
        "SELECT * FROM session_leases WHERE runtime='repository.v1' AND status='active' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT 100",
      )
    ).rows;
    let changed = 0;
    for (const candidate of candidates) {
      const expired = await withTransaction(this.pool, async (client) => {
        await lockWorkRunner(client, candidate.runner_id);
        let row = (await loadExecution(
          client,
          candidate.repository_execution_id!,
          undefined,
          true,
        ))!;
        let lease = (await loadLease(client, candidate.id, true))!;
        const before = lease.status;
        // Expiry takes no identity locks after the runner lock. Permission is
        // checked by claim/control; this path assesses only fixed server time.
        ({ row, lease } = await assess(client, row, lease, true));
        if (before === lease.status) return false;
        await job(client, row, lease, false);
        return true;
      });
      if (expired) changed++;
    }
    return changed;
  }
}
