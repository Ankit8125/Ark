import { createHash, randomUUID } from "node:crypto";
import {
  ExecutionSessionSchema,
  FlowDefinitionSchema,
  SessionClaimResponseSchema,
  SessionEventLogResponseSchema,
  SessionEventSchema,
  SessionJobSchema,
  SessionListResponseSchema,
  SessionPreviewResponseSchema,
  SessionResponseSchema,
  SessionSnapshotSchema,
  SESSION_LEASE_SECONDS,
  stubFinalOutputs,
  stubStageOutputs,
  validateSessionInputs,
  type ExecutionSession,
  type SessionAdvanceRequest,
  type SessionClaimRequest,
  type SessionClaimResponse,
  type SessionEvent,
  type SessionEventLogResponse,
  type SessionJob,
  type SessionListResponse,
  type SessionPreviewRequest,
  type SessionPreviewResponse,
  type SessionResponse,
  type SessionSnapshot,
  type SessionState,
  type StartSessionRequest,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import { validateFlowDependencies } from "./flow-dependencies.js";
import type { IdentityService, TeamAccess } from "./identity.js";
import { runnerBearer } from "./runners.js";

interface SessionRow {
  id: string;
  organization_id: string;
  team_id: string;
  started_by: string;
  runner_id: string;
  flow_resource_id: string;
  flow_version_id: string;
  workspace_id: string;
  flow_name: string;
  request: StartSessionRequest;
  snapshot: SessionSnapshot;
  input_values: ExecutionSession["inputValues"];
  state: SessionState;
  revision: number;
  stage_index: number;
  stage_results: ExecutionSession["stageResults"];
  outputs: ExecutionSession["outputs"];
  block_reason: ExecutionSession["blockReason"];
  created_at: Date;
  updated_at: Date;
}
interface LeaseRow {
  id: string;
  session_id: string;
  runner_id: string;
  team_id: string;
  organization_id: string;
  workspace_id: string;
  generation: number;
  token_hash: string;
  expires_at: Date;
  status: "active" | "uncertain" | "released";
}
interface RunnerRow {
  id: string;
  team_id: string;
  organization_id: string;
  credential_hash: string | null;
  enrolled_at: Date | null;
  revoked_at: Date | null;
  dispatch_approved: boolean;
}
interface EventRow {
  session_id: string;
  sequence: number;
  id: string;
  lease_id: string | null;
  kind: SessionEvent["kind"];
  state: SessionState;
  stage_index: number;
  receipt: unknown;
  created_at: Date;
}
const terminal = (state: SessionState) =>
  ["cancelled", "failed", "completed"].includes(state);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
function notFound(): ApiFailure {
  return new ApiFailure(
    404,
    "NOT_FOUND",
    "The requested session was not found.",
  );
}
function conflict(
  message = "The session changed. Refresh before continuing.",
): ApiFailure {
  return new ApiFailure(409, "SESSION_CONFLICT", message);
}
function machineDenied(): ApiFailure {
  return new ApiFailure(
    401,
    "RUNNER_UNAUTHENTICATED",
    "The runner credential is unavailable or no longer valid.",
  );
}
function leaseDenied(): ApiFailure {
  return new ApiFailure(
    401,
    "LEASE_UNAUTHENTICATED",
    "The work lease is unavailable or no longer valid.",
  );
}
function nextRevision(row: SessionRow): void {
  if (row.revision >= 2_147_483_647)
    throw conflict("The session revision cannot advance.");
}
function exactRevision(row: SessionRow, expected: number): void {
  if (row.revision !== expected) throw conflict();
}
async function clock(client: PoolClient): Promise<Date> {
  return (await client.query<{ now: Date }>("SELECT clock_timestamp() AS now"))
    .rows[0]!.now;
}
function session(row: SessionRow): ExecutionSession {
  return ExecutionSessionSchema.parse({
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    startedBy: row.started_by,
    runnerId: row.runner_id,
    flowResourceId: row.flow_resource_id,
    flowVersionId: row.flow_version_id,
    flowName: row.flow_name,
    state: row.state,
    revision: row.revision,
    stageIndex: row.stage_index,
    blockReason: row.block_reason,
    runtime: "stub.v1",
    quality: "not_evaluated",
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    snapshot: row.snapshot,
    inputValues: row.input_values,
    stageResults: row.stage_results,
    outputs: row.outputs,
  });
}
function response(row: SessionRow): SessionResponse {
  return SessionResponseSchema.parse({ session: session(row) });
}
function job(row: SessionRow, lease: LeaseRow): SessionJob {
  return SessionJobSchema.parse({
    session: session(row),
    lease: {
      id: lease.id,
      generation: lease.generation,
      status: lease.status,
      expiresAt: lease.expires_at.toISOString(),
    },
  });
}
function event(row: EventRow): SessionEvent {
  return SessionEventSchema.parse({
    sessionId: row.session_id,
    sequence: row.sequence,
    id: row.id,
    kind: row.kind,
    state: row.state,
    stageIndex: row.stage_index,
    createdAt: row.created_at.toISOString(),
  });
}
async function appendEvent(
  client: PoolClient,
  row: SessionRow,
  kind: SessionEvent["kind"],
  id: string = randomUUID(),
  leaseId: string | null = null,
  receipt: unknown = null,
): Promise<void> {
  await client.query(
    `INSERT INTO execution_events(session_id,sequence,id,lease_id,kind,state,stage_index,receipt)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,
    [
      row.id,
      row.revision,
      id,
      leaseId,
      kind,
      row.state,
      row.stage_index,
      receipt === null ? null : JSON.stringify(receipt),
    ],
  );
}
async function audit(
  client: PoolClient,
  row: SessionRow,
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
        revision: row.revision,
        ...(actor === null ? { actorKind: "runner" } : {}),
      }),
    ],
  );
}
async function lockSession(
  client: PoolClient,
  id: string,
  teamId?: string,
  organizationId?: string,
  lock = "UPDATE",
): Promise<SessionRow> {
  const row = (
    await client.query<SessionRow>(
      `SELECT * FROM execution_sessions WHERE id=$1
    AND ($2::uuid IS NULL OR team_id=$2) AND ($3::uuid IS NULL OR organization_id=$3) FOR ${lock}`,
      [id, teamId ?? null, organizationId ?? null],
    )
  ).rows[0];
  if (!row) throw notFound();
  return row;
}
async function lockRunner(
  client: PoolClient,
  id: string,
  organizationId?: string,
  teamId?: string,
): Promise<RunnerRow> {
  const row = (
    await client.query<RunnerRow>(
      `SELECT * FROM runners WHERE id=$1
    AND ($2::uuid IS NULL OR organization_id=$2) AND ($3::uuid IS NULL OR team_id=$3) FOR UPDATE`,
      [id, organizationId ?? null, teamId ?? null],
    )
  ).rows[0];
  if (!row)
    throw new ApiFailure(
      404,
      "NOT_FOUND",
      "The requested runner was not found.",
    );
  return row;
}
async function lockLease(client: PoolClient, id: string): Promise<LeaseRow> {
  const row = (
    await client.query<LeaseRow>(
      "SELECT * FROM session_leases WHERE id=$1 FOR UPDATE",
      [id],
    )
  ).rows[0];
  if (!row) throw leaseDenied();
  return row;
}
async function lockStarter(
  client: PoolClient,
  row: Pick<SessionRow, "started_by" | "organization_id" | "team_id">,
): Promise<boolean> {
  // Existing inactive rows are locked too. Eligibility is decided after waits,
  // and no identity lock is acquired after the runner lock.
  const identity = (
    await client.query<{ disabled_at: Date | null; revoked_at: Date | null }>(
      `SELECT u.disabled_at,om.revoked_at FROM users u JOIN organization_memberships om ON om.user_id=u.id
     WHERE u.id=$1 AND om.organization_id=$2 FOR SHARE OF u,om`,
      [row.started_by, row.organization_id],
    )
  ).rows[0];
  const membership = (
    await client.query<{ role: string; revoked_at: Date | null }>(
      "SELECT role,revoked_at FROM team_memberships WHERE user_id=$1 AND team_id=$2 AND organization_id=$3 FOR SHARE",
      [row.started_by, row.team_id, row.organization_id],
    )
  ).rows[0];
  return (
    !!identity &&
    !identity.disabled_at &&
    !identity.revoked_at &&
    !!membership &&
    !membership.revoked_at &&
    ["admin", "developer"].includes(membership.role)
  );
}
async function mayUse(
  client: PoolClient,
  runner: RunnerRow,
  userId: string,
  eligible: boolean,
): Promise<boolean> {
  if (
    !eligible ||
    !runner.enrolled_at ||
    runner.revoked_at ||
    !runner.dispatch_approved
  )
    return false;
  return !!(
    await client.query(
      "SELECT 1 FROM runner_use_grants WHERE runner_id=$1 AND user_id=$2 AND granted",
      [runner.id, userId],
    )
  ).rowCount;
}
async function transition(
  client: PoolClient,
  row: SessionRow,
  state: SessionState,
  reason: SessionRow["block_reason"],
): Promise<SessionRow> {
  nextRevision(row);
  return (
    await client.query<SessionRow>(
      `UPDATE execution_sessions SET state=$2,block_reason=$3,
    revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
      [row.id, state, reason],
    )
  ).rows[0]!;
}
async function uncertain(
  client: PoolClient,
  row: SessionRow,
  lease: LeaseRow,
  reason: "lease_expired" | "permission_changed",
): Promise<{ row: SessionRow; lease: LeaseRow }> {
  if (lease.status !== "active" || terminal(row.state)) return { row, lease };
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
  await appendEvent(client, row, "lease_uncertain", randomUUID(), lease.id);
  return { row, lease };
}

export class SessionService {
  private readonly pool: Pool;
  private readonly identity: IdentityService;
  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  private async snapshot(
    client: PoolClient,
    access: TeamAccess,
    input: SessionPreviewRequest,
  ): Promise<SessionSnapshot> {
    const resource = (
      await client.query(
        "SELECT id FROM resources WHERE id=$1 AND team_id=$2 AND organization_id=$3 AND kind='flow' AND archived_at IS NULL FOR SHARE",
        [input.flow.resourceId, access.team.id, access.organizationId],
      )
    ).rows[0];
    if (!resource)
      throw new ApiFailure(
        400,
        "INVALID_DEPENDENCY",
        "Choose an available Flow version from this team.",
      );
    const version = (
      await client.query<{ schema_version: number; definition: unknown }>(
        "SELECT schema_version,definition FROM resource_versions WHERE id=$1 AND resource_id=$2",
        [input.flow.versionId, input.flow.resourceId],
      )
    ).rows[0];
    const parsed =
      version?.schema_version === 1
        ? FlowDefinitionSchema.safeParse(version.definition)
        : null;
    if (!parsed?.success)
      throw new ApiFailure(
        400,
        "INVALID_DEPENDENCY",
        "Choose a supported Flow version from this team.",
      );
    await validateFlowDependencies(client, access, parsed.data);
    const ids = [
      ...new Set([
        parsed.data.workspace.versionId,
        ...parsed.data.stages.map((stage) => stage.agent.versionId),
      ]),
    ];
    const dependencies = (
      await client.query<{
        id: string;
        resource_id: string;
        definition: unknown;
      }>(
        "SELECT id,resource_id,definition FROM resource_versions WHERE id=ANY($1::uuid[])",
        [ids],
      )
    ).rows;
    const find = (reference: { resourceId: string; versionId: string }) => {
      const value = dependencies.find(
        (item) =>
          item.id === reference.versionId.toLowerCase() &&
          item.resource_id === reference.resourceId.toLowerCase(),
      );
      if (!value)
        throw new ApiFailure(
          400,
          "INVALID_DEPENDENCY",
          "A pinned dependency is unavailable.",
        );
      return { ...reference, definition: value.definition };
    };
    const agents = [
      ...new Map(
        parsed.data.stages.map((stage) => [
          `${stage.agent.resourceId}:${stage.agent.versionId}`,
          find(stage.agent),
        ]),
      ).values(),
    ];
    const result = SessionSnapshotSchema.parse({
      flow: { ...input.flow, definition: parsed.data },
      workspace: find(parsed.data.workspace),
      agents,
    });
    try {
      validateSessionInputs(result, input.inputValues);
    } catch {
      throw new ApiFailure(
        400,
        "INVALID_INPUT_VALUES",
        "Supply exactly the declared Flow input names and types.",
      );
    }
    return result;
  }

  async preview(
    token: string | undefined,
    teamId: string,
    input: SessionPreviewRequest,
  ): Promise<SessionPreviewResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      const snapshot = await this.snapshot(client, access, input);
      const runner = await lockRunner(
        client,
        input.runnerId,
        access.organizationId,
        teamId,
      );
      if (!(await mayUse(client, runner, access.userId, true)))
        throw new ApiFailure(
          403,
          "COMPUTE_FORBIDDEN",
          "An enrolled, approved runner and your explicit use grant are required.",
        );
      await this.identity.recheckSessionExpiry(access, client);
      return SessionPreviewResponseSchema.parse({
        snapshot,
        runnerId: runner.id,
        inputValues: input.inputValues,
      });
    });
  }

  private replay(
    row: SessionRow,
    access: TeamAccess,
    input: StartSessionRequest,
  ): SessionResponse {
    if (
      row.team_id !== access.team.id ||
      row.organization_id !== access.organizationId ||
      row.started_by !== access.userId ||
      canonical(row.request) !== canonical(input)
    )
      throw new ApiFailure(
        409,
        "ID_CONFLICT",
        "This session identity already has different details.",
      );
    return response(row);
  }

  async start(
    token: string | undefined,
    teamId: string,
    input: StartSessionRequest,
  ): Promise<{ created: boolean; response: SessionResponse }> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      let existing = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE id=$1",
          [input.id],
        )
      ).rows[0];
      if (existing) {
        // Replay uses saved pins, not today's catalog revisions or archive state.
        this.replay(existing, access, input);
        await lockRunner(
          client,
          existing.runner_id,
          access.organizationId,
          teamId,
        );
        existing = await lockSession(
          client,
          existing.id,
          teamId,
          access.organizationId,
        );
        await this.identity.recheckSessionExpiry(access, client);
        return {
          created: false,
          response: this.replay(existing, access, input),
        };
      }
      const snapshot = await this.snapshot(client, access, input);
      const runner = await lockRunner(
        client,
        input.runnerId,
        access.organizationId,
        teamId,
      );
      // Another same-runner start may have committed while the runner lock waited.
      existing = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE id=$1",
          [input.id],
        )
      ).rows[0];
      if (existing) {
        await this.identity.recheckSessionExpiry(access, client);
        return {
          created: false,
          response: this.replay(existing, access, input),
        };
      }
      if (!(await mayUse(client, runner, access.userId, true)))
        throw new ApiFailure(
          403,
          "COMPUTE_FORBIDDEN",
          "An enrolled, approved runner and your explicit use grant are required.",
        );
      await this.identity.recheckSessionExpiry(access, client);
      const inserted = (
        await client.query<SessionRow>(
          `INSERT INTO execution_sessions(id,organization_id,team_id,started_by,runner_id,flow_resource_id,flow_version_id,workspace_id,flow_name,request,snapshot,input_values,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,'queued') ON CONFLICT(id) DO NOTHING RETURNING *`,
          [
            input.id,
            access.organizationId,
            teamId,
            access.userId,
            runner.id,
            input.flow.resourceId,
            input.flow.versionId,
            snapshot.workspace.resourceId,
            snapshot.flow.definition.name,
            JSON.stringify(input),
            JSON.stringify(snapshot),
            JSON.stringify(input.inputValues),
          ],
        )
      ).rows[0];
      if (!inserted)
        throw new ApiFailure(
          409,
          "ID_CONFLICT",
          "This session identity already has different details.",
        );
      await this.identity.recheckSessionExpiry(access, client);
      await appendEvent(client, inserted, "created");
      await audit(client, inserted, access.userId, "session.started");
      return { created: true, response: response(inserted) };
    });
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<SessionListResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const rows = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE organization_id=$1 AND team_id=$2 AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51",
          [access.organizationId, teamId, cursor ?? null],
        )
      ).rows;
      const page = rows.slice(0, 50);
      await this.identity.recheckSessionExpiry(access, client);
      return SessionListResponseSchema.parse({
        sessions: page.map((row) => {
          const {
            snapshot: _,
            inputValues: __,
            stageResults: ___,
            outputs: ____,
            ...summary
          } = session(row);
          return summary;
        }),
        nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
      });
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    id: string,
  ): Promise<SessionResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const row = await lockSession(
        client,
        id,
        teamId,
        access.organizationId,
        "SHARE",
      );
      await this.identity.recheckSessionExpiry(access, client);
      return response(row);
    });
  }

  async eventBatch(
    token: string | undefined,
    teamId: string,
    id: string,
    after = 0,
  ): Promise<{ log: SessionEventLogResponse; terminal: boolean }> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const row = await lockSession(
        client,
        id,
        teamId,
        access.organizationId,
        "SHARE",
      );
      if (after > row.revision)
        throw new ApiFailure(
          400,
          "INVALID_CURSOR",
          "The event cursor is ahead of this session.",
        );
      const rows = (
        await client.query<EventRow>(
          "SELECT * FROM execution_events WHERE session_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 101",
          [id, after],
        )
      ).rows;
      await this.identity.recheckSessionExpiry(access, client);
      const page = rows.slice(0, 100);
      return {
        log: SessionEventLogResponseSchema.parse({
          events: page.map(event),
          nextAfter: rows.length > 100 ? page.at(-1)!.sequence : null,
        }),
        terminal: terminal(row.state),
      };
    });
  }

  async events(
    token: string | undefined,
    teamId: string,
    id: string,
    after = 0,
  ): Promise<SessionEventLogResponse> {
    return (await this.eventBatch(token, teamId, id, after)).log;
  }

  async cancel(
    token: string | undefined,
    teamId: string,
    id: string,
    expected: number,
  ): Promise<SessionResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      const candidate = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE id=$1 AND team_id=$2 AND organization_id=$3",
          [id, teamId, access.organizationId],
        )
      ).rows[0];
      if (!candidate) throw notFound();
      if (
        access.team.role !== "admin" &&
        candidate.started_by !== access.userId
      )
        throw new ApiFailure(
          403,
          "FORBIDDEN",
          "Only a team admin or this session's eligible starter can cancel it.",
        );
      await lockRunner(
        client,
        candidate.runner_id,
        access.organizationId,
        teamId,
      );
      let row = await lockSession(client, id, teamId, access.organizationId);
      const lease = (
        await client.query<LeaseRow>(
          "SELECT * FROM session_leases WHERE session_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      await this.identity.recheckSessionExpiry(access, client);
      exactRevision(row, expected);
      if (terminal(row.state) || row.state === "cancelling")
        return response(row);
      const held = lease && lease.status !== "released";
      row = await transition(
        client,
        row,
        held ? "cancelling" : "cancelled",
        row.block_reason,
      );
      await appendEvent(
        client,
        row,
        held ? "cancelling" : "cancelled",
        randomUUID(),
        lease?.id ?? null,
      );
      await audit(client, row, access.userId, "session.cancel_requested");
      return response(row);
    });
  }

  async reconcile(
    token: string | undefined,
    teamId: string,
    id: string,
    expected: number,
  ): Promise<SessionResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      if (access.team.role !== "admin")
        throw new ApiFailure(
          403,
          "FORBIDDEN",
          "Only team admins can reconcile uncertain work.",
        );
      const candidate = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE id=$1 AND team_id=$2 AND organization_id=$3",
          [id, teamId, access.organizationId],
        )
      ).rows[0];
      if (!candidate) throw notFound();
      const runner = await lockRunner(
        client,
        candidate.runner_id,
        access.organizationId,
        teamId,
      );
      let row = await lockSession(client, id, teamId, access.organizationId);
      const lease = (
        await client.query<LeaseRow>(
          "SELECT * FROM session_leases WHERE session_id=$1 FOR UPDATE",
          [id],
        )
      ).rows[0];
      await this.identity.recheckSessionExpiry(access, client);
      exactRevision(row, expected);
      if (!runner.revoked_at || !["blocked", "cancelling"].includes(row.state))
        throw conflict(
          "Revoke the runner and confirm stopped work before reconciling a blocked or cancelling session.",
        );
      if (lease && lease.status !== "released")
        await client.query(
          "UPDATE session_leases SET status='released' WHERE id=$1",
          [lease.id],
        );
      const state = row.state === "cancelling" ? "cancelled" : "failed";
      row = await transition(
        client,
        row,
        state,
        row.block_reason ?? "recovery_required",
      );
      await appendEvent(client, row, state, randomUUID(), lease?.id ?? null);
      await audit(client, row, access.userId, "session.manually_reconciled");
      return response(row);
    });
  }

  private async authenticatedRunner(
    client: PoolClient,
    credential: ReturnType<typeof runnerBearer>,
    lock = false,
  ): Promise<RunnerRow> {
    const row = (
      await client.query<RunnerRow>(
        `SELECT * FROM runners WHERE id=$1 AND credential_hash=$2 ${lock ? "FOR UPDATE" : ""}`,
        [credential.id, credential.hash],
      )
    ).rows[0];
    if (!row || !row.enrolled_at || row.revoked_at) throw machineDenied();
    return row;
  }

  async claim(
    authorization: string | undefined,
    input: SessionClaimRequest,
  ): Promise<SessionClaimResponse> {
    const credential = runnerBearer(authorization, "runner");
    const tokenHash = hash(input.leaseToken);
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await withTransaction(this.pool, async (client) => {
        const discovered = await this.authenticatedRunner(client, credential);
        let lease = (
          await client.query<LeaseRow>(
            "SELECT * FROM session_leases WHERE id=$1",
            [input.claimId],
          )
        ).rows[0];
        if (
          lease &&
          (lease.runner_id !== discovered.id || lease.token_hash !== tokenHash)
        )
          throw conflict("This claim identity already has different details.");
        const candidate = (
          await client.query<SessionRow>(
            lease
              ? "SELECT * FROM execution_sessions WHERE id=$1"
              : `SELECT s.* FROM execution_sessions s
                 JOIN users u ON u.id=s.started_by AND u.disabled_at IS NULL
                 JOIN organization_memberships om ON om.user_id=u.id AND om.organization_id=s.organization_id AND om.revoked_at IS NULL
                 JOIN team_memberships tm ON tm.user_id=u.id AND tm.team_id=s.team_id AND tm.organization_id=s.organization_id
                   AND tm.revoked_at IS NULL AND tm.role IN ('admin','developer')
                 JOIN runner_use_grants g ON g.runner_id=s.runner_id AND g.user_id=u.id AND g.granted
                 WHERE s.runner_id=$1 AND s.state='queued' ORDER BY s.created_at,s.id LIMIT 1`,
            [lease ? lease.session_id : discovered.id],
          )
        ).rows[0];
        const eligible = candidate
          ? await lockStarter(client, candidate)
          : false;
        const runner = await this.authenticatedRunner(client, credential, true);
        const repeated = (
          await client.query<LeaseRow>(
            "SELECT * FROM session_leases WHERE id=$1",
            [input.claimId],
          )
        ).rows[0];
        if (
          repeated &&
          (repeated.runner_id !== runner.id ||
            repeated.token_hash !== tokenHash)
        )
          throw conflict("This claim identity already has different details.");
        if (repeated && repeated.session_id !== candidate?.id)
          return { retry: true } as const;
        lease = repeated;
        if (lease) {
          let row = await lockSession(
            client,
            lease.session_id,
            runner.team_id,
            runner.organization_id,
          );
          lease = await lockLease(client, lease.id);
          if (lease.status === "active" && !terminal(row.state)) {
            const expired = lease.expires_at <= (await clock(client));
            if (
              expired ||
              !(await mayUse(client, runner, row.started_by, eligible))
            )
              ({ row, lease } = await uncertain(
                client,
                row,
                lease,
                expired ? "lease_expired" : "permission_changed",
              ));
          }
          return { job: job(row, lease) };
        }
        const held = await client.query(
          "SELECT 1 FROM session_leases WHERE runner_id=$1 AND status IN ('active','uncertain')",
          [runner.id],
        );
        if (
          held.rowCount ||
          !candidate ||
          !(await mayUse(client, runner, candidate.started_by, eligible))
        )
          return { job: null };
        let row = await lockSession(
          client,
          candidate.id,
          runner.team_id,
          runner.organization_id,
        );
        if (row.state !== "queued") return { job: null };
        row = await transition(client, row, "running", null);
        lease = (
          await client.query<LeaseRow>(
            `INSERT INTO session_leases(id,session_id,runner_id,team_id,organization_id,workspace_id,token_hash,expires_at,status)
          VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+($8*interval '1 second'),'active') RETURNING *`,
            [
              input.claimId,
              row.id,
              runner.id,
              runner.team_id,
              runner.organization_id,
              row.workspace_id,
              tokenHash,
              SESSION_LEASE_SECONDS,
            ],
          )
        ).rows[0]!;
        await appendEvent(client, row, "claimed", randomUUID(), lease.id, {
          claimId: input.claimId,
          runtime: input.runtime,
        });
        await audit(client, row, null, "session.claimed");
        return { job: job(row, lease) };
      });
      if (!("retry" in result)) return SessionClaimResponseSchema.parse(result);
    }
    throw conflict(
      "The claim changed concurrently. Retry the same claim identity.",
    );
  }

  async advance(
    authorization: string | undefined,
    input: SessionAdvanceRequest,
  ): Promise<SessionJob> {
    const credential = runnerBearer(authorization, "runner");
    return withTransaction(this.pool, async (client) => {
      const discovered = await this.authenticatedRunner(client, credential);
      const candidateLease = (
        await client.query<LeaseRow>(
          "SELECT * FROM session_leases WHERE id=$1 AND runner_id=$2",
          [input.leaseId, discovered.id],
        )
      ).rows[0];
      if (
        !candidateLease ||
        candidateLease.token_hash !== hash(input.leaseToken)
      )
        throw leaseDenied();
      const candidate = (
        await client.query<SessionRow>(
          "SELECT * FROM execution_sessions WHERE id=$1",
          [candidateLease.session_id],
        )
      ).rows[0];
      if (!candidate) throw leaseDenied();
      const eligible =
        input.kind === "stopped" ? false : await lockStarter(client, candidate);
      const runner = await this.authenticatedRunner(client, credential, true);
      let row = await lockSession(
        client,
        candidate.id,
        runner.team_id,
        runner.organization_id,
      );
      let lease = await lockLease(client, input.leaseId);
      if (
        lease.token_hash !== hash(input.leaseToken) ||
        lease.runner_id !== runner.id
      )
        throw leaseDenied();
      if (lease.generation !== input.generation)
        throw conflict("The lease generation does not match.");
      const { leaseToken: _, ...receipt } = input;
      const previous = (
        await client.query<EventRow>(
          "SELECT * FROM execution_events WHERE session_id=$1 AND id=$2",
          [row.id, input.eventId],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.lease_id !== lease.id ||
          canonical(previous.receipt) !== canonical(receipt)
        )
          throw conflict("This event identity already has different details.");
        // A receipt proves the earlier mutation, not current execution authority.
        // Discover expiry or permission loss before telling a retrying worker it
        // may continue; the original receipt itself remains unchanged.
        if (lease.status === "active" && !terminal(row.state)) {
          const expired = lease.expires_at <= (await clock(client));
          if (
            expired ||
            !(await mayUse(client, runner, row.started_by, eligible))
          )
            ({ row, lease } = await uncertain(
              client,
              row,
              lease,
              expired ? "lease_expired" : "permission_changed",
            ));
        }
        return job(row, lease);
      }
      exactRevision(row, input.expectedRevision);
      if (terminal(row.state) || lease.status === "released")
        throw conflict("This session is terminal and cannot reopen.");
      if (input.kind === "stopped") {
        lease = (
          await client.query<LeaseRow>(
            "UPDATE session_leases SET status='released' WHERE id=$1 RETURNING *",
            [lease.id],
          )
        ).rows[0]!;
        const state = row.state === "cancelling" ? "cancelled" : "failed";
        row = await transition(
          client,
          row,
          state,
          row.block_reason ?? "runner_stopped",
        );
        await appendEvent(client, row, state, input.eventId, lease.id, receipt);
        await audit(client, row, null, "session.stopped");
        return job(row, lease);
      }
      const expired = lease.expires_at <= (await clock(client));
      const permitted = await mayUse(client, runner, row.started_by, eligible);
      if (lease.status === "active" && (expired || !permitted))
        ({ row, lease } = await uncertain(
          client,
          row,
          lease,
          expired ? "lease_expired" : "permission_changed",
        ));
      if (lease.status !== "active" || row.state !== "running" || !permitted) {
        // Late output is retained as untrusted recovery evidence, never success.
        row = await transition(client, row, row.state, row.block_reason);
        await appendEvent(
          client,
          row,
          "recovery_recorded",
          input.eventId,
          lease.id,
          receipt,
        );
        return job(row, lease);
      }
      if (input.kind === "stage_completed") {
        const current = session(row);
        const stage =
          current.snapshot.flow.definition.stages[current.stageIndex];
        let expected: unknown;
        try {
          expected = stubStageOutputs(current);
        } catch {
          throw conflict("This session has no pending valid stage.");
        }
        if (
          stage?.id !== input.stageId ||
          canonical(expected) !== canonical(input.outputs)
        )
          throw new ApiFailure(
            400,
            "INVALID_STUB_OUTPUT",
            "Supply the deterministic output for the current stage.",
          );
        nextRevision(row);
        row = (
          await client.query<SessionRow>(
            `UPDATE execution_sessions SET stage_results=stage_results||$2::jsonb,stage_index=stage_index+1,
          revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
            [row.id, JSON.stringify({ [stage.id]: input.outputs })],
          )
        ).rows[0]!;
        if (lease.expires_at <= (await clock(client)))
          throw conflict(
            "The lease expired while progress was being recorded. Reconcile the same claim.",
          );
        lease = (
          await client.query<LeaseRow>(
            "UPDATE session_leases SET expires_at=clock_timestamp()+($2*interval '1 second') WHERE id=$1 RETURNING *",
            [lease.id, SESSION_LEASE_SECONDS],
          )
        ).rows[0]!;
        await appendEvent(
          client,
          row,
          "stage_completed",
          input.eventId,
          lease.id,
          receipt,
        );
      } else {
        const current = session(row);
        if (
          current.stageIndex !== current.snapshot.flow.definition.stages.length
        )
          throw conflict("Complete every stage before final completion.");
        const outputs = stubFinalOutputs(current);
        nextRevision(row);
        row = (
          await client.query<SessionRow>(
            `UPDATE execution_sessions SET state='completed',outputs=$2::jsonb,block_reason=NULL,
          revision=revision+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING *`,
            [row.id, JSON.stringify(outputs)],
          )
        ).rows[0]!;
        if (lease.expires_at <= (await clock(client)))
          throw conflict(
            "The lease expired while completion was being recorded. Reconcile the same claim.",
          );
        lease = (
          await client.query<LeaseRow>(
            "UPDATE session_leases SET status='released' WHERE id=$1 RETURNING *",
            [lease.id],
          )
        ).rows[0]!;
        await appendEvent(
          client,
          row,
          "completed",
          input.eventId,
          lease.id,
          receipt,
        );
        await audit(client, row, null, "session.completed");
      }
      if (lease.expires_at <= (await clock(client)))
        throw conflict(
          "The lease expired before progress could commit. Reconcile the same claim.",
        );
      return job(row, lease);
    });
  }

  async expireLeases(): Promise<number> {
    const candidates = (
      await this.pool.query<LeaseRow>(
        "SELECT * FROM session_leases WHERE status='active' AND expires_at<=clock_timestamp() ORDER BY expires_at,id LIMIT 100",
      )
    ).rows;
    let changed = 0;
    for (const candidate of candidates) {
      const expired = await withTransaction(this.pool, async (client) => {
        await lockRunner(client, candidate.runner_id);
        let row = await lockSession(client, candidate.session_id);
        let lease = await lockLease(client, candidate.id);
        if (
          lease.status !== "active" ||
          lease.expires_at > (await clock(client)) ||
          terminal(row.state)
        )
          return false;
        ({ row, lease } = await uncertain(client, row, lease, "lease_expired"));
        // Validate the recorded state before committing the expiry mutation.
        job(row, lease);
        return true;
      });
      if (expired) changed++;
    }
    return changed;
  }
}
