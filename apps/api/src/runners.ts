import { createHash } from "node:crypto";
import {
  EnrollmentTokenSchema,
  RunnerCredentialSchema,
  RunnerListResponseSchema,
  RunnerResponseSchema,
  RUNNER_ENROLLMENT_TTL_SECONDS,
  RUNNER_OFFLINE_AFTER_SECONDS,
  type CreateRunnerEnrollmentRequest,
  type EnrollRunnerRequest,
  type RevokeRunnerRequest,
  type Runner,
  type RunnerListResponse,
  type RunnerResponse,
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
function bearer(header: string | undefined, realm: "enroll" | "runner") {
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
    dispatchApproved: false,
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
async function audit(
  client: PoolClient,
  row: RunnerRow,
  actorUserId: string | null,
  action: "runner.enrollment_issued" | "runner.enrolled" | "runner.revoked",
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
        "Only team admins can manage runner enrollment.",
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

  async enroll(
    authorization: string | undefined,
    input: EnrollRunnerRequest,
  ): Promise<RunnerResponse> {
    const code = bearer(authorization, "enroll");
    const credential = bearer(`Bearer ${input.runnerCredential}`, "runner");
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
    const credential = bearer(authorization, "runner");
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
          "UPDATE runners SET revoked_at=$2,lifecycle_revision=lifecycle_revision+1 WHERE id=$1 RETURNING *",
          [row.id, observedAt],
        )
      ).rows[0]!;
      await audit(client, row, access.userId, "runner.revoked");
      return response(row, observedAt);
    });
  }
}
