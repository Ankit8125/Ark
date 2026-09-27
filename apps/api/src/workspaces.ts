import { isDeepStrictEqual } from "node:util";
import { WorkspaceListResponseSchema, WorkspaceSchema } from "@ark/contracts";
import type {
  CreateWorkspaceRequest,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceListResponse,
  WorkspaceSummary,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";

interface WorkspaceSummaryRow {
  id: string;
  team_id: string;
  name: string;
  revision: number;
  version_id: string;
  schema_version: number;
  updated_at: Date;
}

interface WorkspaceRow extends WorkspaceSummaryRow {
  created_at: Date;
  definition: unknown;
}

const summaryColumns = `r.id, r.team_id, r.name, r.revision, r.updated_at,
  v.id AS version_id, v.schema_version`;
const currentVersion = `JOIN resource_versions v
  ON v.resource_id = r.id AND v.revision = r.revision`;
const pageSize = 50;

function summary(row: WorkspaceSummaryRow): WorkspaceSummary {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    revision: row.revision,
    versionId: row.version_id,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at.toISOString(),
  };
}

function workspace(row: WorkspaceRow): Workspace {
  return WorkspaceSchema.parse({
    ...summary(row),
    createdAt: row.created_at.toISOString(),
    definition: row.definition,
  });
}

function notFound(): ApiFailure {
  return new ApiFailure(
    404,
    "NOT_FOUND",
    "The requested workspace was not found.",
  );
}

function mapConstraintFailure(error: unknown): never {
  if (
    error instanceof Error &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "resources_unique_name"
  ) {
    throw new ApiFailure(
      409,
      "NAME_CONFLICT",
      "A workspace with this name already exists in this team.",
    );
  }
  throw error;
}

export class WorkspaceService {
  readonly pool: Pool;
  readonly identity: IdentityService;

  constructor(pool: Pool, identity: IdentityService) {
    this.pool = pool;
    this.identity = identity;
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<WorkspaceListResponse> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const result = await this.pool.query<WorkspaceSummaryRow>(
      `SELECT ${summaryColumns}
       FROM resources r ${currentVersion}
       WHERE r.team_id = $1 AND r.organization_id = $2 AND r.kind = 'workspace'
         AND ($3::uuid IS NULL OR r.id > $3::uuid)
       ORDER BY r.id LIMIT $4`,
      [teamId, access.organizationId, cursor ?? null, pageSize + 1],
    );
    const visible = result.rows.slice(0, pageSize);
    return WorkspaceListResponseSchema.parse({
      workspaces: visible.map(summary),
      nextCursor: result.rows.length > pageSize ? visible.at(-1)!.id : null,
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    workspaceId: string,
  ): Promise<Workspace> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const row = await this.find(this.pool, access, workspaceId);
    if (!row) throw notFound();
    return workspace(row);
  }

  private async find(
    client: Pool | PoolClient,
    access: TeamAccess,
    workspaceId: string,
    lock = false,
  ): Promise<WorkspaceRow | undefined> {
    if (lock) {
      // Lock before joining the version in a new statement. A concurrent save
      // may commit while we wait; the next READ COMMITTED snapshot must see its
      // new version instead of joining against the earlier statement snapshot.
      const locked = await client.query(
        `SELECT id FROM resources
         WHERE id = $1 AND team_id = $2 AND organization_id = $3
           AND kind = 'workspace' FOR UPDATE`,
        [workspaceId, access.team.id, access.organizationId],
      );
      if (!locked.rowCount) return undefined;
    }
    const result = await client.query<WorkspaceRow>(
      `SELECT ${summaryColumns}, r.created_at, v.definition
       FROM resources r ${currentVersion}
       WHERE r.id = $1 AND r.team_id = $2 AND r.organization_id = $3
         AND r.kind = 'workspace'`,
      [workspaceId, access.team.id, access.organizationId],
    );
    return result.rows[0];
  }

  private async recordVersion(
    client: PoolClient,
    access: TeamAccess,
    workspaceId: string,
    revision: number,
    input: CreateWorkspaceRequest | UpdateWorkspaceRequest,
    action: "workspace.created" | "workspace.updated",
  ): Promise<void> {
    await client.query(
      `INSERT INTO resource_versions
         (resource_id, revision, schema_version, definition, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        workspaceId,
        revision,
        input.schemaVersion,
        JSON.stringify(input.definition),
        access.userId,
      ],
    );
    // Catalog contents may eventually describe private repositories or actions.
    // Audit only the resource identity and revision, never the definition.
    await client.query(
      `INSERT INTO audit_events
         (organization_id, actor_user_id, action, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        access.organizationId,
        access.userId,
        action,
        workspaceId,
        JSON.stringify({ revision }),
      ],
    );
  }

  async create(
    token: string | undefined,
    teamId: string,
    input: CreateWorkspaceRequest,
  ): Promise<{ workspace: Workspace; created: boolean }> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const access = await this.identity.authorizeTeam(token, teamId, {
          client,
        });
        const inserted = await client.query(
          `INSERT INTO resources (id, organization_id, team_id, kind, name, revision)
           VALUES ($1, $2, $3, 'workspace', $4, 1)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [input.id, access.organizationId, teamId, input.definition.name],
        );
        if (!inserted.rowCount) {
          const existing = await this.find(client, access, input.id, true);
          if (
            !existing ||
            existing.revision !== 1 ||
            existing.schema_version !== input.schemaVersion ||
            !isDeepStrictEqual(existing.definition, input.definition)
          ) {
            // A reused ID receives one generic response, including IDs owned
            // by another team. No foreign record is returned or identified.
            throw new ApiFailure(
              409,
              "ID_CONFLICT",
              "This workspace request cannot be reused. Reload and try again.",
            );
          }
          return { workspace: workspace(existing), created: false };
        }
        await this.recordVersion(
          client,
          access,
          input.id,
          1,
          input,
          "workspace.created",
        );
        const row = await this.find(client, access, input.id);
        if (!row) throw new Error("Workspace was not created.");
        return { workspace: workspace(row), created: true };
      });
    } catch (error) {
      return mapConstraintFailure(error);
    }
  }

  async update(
    token: string | undefined,
    teamId: string,
    workspaceId: string,
    input: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const access = await this.identity.authorizeTeam(token, teamId, {
          client,
        });
        const existing = await this.find(client, access, workspaceId, true);
        if (!existing) throw notFound();
        if (existing.schema_version !== 1) {
          throw new ApiFailure(
            409,
            "UNSUPPORTED_SCHEMA_VERSION",
            "This workspace uses an unsupported schema version and is read-only.",
          );
        }
        if (existing.revision !== input.revision) {
          throw new ApiFailure(
            409,
            "REVISION_CONFLICT",
            "This workspace has changed. Reload it before saving again.",
          );
        }
        const revision = existing.revision + 1;
        await client.query(
          `UPDATE resources SET name = $1, revision = $2, updated_at = now()
           WHERE id = $3`,
          [input.definition.name, revision, workspaceId],
        );
        await this.recordVersion(
          client,
          access,
          workspaceId,
          revision,
          input,
          "workspace.updated",
        );
        const row = await this.find(client, access, workspaceId);
        if (!row) throw new Error("Workspace was not updated.");
        return workspace(row);
      });
    } catch (error) {
      return mapConstraintFailure(error);
    }
  }
}
