import { createHash } from "node:crypto";
import {
  EnrollmentTokenSchema,
  RunnerCredentialSchema,
  RunnerListResponseSchema,
  RunnerResponseSchema,
  RunnerGrantsResponseSchema,
  RunnerUseAccessResponseSchema,
  RUNNER_ENROLLMENT_TTL_SECONDS,
  RUNNER_OFFLINE_AFTER_SECONDS,
  type CreateRunnerEnrollmentRequest,
  type EnrollRunnerRequest,
  type RevokeRunnerRequest,
  type Runner,
  type RunnerListResponse,
  type RunnerResponse,
  type RunnerGrantsResponse,
  type RunnerUseAccessResponse,
  type SetRunnerDispatchApprovalRequest,
  type SetRunnerUseGrantRequest,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";

interface RunnerRow {
  id: string;
  organization_id: string;
  team_id: string;
  name: string;
  issued_by: string;
  enrollment_token_hash: string;
  enrollment_expires_at: Date;
  credential_hash: string | null;
  enrolled_at: Date | null;
  last_heartbeat_at: Date | null;
  revoked_at: Date | null;
  lifecycle_revision: number;
  created_at: Date;
  dispatch_approved: boolean;
}

function machineDenied(): ApiFailure {
  return new ApiFailure(
    401,
    "RUNNER_UNAUTHENTICATED",
    "The runner credential is unavailable or no longer valid.",
  );
}
function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function runnerBearer(header: string | undefined, realm: "enroll" | "runner") {
  const match = /^Bearer (\S+)$/i.exec(header ?? "");
  // JavaScript's $ also matches before a final newline. The whole header must
  // match so trailing characters cannot disappear before token validation.
  if (!match || match[0] !== header) throw machineDenied();
  const schema =
    realm === "enroll" ? EnrollmentTokenSchema : RunnerCredentialSchema;
  const parsed = schema.safeParse(match[1]);
  if (!parsed.success) throw machineDenied();
  return { id: parsed.data.split("_")[2]!, hash: digest(parsed.data) };
}
async function clock(client: Pool | PoolClient): Promise<Date> {
  return (
    await client.query<{ observed_at: Date }>(
      "SELECT clock_timestamp() AS observed_at",
    )
  ).rows[0]!.observed_at;
}
function metadata(row: RunnerRow, observedAt: Date): Runner {
  const health =
    row.revoked_at || !row.last_heartbeat_at
      ? "unknown"
      : observedAt.getTime() - row.last_heartbeat_at.getTime() <=
          RUNNER_OFFLINE_AFTER_SECONDS * 1000
        ? "online"
        : "offline";
  return {
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    name: row.name,
    lifecycleRevision: row.lifecycle_revision,
    createdAt: row.created_at.toISOString(),
    enrollmentExpiresAt: row.enrollment_expires_at.toISOString(),
    enrolledAt: row.enrolled_at?.toISOString() ?? null,
    lastHeartbeatAt: row.last_heartbeat_at?.toISOString() ?? null,
    revokedAt: row.revoked_at?.toISOString() ?? null,
    health,
    dispatchApproved: row.dispatch_approved,
  };
}
function response(row: RunnerRow, observedAt: Date): RunnerResponse {
  // Validate before commit: a failed response must roll back its mutation too.
  return RunnerResponseSchema.parse({
    runner: metadata(row, observedAt),
    observedAt: observedAt.toISOString(),
  });
}
function nextLifecycle(row: RunnerRow): void {
  if (row.lifecycle_revision >= 2_147_483_647)
    throw new ApiFailure(
      409,
      "LIFECYCLE_CONFLICT",
      "The runner lifecycle cannot advance.",
    );
}
function exactRevision(row: RunnerRow, expected: number): void {
  if (row.lifecycle_revision !== expected)
    throw new ApiFailure(
      409,
      "LIFECYCLE_CONFLICT",
      "The runner changed. Refresh before changing its permissions.",
    );
}
function requireEnrolled(row: RunnerRow): void {
  if (!row.enrolled_at || row.revoked_at)
    throw new ApiFailure(
      409,
      "RUNNER_UNAVAILABLE",
      "Only an enrolled, unrevoked runner can receive permissions.",
    );
}
async function scopedRunner(
  client: PoolClient,
  access: TeamAccess,
  runnerId: string,
  lock: "UPDATE" | "SHARE",
): Promise<RunnerRow> {
  const row = (
    await client.query<RunnerRow>(
      `SELECT * FROM runners WHERE id=$1 AND organization_id=$2 AND team_id=$3 FOR ${lock}`,
      [runnerId, access.organizationId, access.team.id],
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
async function audit(
  client: PoolClient,
  row: RunnerRow,
  actorUserId: string | null,
  action:
    | "runner.enrollment_issued"
    | "runner.enrolled"
    | "runner.revoked"
    | "runner.dispatch_approval_changed"
    | "runner.use_grant_changed",
  details:
    | { approved: boolean }
    | { userId: string; granted: boolean }
    | undefined = undefined,
): Promise<void> {
  await client.query(
    "INSERT INTO audit_events(organization_id,actor_user_id,action,target_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)",
    [
      row.organization_id,
      actorUserId,
      action,
      row.id,
      JSON.stringify({
        teamId: row.team_id,
        lifecycleRevision: row.lifecycle_revision,
        ...(actorUserId === null ? { actorKind: "runner" } : {}),
        ...details,
      }),
    ],
  );
}

export class RunnerService {
  private readonly pool: Pool;
  private readonly identity: IdentityService;

  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  private async admin(
    token: string | undefined,
    teamId: string,
    client: PoolClient,
  ): Promise<TeamAccess> {
    const access = await this.identity.authorizeTeam(token, teamId, { client });
    if (access.team.role !== "admin")
      throw new ApiFailure(
        403,
        "FORBIDDEN",
        "Only team admins can manage runners.",
      );
    return access;
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<RunnerListResponse> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const rows = (
      await this.pool.query<RunnerRow>(
        `SELECT * FROM runners WHERE organization_id=$1 AND team_id=$2
       AND ($3::uuid IS NULL OR id > $3::uuid) ORDER BY id LIMIT 51`,
        [access.organizationId, teamId, cursor ?? null],
      )
    ).rows;
    const observedAt = await clock(this.pool);
    const page = rows.slice(0, 50);
    return RunnerListResponseSchema.parse({
      runners: page.map((row) => metadata(row, observedAt)),
      nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
      observedAt: observedAt.toISOString(),
    });
  }

  async issue(
    token: string | undefined,
    teamId: string,
    input: CreateRunnerEnrollmentRequest,
  ): Promise<{ created: boolean; response: RunnerResponse }> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.admin(token, teamId, client);
      const hash = digest(input.enrollmentToken);
      const inserted = await client.query<RunnerRow>(
        `INSERT INTO runners(id,organization_id,team_id,name,issued_by,enrollment_token_hash,enrollment_expires_at)
         VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+($7 * interval '1 second'))
         ON CONFLICT(id) DO NOTHING RETURNING *`,
        [
          input.id,
          access.organizationId,
          teamId,
          input.name,
          access.userId,
          hash,
          RUNNER_ENROLLMENT_TTL_SECONDS,
        ],
      );
      let row = inserted.rows[0];
      const created = !!row;
      if (!row) {
        row = (
          await client.query<RunnerRow>(
            "SELECT * FROM runners WHERE id=$1 AND organization_id=$2 AND team_id=$3 FOR UPDATE",
            [input.id, access.organizationId, teamId],
          )
        ).rows[0];
        if (
          !row ||
          row.name !== input.name ||
          row.enrollment_token_hash !== hash
        )
          throw new ApiFailure(
            409,
            "ID_CONFLICT",
            "This enrollment identity already has different details.",
          );
      }
      await this.identity.recheckSessionExpiry(access, client);
      if (created)
        await audit(client, row, access.userId, "runner.enrollment_issued");
      return { created, response: response(row, await clock(client)) };
    });
  }

  async setDispatchApproval(
    token: string | undefined,
    teamId: string,
    runnerId: string,
    input: SetRunnerDispatchApprovalRequest,
  ): Promise<RunnerResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.admin(token, teamId, client);
      let row = await scopedRunner(client, access, runnerId, "UPDATE");
      await this.identity.recheckSessionExpiry(access, client);
      exactRevision(row, input.expectedLifecycleRevision);
      if (input.approved) requireEnrolled(row);
      if (row.dispatch_approved === input.approved)
        return response(row, await clock(client));
      nextLifecycle(row);
      row = (
        await client.query<RunnerRow>(
          `UPDATE runners SET dispatch_approved=$2,lifecycle_revision=lifecycle_revision+1
           WHERE id=$1 RETURNING *`,
          [row.id, input.approved],
        )
      ).rows[0]!;
      await this.identity.recheckSessionExpiry(access, client);
      await audit(
        client,
        row,
        access.userId,
        "runner.dispatch_approval_changed",
        {
          approved: input.approved,
        },
      );
      return response(row, await clock(client));
    });
  }

  async setUseGrant(
    token: string | undefined,
    teamId: string,
    runnerId: string,
    userId: string,
    input: SetRunnerUseGrantRequest,
  ): Promise<RunnerResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.admin(token, teamId, client);
      if (input.granted) {
        // Lock current recipient identity before the runner, in the same order as
        // actor authorization. A concurrent disable/demotion cannot slip through.
        const identity = await client.query(
          `SELECT u.id FROM users u
           JOIN organization_memberships om ON om.user_id=u.id
           WHERE u.id=$1 AND om.organization_id=$2
             AND u.disabled_at IS NULL AND om.revoked_at IS NULL
           FOR SHARE OF u,om`,
          [userId, access.organizationId],
        );
        const membership = await client.query(
          `SELECT tm.user_id FROM team_memberships tm
           WHERE tm.user_id=$1 AND tm.team_id=$2 AND tm.organization_id=$3
             AND tm.revoked_at IS NULL AND tm.role IN ('admin','developer')
           FOR SHARE OF tm`,
          [userId, teamId, access.organizationId],
        );
        if (!identity.rowCount || !membership.rowCount)
          throw new ApiFailure(
            403,
            "GRANT_RECIPIENT_INELIGIBLE",
            "This member is not currently eligible to use compute.",
          );
      }
      let row = await scopedRunner(client, access, runnerId, "UPDATE");
      await this.identity.recheckSessionExpiry(access, client);
      exactRevision(row, input.expectedLifecycleRevision);
      if (input.granted) requireEnrolled(row);
      const existing = (
        await client.query<{ granted: boolean }>(
          "SELECT granted FROM runner_use_grants WHERE runner_id=$1 AND user_id=$2",
          [row.id, userId],
        )
      ).rows[0];
      if ((existing?.granted ?? false) === input.granted)
        return response(row, await clock(client));
      nextLifecycle(row);
      await client.query(
        `INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT(runner_id,user_id) DO UPDATE SET granted=EXCLUDED.granted,updated_at=clock_timestamp()`,
        [row.id, teamId, access.organizationId, userId, input.granted],
      );
      row = (
        await client.query<RunnerRow>(
          "UPDATE runners SET lifecycle_revision=lifecycle_revision+1 WHERE id=$1 RETURNING *",
          [row.id],
        )
      ).rows[0]!;
      await this.identity.recheckSessionExpiry(access, client);
      await audit(client, row, access.userId, "runner.use_grant_changed", {
        userId,
        granted: input.granted,
      });
      return response(row, await clock(client));
    });
  }

  async grants(
    token: string | undefined,
    teamId: string,
    runnerId: string,
    cursor?: string,
  ): Promise<RunnerGrantsResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.admin(token, teamId, client);
      // Permission writes lock this row first, so roster grants and revision
      // describe the same state even when an admin changes access concurrently.
      const row = await scopedRunner(client, access, runnerId, "SHARE");
      const members = (
        await client.query<{
          userId: string;
          displayName: string;
          role: "admin" | "developer" | "reviewer" | "viewer";
          eligible: boolean;
          granted: boolean;
        }>(
          `SELECT u.id AS "userId",u.display_name AS "displayName",tm.role,
             (u.disabled_at IS NULL AND om.revoked_at IS NULL AND tm.revoked_at IS NULL
               AND tm.role IN ('admin','developer')) AS eligible,
             COALESCE(g.granted,false) AS granted
           FROM team_memberships tm
           JOIN users u ON u.id=tm.user_id
           JOIN organization_memberships om ON om.organization_id=tm.organization_id AND om.user_id=tm.user_id
           LEFT JOIN runner_use_grants g ON g.runner_id=$1 AND g.user_id=tm.user_id
           WHERE tm.team_id=$2 AND tm.organization_id=$3 AND ($4::uuid IS NULL OR u.id>$4::uuid)
             AND ((u.disabled_at IS NULL AND om.revoked_at IS NULL AND tm.revoked_at IS NULL
               AND tm.role IN ('admin','developer')) OR g.user_id IS NOT NULL)
           ORDER BY u.id LIMIT 51`,
          [row.id, teamId, access.organizationId, cursor ?? null],
        )
      ).rows;
      await this.identity.recheckSessionExpiry(access, client);
      const page = members.slice(0, 50);
      return RunnerGrantsResponseSchema.parse({
        ...response(row, await clock(client)),
        members: page,
        nextCursor: members.length > 50 ? page.at(-1)!.userId : null,
      });
    });
  }

  async useAccess(
    token: string | undefined,
    teamId: string,
    runnerId: string,
  ): Promise<RunnerUseAccessResponse> {
    const access = await this.identity.authorizeTeam(token, teamId);
    // This is an observation, never an execution ticket. Read all current
    // eligibility and permission inputs in one snapshot; do not reuse the role
    // returned by the earlier authorization query to decide use permission.
    const row = (
      await this.pool.query<
        RunnerRow & {
          has_use_grant: boolean;
          eligible: boolean;
          observed_at: Date;
        }
      >(
        `SELECT r.*,COALESCE(g.granted,false) AS has_use_grant,
           tm.role IN ('admin','developer') AS eligible,clock_timestamp() AS observed_at
         FROM runners r
         JOIN auth_sessions s ON s.id=$4 AND s.user_id=$5 AND s.organization_id=r.organization_id
         JOIN users u ON u.id=s.user_id
         JOIN organization_memberships om ON om.user_id=u.id AND om.organization_id=r.organization_id
         JOIN team_memberships tm ON tm.user_id=u.id AND tm.team_id=r.team_id AND tm.organization_id=r.organization_id
         LEFT JOIN runner_use_grants g ON g.runner_id=r.id AND g.user_id=u.id
         WHERE r.id=$1 AND r.team_id=$2 AND r.organization_id=$3
           AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()
           AND u.disabled_at IS NULL AND om.revoked_at IS NULL AND tm.revoked_at IS NULL`,
        [
          runnerId,
          teamId,
          access.organizationId,
          access.sessionId,
          access.userId,
        ],
      )
    ).rows[0];
    if (!row) {
      // Preserve the existing 401/404 identity boundary if eligibility vanished
      // during this read, without disclosing another team's runner.
      await this.identity.authorizeTeam(token, teamId);
      throw new ApiFailure(
        404,
        "NOT_FOUND",
        "The requested runner was not found.",
      );
    }
    return RunnerUseAccessResponseSchema.parse({
      ...response(row, row.observed_at),
      hasUseGrant: row.has_use_grant,
      useAllowed: !!(
        row.eligible &&
        row.has_use_grant &&
        row.enrolled_at &&
        row.dispatch_approved &&
        !row.revoked_at
      ),
    });
  }

  async enroll(
    authorization: string | undefined,
    input: EnrollRunnerRequest,
  ): Promise<RunnerResponse> {
    const code = runnerBearer(authorization, "enroll");
    const credential = runnerBearer(`Bearer ${input.runnerCredential}`, "runner");
    if (code.id !== credential.id) throw machineDenied();
    return withTransaction(this.pool, async (client) => {
      // Discover the issuer without a runner lock, then hold its current identity
      // and membership locks in the same order as human catalog mutations.
      const candidate = (
        await client.query<RunnerRow>(
          "SELECT * FROM runners WHERE id=$1 AND enrollment_token_hash=$2",
          [code.id, code.hash],
        )
      ).rows[0];
      if (!candidate) throw machineDenied();
      const issuer = await client.query(
        `SELECT u.id FROM users u JOIN organization_memberships om ON om.user_id=u.id
         WHERE u.id=$1 AND om.organization_id=$2 AND u.disabled_at IS NULL AND om.revoked_at IS NULL
         FOR SHARE OF u,om`,
        [candidate.issued_by, candidate.organization_id],
      );
      if (!issuer.rowCount) throw machineDenied();
      const membership = await client.query(
        `SELECT t.id FROM teams t JOIN team_memberships tm ON tm.team_id=t.id AND tm.organization_id=t.organization_id
         WHERE t.id=$1 AND t.organization_id=$2 AND tm.user_id=$3 AND tm.role='admin' AND tm.revoked_at IS NULL
         FOR SHARE OF t,tm`,
        [candidate.team_id, candidate.organization_id, candidate.issued_by],
      );
      if (!membership.rowCount) throw machineDenied();
      let row = (
        await client.query<RunnerRow>(
          "SELECT * FROM runners WHERE id=$1 AND enrollment_token_hash=$2 FOR UPDATE",
          [code.id, code.hash],
        )
      ).rows[0];
      // now() is transaction-start time. The code may expire while this request
      // waits for a lock, so authorization uses database wall-clock time here.
      const observedAt = await clock(client);
      if (
        !row ||
        row.issued_by !== candidate.issued_by ||
        row.team_id !== candidate.team_id ||
        row.organization_id !== candidate.organization_id ||
        row.revoked_at ||
        row.enrollment_expires_at <= observedAt
      )
        throw machineDenied();
      if (row.credential_hash !== null) {
        if (row.credential_hash !== credential.hash) throw machineDenied();
        return response(row, observedAt);
      }
      nextLifecycle(row);
      row = (
        await client.query<RunnerRow>(
          `UPDATE runners SET credential_hash=$2,enrolled_at=$3,lifecycle_revision=lifecycle_revision+1
         WHERE id=$1 RETURNING *`,
          [row.id, credential.hash, observedAt],
        )
      ).rows[0]!;
      await audit(client, row, null, "runner.enrolled");
      return response(row, observedAt);
    });
  }

  async heartbeat(authorization: string | undefined): Promise<RunnerResponse> {
    const credential = runnerBearer(authorization, "runner");
    return withTransaction(this.pool, async (client) => {
      let row = (
        await client.query<RunnerRow>(
          "SELECT * FROM runners WHERE id=$1 AND credential_hash=$2 FOR UPDATE",
          [credential.id, credential.hash],
        )
      ).rows[0];
      if (!row || row.revoked_at || !row.enrolled_at) throw machineDenied();
      const observedAt = await clock(client);
      row = (
        await client.query<RunnerRow>(
          "UPDATE runners SET last_heartbeat_at=$2 WHERE id=$1 RETURNING *",
          [row.id, observedAt],
        )
      ).rows[0]!;
      return response(row, observedAt);
    });
  }

  async revoke(
    token: string | undefined,
    teamId: string,
    runnerId: string,
    input: RevokeRunnerRequest,
  ): Promise<RunnerResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.admin(token, teamId, client);
      let row = (
        await client.query<RunnerRow>(
          "SELECT * FROM runners WHERE id=$1 AND organization_id=$2 AND team_id=$3 FOR UPDATE",
          [runnerId, access.organizationId, teamId],
        )
      ).rows[0];
      if (!row)
        throw new ApiFailure(
          404,
          "NOT_FOUND",
          "The requested runner was not found.",
        );
      await this.identity.recheckSessionExpiry(access, client);
      const observedAt = await clock(client);
      if (row.revoked_at) return response(row, observedAt);
      if (row.lifecycle_revision !== input.expectedLifecycleRevision)
        throw new ApiFailure(
          409,
          "LIFECYCLE_CONFLICT",
          "The runner changed. Refresh before revoking it.",
        );
      nextLifecycle(row);
      row = (
        await client.query<RunnerRow>(
          "UPDATE runners SET revoked_at=$2,dispatch_approved=false,lifecycle_revision=lifecycle_revision+1 WHERE id=$1 RETURNING *",
          [row.id, observedAt],
        )
      ).rows[0]!;
      await audit(client, row, access.userId, "runner.revoked");
      return response(row, observedAt);
    });
  }
}
