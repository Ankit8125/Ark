import { isDeepStrictEqual } from "node:util";
import {
  ResourceVersionSchema,
  ResourceVersionListResponseSchema,
} from "@ark/contracts";
import type {
  ResourceVersion,
  ResourceVersionListResponse,
  RestoreResourceRequest,
  ResourceLifecycleRequest,
  CatalogStatus,
} from "@ark/contracts";
import { withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { IdentityService, TeamAccess } from "./identity.js";
import { validateNoActiveFlowReferences } from "./flow-dependencies.js";

type CatalogKind = "workspace" | "agent" | "flow";
interface NamedDefinition {
  name: string;
}
interface VersionInput<Definition extends NamedDefinition> {
  schemaVersion: 1;
  definition: Definition;
}
type CreateInput<Definition extends NamedDefinition> =
  VersionInput<Definition> & {
    id: string;
  };
type UpdateInput<Definition extends NamedDefinition> =
  VersionInput<Definition> & {
    revision: number;
    lifecycleRevision: number;
  };

interface CatalogSummaryRow {
  id: string;
  team_id: string;
  name: string;
  revision: number;
  version_id: string;
  schema_version: number;
  updated_at: Date;
  archived_at: Date | null;
  lifecycle_revision: number;
}
interface CatalogRow extends CatalogSummaryRow {
  created_at: Date;
  definition: unknown;
}
interface CatalogSummary {
  id: string;
  teamId: string;
  name: string;
  revision: number;
  versionId: string;
  schemaVersion: number;
  updatedAt: string;
  archivedAt: string | null;
  lifecycleRevision: number;
}
interface CatalogRecord extends CatalogSummary {
  createdAt: string;
  definition: unknown;
}
interface VersionRow {
  resource_id: string;
  team_id: string;
  version_id: string;
  revision: number;
  schema_version: number;
  created_at: Date;
  definition: unknown;
}
type DefinitionValidator<Definition> = (
  client: PoolClient,
  access: TeamAccess,
  definition: Definition,
) => Promise<void>;

const summaryColumns = `r.id, r.team_id, r.name, r.revision, r.updated_at,
  r.archived_at, r.lifecycle_revision,
  v.id AS version_id, v.schema_version`;
const currentVersion = `JOIN resource_versions v
  ON v.resource_id = r.id AND v.revision = r.revision`;
const pageSize = 50;

function summary(row: CatalogSummaryRow): CatalogSummary {
  return {
    id: row.id,
    teamId: row.team_id,
    name: row.name,
    revision: row.revision,
    versionId: row.version_id,
    schemaVersion: row.schema_version,
    updatedAt: row.updated_at.toISOString(),
    archivedAt: row.archived_at?.toISOString() ?? null,
    lifecycleRevision: row.lifecycle_revision,
  };
}

// Catalog kinds share exactly these persistence and authorization
// invariants. Their schemas, response envelopes, and routes remain concrete.
export class VersionedCatalogService<Definition extends NamedDefinition> {
  private readonly pool: Pool;
  private readonly identity: IdentityService;
  private readonly kind: CatalogKind;
  private readonly parseRecord: (value: unknown) => CatalogRecord;
  private readonly parseDefinition: (value: unknown) => Definition;
  private readonly validateDefinition:
    DefinitionValidator<Definition> | undefined;

  constructor(
    pool: Pool,
    identity: IdentityService,
    kind: CatalogKind,
    parseRecord: (value: unknown) => CatalogRecord,
    parseDefinition: (value: unknown) => Definition,
    validateDefinition?: DefinitionValidator<Definition>,
  ) {
    this.pool = pool;
    this.identity = identity;
    this.kind = kind;
    this.parseRecord = parseRecord;
    this.parseDefinition = parseDefinition;
    this.validateDefinition = validateDefinition;
  }

  private record(row: CatalogRow): CatalogRecord {
    // Writes validate the concrete response before their transaction commits.
    // A mapper/schema failure must not leave an apparently failed save behind.
    return this.parseRecord({
      ...summary(row),
      createdAt: row.created_at.toISOString(),
      definition: row.definition,
    });
  }

  private notFound(): ApiFailure {
    return new ApiFailure(
      404,
      "NOT_FOUND",
      `The requested ${this.kind} was not found.`,
    );
  }

  private assertActive(row: CatalogRow): void {
    if (row.archived_at !== null)
      throw new ApiFailure(
        409,
        "RESOURCE_ARCHIVED",
        `This ${this.kind} is archived. Load the latest record and unarchive it before editing or restoring.`,
      );
  }

  private assertExpected(
    row: CatalogRow,
    input: { revision: number; lifecycleRevision: number },
  ): void {
    if (
      row.revision !== input.revision ||
      row.lifecycle_revision !== input.lifecycleRevision
    )
      throw new ApiFailure(
        409,
        "REVISION_CONFLICT",
        `This ${this.kind} has changed. Load the latest record before trying again.`,
      );
  }

  private supportedDefinition(row: CatalogRow): Definition {
    if (row.schema_version !== 1)
      throw new ApiFailure(
        409,
        "UNSUPPORTED_SCHEMA_VERSION",
        `This ${this.kind} uses an unsupported schema version and is read-only.`,
      );
    try {
      return this.parseDefinition(row.definition);
    } catch {
      throw new ApiFailure(
        409,
        "INVALID_STORED_DEFINITION",
        `The current ${this.kind} definition is invalid and is read-only.`,
      );
    }
  }

  private mapConstraintFailure(error: unknown): never {
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
        `${this.kind === "agent" ? "An" : "A"} ${this.kind} with this name already exists in this team.`,
      );
    }
    throw error;
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
    status: CatalogStatus = "active",
  ): Promise<{ resources: CatalogSummary[]; nextCursor: string | null }> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const result = await this.pool.query<CatalogSummaryRow>(
      `SELECT ${summaryColumns}
       FROM resources r ${currentVersion}
       WHERE r.team_id = $1 AND r.organization_id = $2 AND r.kind = $3
         AND ($4::uuid IS NULL OR r.id > $4::uuid)
         AND (r.archived_at IS NOT NULL) = $6
       ORDER BY r.id LIMIT $5`,
      [
        teamId,
        access.organizationId,
        this.kind,
        cursor ?? null,
        pageSize + 1,
        status === "archived",
      ],
    );
    const visible = result.rows.slice(0, pageSize);
    return {
      resources: visible.map(summary),
      nextCursor: result.rows.length > pageSize ? visible.at(-1)!.id : null,
    };
  }

  async get(
    token: string | undefined,
    teamId: string,
    resourceId: string,
  ): Promise<CatalogRecord> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const row = await this.find(this.pool, access, resourceId);
    if (!row) throw this.notFound();
    return this.record(row);
  }

  async getVersion(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    versionId: string,
  ): Promise<ResourceVersion> {
    const access = await this.identity.authorizeTeam(token, teamId);
    const result = await this.pool.query<VersionRow>(
      `SELECT r.id AS resource_id, r.team_id, v.id AS version_id,
              v.revision, v.schema_version, v.created_at, v.definition
       FROM resources r JOIN resource_versions v ON v.resource_id = r.id
       WHERE r.id = $1 AND r.team_id = $2 AND r.organization_id = $3
         AND r.kind = $4 AND v.id = $5`,
      [resourceId, teamId, access.organizationId, this.kind, versionId],
    );
    const row = result.rows[0];
    if (!row) throw this.notFound();
    // Snapshot metadata must not inherit a later resource name or update time.
    // Unknown definitions remain intact for read-only clients.
    return ResourceVersionSchema.parse({
      resourceId: row.resource_id,
      teamId: row.team_id,
      versionId: row.version_id,
      revision: row.revision,
      schemaVersion: row.schema_version,
      createdAt: row.created_at.toISOString(),
      definition: row.definition,
    });
  }

  async listVersions(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    cursor?: number,
  ): Promise<ResourceVersionListResponse> {
    const access = await this.identity.authorizeTeam(token, teamId);
    // Check the resource even when this cursor would produce an empty page.
    const existing = await this.find(this.pool, access, resourceId);
    if (!existing) throw this.notFound();
    const result = await this.pool.query<Omit<VersionRow, "definition">>(
      `SELECT r.id AS resource_id, r.team_id, v.id AS version_id,
              v.revision, v.schema_version, v.created_at
       FROM resources r JOIN resource_versions v ON v.resource_id = r.id
       WHERE r.id = $1 AND r.team_id = $2 AND r.organization_id = $3
         AND r.kind = $4 AND ($5::integer IS NULL OR v.revision < $5)
       ORDER BY v.revision DESC LIMIT $6`,
      [
        resourceId,
        teamId,
        access.organizationId,
        this.kind,
        cursor ?? null,
        pageSize + 1,
      ],
    );
    const visible = result.rows.slice(0, pageSize);
    return ResourceVersionListResponseSchema.parse({
      versions: visible.map((row) => ({
        resourceId: row.resource_id,
        teamId: row.team_id,
        versionId: row.version_id,
        revision: row.revision,
        schemaVersion: row.schema_version,
        createdAt: row.created_at.toISOString(),
      })),
      nextCursor:
        result.rows.length > pageSize ? visible.at(-1)!.revision : null,
    });
  }

  private async find(
    client: Pool | PoolClient,
    access: TeamAccess,
    resourceId: string,
    lock = false,
  ): Promise<CatalogRow | undefined> {
    if (lock) {
      // Lock before joining the version in a new statement. A concurrent save
      // may commit while we wait; the next READ COMMITTED snapshot must see its
      // new version instead of joining against the earlier statement snapshot.
      const locked = await client.query(
        `SELECT id FROM resources
         WHERE id = $1 AND team_id = $2 AND organization_id = $3
           AND kind = $4 FOR UPDATE`,
        [resourceId, access.team.id, access.organizationId, this.kind],
      );
      if (!locked.rowCount) return undefined;
    }
    const result = await client.query<CatalogRow>(
      `SELECT ${summaryColumns}, r.created_at, v.definition
       FROM resources r ${currentVersion}
       WHERE r.id = $1 AND r.team_id = $2 AND r.organization_id = $3
         AND r.kind = $4`,
      [resourceId, access.team.id, access.organizationId, this.kind],
    );
    return result.rows[0];
  }

  private async recordVersion(
    client: PoolClient,
    access: TeamAccess,
    resourceId: string,
    revision: number,
    input: VersionInput<Definition>,
    action: "created" | "updated" | "restored",
    source?: { sourceVersionId: string; sourceRevision: number },
  ): Promise<void> {
    await client.query(
      `INSERT INTO resource_versions
         (resource_id, revision, schema_version, definition, created_by_user_id)
       VALUES ($1, $2, $3, $4::jsonb, $5)`,
      [
        resourceId,
        revision,
        input.schemaVersion,
        JSON.stringify(input.definition),
        access.userId,
      ],
    );
    // Definitions can contain private instructions, repositories, or commands.
    // Audit only the resource identity and revision, never the definition.
    await client.query(
      `INSERT INTO audit_events
         (organization_id, actor_user_id, action, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5::jsonb)`,
      [
        access.organizationId,
        access.userId,
        `${this.kind}.${action}`,
        resourceId,
        JSON.stringify({ revision, ...source }),
      ],
    );
  }

  async create(
    token: string | undefined,
    teamId: string,
    input: CreateInput<Definition>,
  ): Promise<{ resource: CatalogRecord; created: boolean }> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const access = await this.identity.authorizeTeam(token, teamId, {
          client,
        });
        const inserted = await client.query(
          `INSERT INTO resources (id, organization_id, team_id, kind, name, revision)
           VALUES ($1, $2, $3, $4, $5, 1)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
          [
            input.id,
            access.organizationId,
            teamId,
            this.kind,
            input.definition.name,
          ],
        );
        if (!inserted.rowCount) {
          const existing = await this.find(client, access, input.id, true);
          if (
            !existing ||
            existing.revision !== 1 ||
            existing.lifecycle_revision !== 1 ||
            existing.archived_at !== null ||
            existing.schema_version !== input.schemaVersion ||
            !isDeepStrictEqual(existing.definition, input.definition)
          ) {
            // One generic answer covers reused IDs with different content,
            // ownership, or kind. Never return or identify a foreign record.
            throw new ApiFailure(
              409,
              "ID_CONFLICT",
              `This ${this.kind} request cannot be reused. Reload and try again.`,
            );
          }
          await this.validateDefinition?.(client, access, input.definition);
          return { resource: this.record(existing), created: false };
        }
        await this.validateDefinition?.(client, access, input.definition);
        await this.recordVersion(client, access, input.id, 1, input, "created");
        const row = await this.find(client, access, input.id);
        if (!row) throw new Error("Catalog resource was not created.");
        return { resource: this.record(row), created: true };
      });
    } catch (error) {
      return this.mapConstraintFailure(error);
    }
  }

  async update(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    input: UpdateInput<Definition>,
  ): Promise<CatalogRecord> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const access = await this.identity.authorizeTeam(token, teamId, {
          client,
        });
        const existing = await this.find(client, access, resourceId, true);
        if (!existing) throw this.notFound();
        this.assertActive(existing);
        this.assertExpected(existing, input);
        this.supportedDefinition(existing);
        await this.validateDefinition?.(client, access, input.definition);
        const revision = existing.revision + 1;
        await client.query(
          `UPDATE resources SET name = $1, revision = $2, updated_at = now()
           WHERE id = $3`,
          [input.definition.name, revision, resourceId],
        );
        await this.recordVersion(
          client,
          access,
          resourceId,
          revision,
          input,
          "updated",
        );
        const row = await this.find(client, access, resourceId);
        if (!row) throw new Error("Catalog resource was not updated.");
        return this.record(row);
      });
    } catch (error) {
      return this.mapConstraintFailure(error);
    }
  }

  async restore(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    input: RestoreResourceRequest,
  ): Promise<CatalogRecord> {
    try {
      return await withTransaction(this.pool, async (client) => {
        const access = await this.identity.authorizeTeam(token, teamId, {
          client,
        });
        const existing = await this.find(client, access, resourceId, true);
        if (!existing) throw this.notFound();
        this.assertActive(existing);
        this.assertExpected(existing, input);
        this.supportedDefinition(existing);
        const result = await client.query<{
          id: string;
          revision: number;
          schema_version: number;
          definition: unknown;
        }>(
          `SELECT id, revision, schema_version, definition FROM resource_versions
           WHERE resource_id = $1 AND id = $2`,
          [resourceId, input.versionId],
        );
        const source = result.rows[0];
        if (!source) throw this.notFound();
        if (source.schema_version !== 1) {
          throw new ApiFailure(
            409,
            "UNSUPPORTED_SCHEMA_VERSION",
            "This saved version uses an unsupported schema and cannot be restored.",
            { versionId: ["Choose a version with a supported schema."] },
          );
        }
        let definition: Definition;
        try {
          definition = this.parseDefinition(source.definition);
        } catch {
          throw new ApiFailure(
            409,
            "INVALID_STORED_DEFINITION",
            "This saved definition is unsupported or invalid and cannot be restored.",
            {
              versionId: [
                "Choose a version with a supported, valid definition.",
              ],
            },
          );
        }
        // Resolve the historical pins again under today's access/ownership.
        await this.validateDefinition?.(client, access, definition);
        const revision = existing.revision + 1;
        await client.query(
          `UPDATE resources SET name = $1, revision = $2, updated_at = now() WHERE id = $3`,
          [definition.name, revision, resourceId],
        );
        await this.recordVersion(
          client,
          access,
          resourceId,
          revision,
          { schemaVersion: 1, definition },
          "restored",
          { sourceVersionId: source.id, sourceRevision: source.revision },
        );
        const row = await this.find(client, access, resourceId);
        if (!row) throw new Error("Catalog resource was not restored.");
        return this.record(row);
      });
    } catch (error) {
      return this.mapConstraintFailure(error);
    }
  }

  async setArchived(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    input: ResourceLifecycleRequest,
    archived: boolean,
  ): Promise<CatalogRecord> {
    return withTransaction(this.pool, async (client) => {
      const access = await this.identity.authorizeTeam(token, teamId, {
        client,
      });
      const existing = await this.find(client, access, resourceId, true);
      if (!existing) throw this.notFound();
      this.assertExpected(existing, input);
      const definition = this.supportedDefinition(existing);
      if ((existing.archived_at !== null) === archived)
        throw new ApiFailure(
          409,
          "LIFECYCLE_CONFLICT",
          `This ${this.kind} is already ${archived ? "archived" : "active"}. Load the latest record.`,
        );
      if (archived && this.kind !== "flow") {
        await validateNoActiveFlowReferences(client, access, resourceId);
      } else if (!archived) {
        // In particular, reactivating a Flow rechecks its original exact pins.
        await this.validateDefinition?.(client, access, definition);
      }
      const lifecycleRevision = existing.lifecycle_revision + 1;
      await client.query(
        `UPDATE resources SET archived_at = CASE WHEN $1 THEN now() ELSE NULL END,
           lifecycle_revision = $2, updated_at = now() WHERE id = $3`,
        [archived, lifecycleRevision, resourceId],
      );
      await client.query(
        `INSERT INTO audit_events (organization_id, actor_user_id, action, target_id, metadata)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          access.organizationId,
          access.userId,
          `${this.kind}.${archived ? "archived" : "unarchived"}`,
          resourceId,
          JSON.stringify({ revision: existing.revision, lifecycleRevision }),
        ],
      );
      const row = await this.find(client, access, resourceId);
      if (!row) throw new Error("Catalog lifecycle was not updated.");
      return this.record(row);
    });
  }
}
