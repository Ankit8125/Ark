import {
  WorkspaceDefinitionSchema,
  WorkspaceListResponseSchema,
  WorkspaceSchema,
} from "@ark/contracts";
import type {
  CreateWorkspaceRequest,
  ResourceVersion,
  UpdateWorkspaceRequest,
  Workspace,
  WorkspaceDefinition,
  WorkspaceListResponse,
} from "@ark/contracts";
import type { Pool } from "pg";
import type {
  RestoreResourceRequest,
  ResourceVersionListResponse,
} from "@ark/contracts";
import type { IdentityService } from "./identity.js";
import { VersionedCatalogService } from "./versioned-catalog.js";

export class WorkspaceService {
  private readonly catalog: VersionedCatalogService<WorkspaceDefinition>;

  constructor(pool: Pool, identity: IdentityService) {
    this.catalog = new VersionedCatalogService(
      pool,
      identity,
      "workspace",
      WorkspaceSchema.parse,
      WorkspaceDefinitionSchema.parse,
    );
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<WorkspaceListResponse> {
    const page = await this.catalog.list(token, teamId, cursor);
    return WorkspaceListResponseSchema.parse({
      workspaces: page.resources,
      nextCursor: page.nextCursor,
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    workspaceId: string,
  ): Promise<Workspace> {
    return this.catalog.get(token, teamId, workspaceId);
  }

  async getVersion(
    token: string | undefined,
    teamId: string,
    workspaceId: string,
    versionId: string,
  ): Promise<ResourceVersion> {
    return this.catalog.getVersion(token, teamId, workspaceId, versionId);
  }

  async listVersions(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    cursor?: number,
  ): Promise<ResourceVersionListResponse> {
    return this.catalog.listVersions(token, teamId, resourceId, cursor);
  }

  async restore(
    token: string | undefined,
    teamId: string,
    resourceId: string,
    input: RestoreResourceRequest,
  ): Promise<Workspace> {
    return this.catalog.restore(token, teamId, resourceId, input);
  }

  async create(
    token: string | undefined,
    teamId: string,
    input: CreateWorkspaceRequest,
  ): Promise<{ workspace: Workspace; created: boolean }> {
    const result = await this.catalog.create(token, teamId, input);
    return {
      workspace: result.resource,
      created: result.created,
    };
  }

  async update(
    token: string | undefined,
    teamId: string,
    workspaceId: string,
    input: UpdateWorkspaceRequest,
  ): Promise<Workspace> {
    return this.catalog.update(token, teamId, workspaceId, input);
  }
}
