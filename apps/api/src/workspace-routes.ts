import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceListQuerySchema,
  WorkspaceParamsSchema,
  WorkspaceVersionParamsSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { WorkspaceService } from "./workspaces.js";

const teamParams = z.strictObject({ teamId: z.uuid() });
const collectionPath = "/api/teams/:teamId/workspaces";
const detailPath = `${collectionPath}/:workspaceId`;
const mutationOptions = { bodyLimit: 65_536 };

export function registerWorkspaceRoutes(
  app: FastifyInstance,
  workspaces: WorkspaceService,
): void {
  app.get(collectionPath, async (request) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const { cursor } = parseRequest(WorkspaceListQuerySchema, request.query);
    return workspaces.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get(detailPath, async (request) => {
    const { teamId, workspaceId } = parseRequest(
      WorkspaceParamsSchema,
      request.params,
    );
    return {
      workspace: await workspaces.get(
        request.cookies.ark_session,
        teamId,
        workspaceId,
      ),
    };
  });
  app.get(`${detailPath}/versions/:versionId`, async (request) => {
    const { teamId, workspaceId, versionId } = parseRequest(
      WorkspaceVersionParamsSchema,
      request.params,
    );
    return {
      version: await workspaces.getVersion(
        request.cookies.ark_session,
        teamId,
        workspaceId,
        versionId,
      ),
    };
  });
  app.post(collectionPath, mutationOptions, async (request, reply) => {
    const { teamId } = parseRequest(teamParams, request.params);
    const input = parseRequest(CreateWorkspaceRequestSchema, request.body);
    const result = await workspaces.create(
      request.cookies.ark_session,
      teamId,
      input,
    );
    reply.code(result.created ? 201 : 200);
    return { workspace: result.workspace };
  });
  app.put(detailPath, mutationOptions, async (request) => {
    const { teamId, workspaceId } = parseRequest(
      WorkspaceParamsSchema,
      request.params,
    );
    const input = parseRequest(UpdateWorkspaceRequestSchema, request.body);
    return {
      workspace: await workspaces.update(
        request.cookies.ark_session,
        teamId,
        workspaceId,
        input,
      ),
    };
  });
}
