import {
  CreateFlowRequestSchema,
  FlowListQuerySchema,
  FlowParamsSchema,
  FlowVersionParamsSchema,
  UpdateFlowRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import {
  ResourceVersionListQuerySchema,
  RestoreResourceRequestSchema,
} from "@ark/contracts";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { FlowService } from "./flows.js";

const teamParams = z.strictObject({ teamId: z.uuid() });
const collectionPath = "/api/teams/:teamId/flows";
const detailPath = `${collectionPath}/:flowId`;
const mutationOptions = { bodyLimit: 131_072 };

export function registerFlowRoutes(
  app: FastifyInstance,
  flows: FlowService,
): void {
  app.get(collectionPath, async (request) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const { cursor } = parseRequest(FlowListQuerySchema, request.query);
    return flows.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get(detailPath, async (request) => {
    const { teamId, flowId } = parseRequest(FlowParamsSchema, request.params);
    return {
      flow: await flows.get(request.cookies.ark_session, teamId, flowId),
    };
  });
  app.get(`${detailPath}/versions/:versionId`, async (request) => {
    const { teamId, flowId, versionId } = parseRequest(
      FlowVersionParamsSchema,
      request.params,
    );
    return {
      version: await flows.getVersion(
        request.cookies.ark_session,
        teamId,
        flowId,
        versionId,
      ),
    };
  });
  app.get(`${detailPath}/versions`, async (request) => {
    const { teamId, flowId } = parseRequest(FlowParamsSchema, request.params);
    const { cursor } = parseRequest(
      ResourceVersionListQuerySchema,
      request.query,
    );
    return flows.listVersions(
      request.cookies.ark_session,
      teamId,
      flowId,
      cursor,
    );
  });
  app.post(`${detailPath}/restore`, { bodyLimit: 1024 }, async (request) => {
    const { teamId, flowId } = parseRequest(FlowParamsSchema, request.params);
    const input = parseRequest(RestoreResourceRequestSchema, request.body);
    return {
      flow: await flows.restore(
        request.cookies.ark_session,
        teamId,
        flowId,
        input,
      ),
    };
  });
  app.post(collectionPath, mutationOptions, async (request, reply) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const input = parseRequest(CreateFlowRequestSchema, request.body);
    const result = await flows.create(
      request.cookies.ark_session,
      teamId,
      input,
    );
    reply.code(result.created ? 201 : 200);
    return { flow: result.flow };
  });
  app.put(detailPath, mutationOptions, async (request) => {
    const { teamId, flowId } = parseRequest(FlowParamsSchema, request.params);
    const input = parseRequest(UpdateFlowRequestSchema, request.body);
    return {
      flow: await flows.update(
        request.cookies.ark_session,
        teamId,
        flowId,
        input,
      ),
    };
  });
}
