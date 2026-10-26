import { createHash } from "node:crypto";
import {
  RepositoryPlanListResponseSchema,
  RepositoryPlanPreviewResponseSchema,
  RepositoryPlanResponseSchema,
  SaveRepositoryPlanRequestSchema,
  WorkspaceDefinitionSchema,
  compileRepositoryCommandPlan,
  serializeRepositoryCommandPlan,
  type RepositoryCommandPlan,
  type RepositoryPlanListResponse,
  type RepositoryPlanPreviewRequest,
  type RepositoryPlanPreviewResponse,
  type RepositoryPlanResponse,
  type SaveRepositoryPlanRequest,
  type SavedRepositoryPlan,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ZodError } from "zod";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";

interface PlanRow {
  id: string;
  organization_id: string;
  team_id: string;
  created_by: string;
  workspace_resource_id: string;
  workspace_version_id: string;
  workspace_name: string;
  plan_digest: string;
  created_at: Date;
  request: unknown;
  plan: RepositoryCommandPlan;
}
interface SummaryRow extends Omit<PlanRow, "request" | "plan"> {
  action: RepositoryCommandPlan["action"]["kind"];
}

export function repositoryPlanDigest(plan: RepositoryCommandPlan): string {
  return createHash("sha256")
    .update(serializeRepositoryCommandPlan(plan), "utf8")
    .digest("hex");
}

function metadata(row: Omit<PlanRow, "request" | "plan">) {
  return {
    id: row.id,
    organizationId: row.organization_id,
    teamId: row.team_id,
    createdBy: row.created_by,
    createdAt: row.created_at.toISOString(),
    workspaceName: row.workspace_name,
    planDigest: row.plan_digest,
  };
}

function response(row: PlanRow): RepositoryPlanResponse {
  const value = RepositoryPlanResponseSchema.parse({
    repositoryPlan: { ...metadata(row), plan: row.plan },
  });
  const saved = value.repositoryPlan;
  if (
    saved.planDigest !== repositoryPlanDigest(saved.plan) ||
    saved.plan.workspace.resourceId !== row.workspace_resource_id ||
    saved.plan.workspace.versionId !== row.workspace_version_id
  )
    throw new Error("Saved repository plan integrity check failed.");
  return value;
}

function idConflict(): ApiFailure {
  return new ApiFailure(
    409,
    "ID_CONFLICT",
    "This repository plan identity already has different details.",
  );
}

function replay(
  row: PlanRow,
  access: TeamAccess,
  input: SaveRepositoryPlanRequest,
): RepositoryPlanResponse {
  if (
    row.organization_id !== access.organizationId ||
    row.team_id !== access.team.id ||
    row.created_by !== access.userId
  )
    throw idConflict();
  // Strict schema parsing normalizes UUID/OID spelling and reconstructs field
  // order, including JSONB objects whose stored key order differs from JSON.
  const savedRequest = SaveRepositoryPlanRequestSchema.parse(row.request);
  if (JSON.stringify(savedRequest) !== JSON.stringify(input))
    throw idConflict();
  return response(row);
}

async function savedById(
  client: PoolClient,
  id: string,
): Promise<PlanRow | undefined> {
  // Plans are append-only; SELECT needs no row UPDATE lock or UPDATE privilege.
  return (
    await client.query<PlanRow>("SELECT * FROM repository_plans WHERE id=$1", [
      id,
    ])
  ).rows[0];
}

/** Caller holds current team authorization in this same transaction. */
export async function loadSavedRepositoryPlan(
  client: PoolClient,
  access: TeamAccess,
  planId: string,
): Promise<SavedRepositoryPlan> {
  const row = (
    await client.query<PlanRow>(
      "SELECT * FROM repository_plans WHERE id=$1 AND organization_id=$2 AND team_id=$3",
      [planId, access.organizationId, access.team.id],
    )
  ).rows[0];
  if (!row)
    throw new ApiFailure(
      404,
      "NOT_FOUND",
      "The requested repository plan was not found.",
    );
  return response(row).repositoryPlan;
}

export class RepositoryPlanService {
  private readonly pool: Pool;
  private readonly identity: IdentityService;

  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  private async compile(
    client: PoolClient,
    access: TeamAccess,
    input: RepositoryPlanPreviewRequest,
  ): Promise<{ plan: RepositoryCommandPlan; workspaceName: string }> {
    // One explicit Workspace pin is resolved in this transaction. Its resource
    // SHARE lock serializes archive/ownership changes; versions are immutable.
    const version = (
      await client.query<{ schema_version: number; definition: unknown }>(
        `SELECT v.schema_version,v.definition FROM resources r
         JOIN resource_versions v ON v.resource_id=r.id AND v.id=$2
         WHERE r.id=$1 AND r.organization_id=$3 AND r.team_id=$4
           AND r.kind='workspace' AND r.archived_at IS NULL FOR SHARE OF r`,
        [
          input.workspace.resourceId,
          input.workspace.versionId,
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
        "Choose an active supported Workspace version from this team.",
      );
    try {
      const plan = compileRepositoryCommandPlan(
        { ...input.workspace, definition: parsed.data },
        input.selection,
      );
      return { plan, workspaceName: parsed.data.name };
    } catch (error) {
      if (!(error instanceof ZodError)) throw error;
      throw new ApiFailure(
        400,
        "INVALID_REPOSITORY_PLAN",
        "Choose a configured action and matching source/image pins for this Workspace.",
      );
    }
  }

  async preview(
    token: string | undefined,
    teamId: string,
    input: RepositoryPlanPreviewRequest,
  ): Promise<RepositoryPlanPreviewResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const { plan } = await this.compile(client, access, input);
      await this.identity.recheckSessionExpiry(access, client);
      return RepositoryPlanPreviewResponseSchema.parse({
        plan,
        planDigest: repositoryPlanDigest(plan),
      });
    });
  }

  async save(
    token: string | undefined,
    teamId: string,
    input: SaveRepositoryPlanRequest,
  ): Promise<{ created: boolean; response: RepositoryPlanResponse }> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      // Serialize identity before resolving today's catalog. Identical waiters
      // replay saved content even if that catalog is subsequently archived.
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtext('ark:repository-plan'),hashtext($1::text))",
        [input.id],
      );
      await this.identity.recheckSessionExpiry(access, client);
      const existing = await savedById(client, input.id);
      if (existing) {
        await this.identity.recheckSessionExpiry(access, client);
        return { created: false, response: replay(existing, access, input) };
      }
      const { plan, workspaceName } = await this.compile(client, access, input);
      const planDigest = repositoryPlanDigest(plan);
      await this.identity.recheckSessionExpiry(access, client);
      const inserted = (
        await client.query<PlanRow>(
          `INSERT INTO repository_plans
             (id,organization_id,team_id,created_by,workspace_resource_id,workspace_version_id,workspace_name,request,plan,plan_digest)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)
           ON CONFLICT(id) DO NOTHING RETURNING *`,
          [
            input.id,
            access.organizationId,
            access.team.id,
            access.userId,
            input.workspace.resourceId,
            input.workspace.versionId,
            workspaceName,
            JSON.stringify(input),
            serializeRepositoryCommandPlan(plan),
            planDigest,
          ],
        )
      ).rows[0];
      // Unique-index waits can outlive the browser session, even when the other
      // transaction rolls back and this transaction becomes the inserter.
      await this.identity.recheckSessionExpiry(access, client);
      if (!inserted) {
        const winner = await savedById(client, input.id);
        if (!winner) throw idConflict();
        await this.identity.recheckSessionExpiry(access, client);
        return { created: false, response: replay(winner, access, input) };
      }
      await client.query(
        `INSERT INTO audit_events(organization_id,actor_user_id,action,target_id,metadata)
         VALUES($1,$2,'repository_plan.create',$3,$4::jsonb)`,
        [
          access.organizationId,
          access.userId,
          inserted.id,
          JSON.stringify({
            teamId: access.team.id,
            workspaceResourceId: input.workspace.resourceId,
            workspaceVersionId: input.workspace.versionId,
          }),
        ],
      );
      await this.identity.recheckSessionExpiry(access, client);
      return { created: true, response: response(inserted) };
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    planId: string,
  ): Promise<RepositoryPlanResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const repositoryPlan = await loadSavedRepositoryPlan(
        client,
        access,
        planId,
      );
      await this.identity.recheckSessionExpiry(access, client);
      return { repositoryPlan };
    });
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<RepositoryPlanListResponse> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
        readOnly: true,
      });
      const rows = (
        await client.query<SummaryRow>(
          `SELECT id,organization_id,team_id,created_by,created_at,workspace_resource_id,
                  workspace_version_id,workspace_name,plan_digest,plan->'action'->>'kind' AS action
           FROM repository_plans WHERE organization_id=$1 AND team_id=$2
             AND ($3::uuid IS NULL OR id>$3::uuid) ORDER BY id LIMIT 51`,
          [access.organizationId, access.team.id, cursor ?? null],
        )
      ).rows;
      const page = rows.slice(0, 50);
      await this.identity.recheckSessionExpiry(access, client);
      return RepositoryPlanListResponseSchema.parse({
        repositoryPlans: page.map((row) => ({
          ...metadata(row),
          workspace: {
            resourceId: row.workspace_resource_id,
            versionId: row.workspace_version_id,
          },
          action: row.action,
          status: "planned_unverified",
        })),
        nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
      });
    });
  }
}
