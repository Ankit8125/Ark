import {
  AgentDefinitionSchema,
  WorkspaceDefinitionSchema,
} from "@ark/contracts";
import type { FlowDefinition, ResourceVersionReference } from "@ark/contracts";
import type { PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import type { TeamAccess } from "./identity.js";

interface DependencyReference extends ResourceVersionReference {
  kind: "workspace" | "agent";
  field: string;
}
interface DependencyRow {
  resource_id: string;
  version_id: string;
  kind: "workspace" | "agent";
  schema_version: number;
  definition: unknown;
}

function referenceKey(
  reference: ResourceVersionReference,
  kind: string,
): string {
  return `${kind}:${reference.resourceId.toLowerCase()}:${reference.versionId.toLowerCase()}`;
}

function unavailableDependency(field: string): ApiFailure {
  const message = "Choose an available version from this team's catalog.";
  return new ApiFailure(400, "INVALID_DEPENDENCY", message, {
    [field]: [message],
  });
}

// Called only inside the catalog write transaction, after owning-team
// authorization has locked the active identity and membership rows.
export async function validateFlowDependencies(
  client: PoolClient,
  access: TeamAccess,
  definition: FlowDefinition,
): Promise<void> {
  const references: DependencyReference[] = [
    {
      ...definition.workspace,
      kind: "workspace",
      field: "definition.workspace",
    },
    ...definition.stages.map((stage, index) => ({
      ...stage.agent,
      kind: "agent" as const,
      field: `definition.stages.${index}.agent`,
    })),
  ];
  const resourceIds = [
    ...new Set(
      references.map((reference) => reference.resourceId.toLowerCase()),
    ),
  ];
  const versionIds = [
    ...new Set(references.map((reference) => reference.versionId)),
  ];

  // One owning Flow row precedes these sorted dependency locks. Flows cannot
  // depend on Flows, and Workspace/Agent writes never lock a dependent Flow.
  // Re-read versions afterward so a wait observes the latest ownership state.
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM resources
     WHERE id = ANY($1::uuid[]) AND team_id = $2 AND organization_id = $3
       AND kind IN ('workspace', 'agent')
     ORDER BY id FOR SHARE`,
    [resourceIds, access.team.id, access.organizationId],
  );
  const lockedIds = new Set(locked.rows.map((row) => row.id));
  for (const reference of references) {
    // A row that becomes newly visible between statements was not locked by
    // this transaction. Reject it instead of resolving an unprotected record.
    if (!lockedIds.has(reference.resourceId.toLowerCase()))
      throw unavailableDependency(reference.field);
  }
  const result = await client.query<DependencyRow>(
    `SELECT r.id AS resource_id, r.kind, v.id AS version_id,
            v.schema_version, v.definition
     FROM resources r JOIN resource_versions v ON v.resource_id = r.id
     WHERE r.id = ANY($1::uuid[]) AND v.id = ANY($2::uuid[])
       AND r.team_id = $3 AND r.organization_id = $4
       AND r.kind IN ('workspace', 'agent')`,
    [resourceIds, versionIds, access.team.id, access.organizationId],
  );
  const versions = new Map(
    result.rows.map((row) => [
      referenceKey(
        { resourceId: row.resource_id, versionId: row.version_id },
        row.kind,
      ),
      row,
    ]),
  );
  for (const reference of references) {
    const version = versions.get(referenceKey(reference, reference.kind));
    if (!version) {
      // Missing, cross-team, wrong-kind, and mismatched pairs receive the same
      // answer. Never reveal a referenced resource's owner, name, or content.
      throw unavailableDependency(reference.field);
    }
    const schema =
      reference.kind === "workspace"
        ? WorkspaceDefinitionSchema
        : AgentDefinitionSchema;
    if (
      version.schema_version !== 1 ||
      !schema.safeParse(version.definition).success
    ) {
      const message = "Choose a version with a supported, valid definition.";
      throw new ApiFailure(400, "UNSUPPORTED_DEPENDENCY", message, {
        [reference.field]: [message],
      });
    }
  }
}
