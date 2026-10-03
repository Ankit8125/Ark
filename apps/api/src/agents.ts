import {
  AgentDefinitionSchema,
  AgentListResponseSchema,
  AgentSchema,
} from "@ark/contracts";
import type {
  Agent,
  AgentDefinition,
  AgentListResponse,
  CreateAgentRequest,
  ResourceVersion,
  UpdateAgentRequest,
} from "@ark/contracts";
import type { Pool } from "pg";
import type {
  RestoreResourceRequest,
  ResourceVersionListResponse,
} from "@ark/contracts";
import type { IdentityService } from "./identity.js";
import { VersionedCatalogService } from "./versioned-catalog.js";

export class AgentService {
  private readonly catalog: VersionedCatalogService<AgentDefinition>;

  constructor(pool: Pool, identity: IdentityService) {
    this.catalog = new VersionedCatalogService(
      pool,
      identity,
      "agent",
      AgentSchema.parse,
      AgentDefinitionSchema.parse,
    );
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<AgentListResponse> {
    const page = await this.catalog.list(token, teamId, cursor);
    return AgentListResponseSchema.parse({
      agents: page.resources,
      nextCursor: page.nextCursor,
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    agentId: string,
  ): Promise<Agent> {
    return this.catalog.get(token, teamId, agentId);
  }

  async getVersion(
    token: string | undefined,
    teamId: string,
    agentId: string,
    versionId: string,
  ): Promise<ResourceVersion> {
    return this.catalog.getVersion(token, teamId, agentId, versionId);
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
  ): Promise<Agent> {
    return this.catalog.restore(token, teamId, resourceId, input);
  }

  async create(
    token: string | undefined,
    teamId: string,
    input: CreateAgentRequest,
  ): Promise<{ agent: Agent; created: boolean }> {
    const result = await this.catalog.create(token, teamId, input);
    return {
      agent: result.resource,
      created: result.created,
    };
  }

  async update(
    token: string | undefined,
    teamId: string,
    agentId: string,
    input: UpdateAgentRequest,
  ): Promise<Agent> {
    return this.catalog.update(token, teamId, agentId, input);
  }
}
