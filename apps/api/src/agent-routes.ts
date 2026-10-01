import {
  AgentListQuerySchema,
  AgentParamsSchema,
  AgentVersionParamsSchema,
  CreateAgentRequestSchema,
  UpdateAgentRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AgentService } from "./agents.js";
import { parseRequest } from "./errors.js";

const teamParams = z.strictObject({ teamId: z.uuid() });
const collectionPath = "/api/teams/:teamId/agents";
const detailPath = `${collectionPath}/:agentId`;
// Includes the maximum definition even when every character is JSON-escaped.
const mutationOptions = { bodyLimit: 131_072 };

export function registerAgentRoutes(
  app: FastifyInstance,
  agents: AgentService,
): void {
  app.get(collectionPath, async (request) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const { cursor } = parseRequest(AgentListQuerySchema, request.query);
    return agents.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get(detailPath, async (request) => {
    const { teamId, agentId } = parseRequest(AgentParamsSchema, request.params);
    return {
      agent: await agents.get(request.cookies.ark_session, teamId, agentId),
    };
  });
  app.get(`${detailPath}/versions/:versionId`, async (request) => {
    const { teamId, agentId, versionId } = parseRequest(
      AgentVersionParamsSchema,
      request.params,
    );
    return {
      version: await agents.getVersion(
        request.cookies.ark_session,
        teamId,
        agentId,
        versionId,
      ),
    };
  });
  app.post(collectionPath, mutationOptions, async (request, reply) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const input = parseRequest(CreateAgentRequestSchema, request.body);
    const result = await agents.create(
      request.cookies.ark_session,
      teamId,
      input,
    );
    reply.code(result.created ? 201 : 200);
    return { agent: result.agent };
  });
  app.put(detailPath, mutationOptions, async (request) => {
    const { teamId, agentId } = parseRequest(AgentParamsSchema, request.params);
    const input = parseRequest(UpdateAgentRequestSchema, request.body);
    return {
      agent: await agents.update(
        request.cookies.ark_session,
        teamId,
        agentId,
        input,
      ),
    };
  });
}
