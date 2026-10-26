import type { PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { runnerBearer } from "./runners.js";

export interface WorkRunnerRow {
  id: string;
  team_id: string;
  organization_id: string;
  credential_hash: string | null;
  enrolled_at: Date | null;
  revoked_at: Date | null;
  dispatch_approved: boolean;
}

export async function lockWorkRunner(
  client: PoolClient,
  id: string,
  organizationId?: string,
  teamId?: string,
): Promise<WorkRunnerRow> {
  const row = (
    await client.query<WorkRunnerRow>(
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

export async function authenticateWorkRunner(
  client: PoolClient,
  credential: ReturnType<typeof runnerBearer>,
  lock = false,
): Promise<WorkRunnerRow> {
  const row = (
    await client.query<WorkRunnerRow>(
      `SELECT * FROM runners WHERE id=$1 AND credential_hash=$2 ${lock ? "FOR UPDATE" : ""}`,
      [credential.id, credential.hash],
    )
  ).rows[0];
  if (!row || !row.enrolled_at || row.revoked_at)
    throw new ApiFailure(
      401,
      "RUNNER_UNAUTHENTICATED",
      "The runner credential is unavailable or no longer valid.",
    );
  return row;
}

export async function lockWorkStarter(
  client: PoolClient,
  row: { started_by: string; organization_id: string; team_id: string },
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

export async function mayUseWorkRunner(
  client: PoolClient,
  runner: WorkRunnerRow,
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
