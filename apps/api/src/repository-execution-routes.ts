import {
  RepositoryExecutionCancelRequestSchema,
  RepositoryExecutionClaimRequestSchema,
  RepositoryExecutionControlRequestSchema,
  RepositoryExecutionEventLogQuerySchema,
  RepositoryExecutionListQuerySchema,
  RepositoryExecutionParamsSchema,
  RepositoryExecutionPreviewRequestSchema,
  RepositoryExecutionTeamParamsSchema,
  StartRepositoryExecutionRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { RepositoryExecutionService } from "./repository-executions.js";

const noQuery = z.strictObject({});
export function registerRepositoryExecutionRoutes(
  app: FastifyInstance,
  service: RepositoryExecutionService,
): void {
  app.post(
    "/api/teams/:teamId/repository-execution-previews",
    async (request) => {
      const { teamId } = parseRequest(
        RepositoryExecutionTeamParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      return service.preview(
        request.cookies.ark_session,
        teamId,
        parseRequest(RepositoryExecutionPreviewRequestSchema, request.body),
      );
    },
  );
  app.post(
    "/api/teams/:teamId/repository-executions",
    async (request, reply) => {
      const { teamId } = parseRequest(
        RepositoryExecutionTeamParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      const result = await service.start(
        request.cookies.ark_session,
        teamId,
        parseRequest(StartRepositoryExecutionRequestSchema, request.body),
      );
      reply.code(result.created ? 201 : 200);
      return result.response;
    },
  );
  app.get("/api/teams/:teamId/repository-executions", async (request) => {
    const { teamId } = parseRequest(
      RepositoryExecutionTeamParamsSchema,
      request.params,
    );
    const { cursor } = parseRequest(
      RepositoryExecutionListQuerySchema,
      request.query,
    );
    return service.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get(
    "/api/teams/:teamId/repository-executions/:executionId",
    async (request) => {
      const { teamId, executionId } = parseRequest(
        RepositoryExecutionParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      return service.get(request.cookies.ark_session, teamId, executionId);
    },
  );
  app.post(
    "/api/teams/:teamId/repository-executions/:executionId/cancel",
    async (request) => {
      const { teamId, executionId } = parseRequest(
        RepositoryExecutionParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      const { expectedRevision } = parseRequest(
        RepositoryExecutionCancelRequestSchema,
        request.body,
      );
      return service.cancel(
        request.cookies.ark_session,
        teamId,
        executionId,
        expectedRevision,
      );
    },
  );
  app.get(
    "/api/teams/:teamId/repository-executions/:executionId/events",
    async (request) => {
      const { teamId, executionId } = parseRequest(
        RepositoryExecutionParamsSchema,
        request.params,
      );
      const { after } = parseRequest(
        RepositoryExecutionEventLogQuerySchema,
        request.query,
      );
      return service.events(
        request.cookies.ark_session,
        teamId,
        executionId,
        after,
      );
    },
  );
  app.post("/api/runner/repository-executions/claim", async (request) => {
    parseRequest(noQuery, request.query);
    return service.claim(
      request.headers.authorization,
      parseRequest(RepositoryExecutionClaimRequestSchema, request.body),
    );
  });
  app.post("/api/runner/repository-executions/control", async (request) => {
    parseRequest(noQuery, request.query);
    return service.control(
      request.headers.authorization,
      parseRequest(RepositoryExecutionControlRequestSchema, request.body),
    );
  });
}
