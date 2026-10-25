import {
  RepositoryPlanListQuerySchema,
  RepositoryPlanParamsSchema,
  RepositoryPlanPreviewRequestSchema,
  RepositoryPlanTeamParamsSchema,
  SaveRepositoryPlanRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { RepositoryPlanService } from "./repository-plans.js";

const noQuery = z.strictObject({});

export function registerRepositoryPlanRoutes(
  app: FastifyInstance,
  service: RepositoryPlanService,
): void {
  app.post("/api/teams/:teamId/repository-plan-previews", async (request) => {
    const { teamId } = parseRequest(
      RepositoryPlanTeamParamsSchema,
      request.params,
    );
    parseRequest(noQuery, request.query);
    return service.preview(
      request.cookies.ark_session,
      teamId,
      parseRequest(RepositoryPlanPreviewRequestSchema, request.body),
    );
  });
  app.post("/api/teams/:teamId/repository-plans", async (request, reply) => {
    const { teamId } = parseRequest(
      RepositoryPlanTeamParamsSchema,
      request.params,
    );
    parseRequest(noQuery, request.query);
    const result = await service.save(
      request.cookies.ark_session,
      teamId,
      parseRequest(SaveRepositoryPlanRequestSchema, request.body),
    );
    reply.code(result.created ? 201 : 200);
    return result.response;
  });
  app.get("/api/teams/:teamId/repository-plans", async (request) => {
    const { teamId } = parseRequest(
      RepositoryPlanTeamParamsSchema,
      request.params,
    );
    const { cursor } = parseRequest(
      RepositoryPlanListQuerySchema,
      request.query,
    );
    return service.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get("/api/teams/:teamId/repository-plans/:planId", async (request) => {
    const { teamId, planId } = parseRequest(
      RepositoryPlanParamsSchema,
      request.params,
    );
    parseRequest(noQuery, request.query);
    return service.get(request.cookies.ark_session, teamId, planId);
  });
}
