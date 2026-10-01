import { FlowListResponseSchema, FlowSchema } from "@ark/contracts";
import type {
  CreateFlowRequest,
  Flow,
  FlowDefinition,
  FlowListResponse,
  UpdateFlowRequest,
} from "@ark/contracts";
import type { Pool } from "pg";
import { validateFlowDependencies } from "./flow-dependencies.js";
import type { IdentityService } from "./identity.js";
import { VersionedCatalogService } from "./versioned-catalog.js";

export class FlowService {
  private readonly catalog: VersionedCatalogService<FlowDefinition>;

  constructor(pool: Pool, identity: IdentityService) {
    this.catalog = new VersionedCatalogService(
      pool,
      identity,
      "flow",
      FlowSchema.parse,
      validateFlowDependencies,
    );
  }

  async list(
    token: string | undefined,
    teamId: string,
    cursor?: string,
  ): Promise<FlowListResponse> {
    const page = await this.catalog.list(token, teamId, cursor);
    return FlowListResponseSchema.parse({
      flows: page.resources,
      nextCursor: page.nextCursor,
    });
  }

  async get(
    token: string | undefined,
    teamId: string,
    flowId: string,
  ): Promise<Flow> {
    return this.catalog.get(token, teamId, flowId);
  }

  async create(
    token: string | undefined,
    teamId: string,
    input: CreateFlowRequest,
  ): Promise<{ flow: Flow; created: boolean }> {
    const result = await this.catalog.create(token, teamId, input);
    return { flow: result.resource, created: result.created };
  }

  async update(
    token: string | undefined,
    teamId: string,
    flowId: string,
    input: UpdateFlowRequest,
  ): Promise<Flow> {
    return this.catalog.update(token, teamId, flowId, input);
  }
}
