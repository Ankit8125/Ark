import {
  CreateRunnerEnrollmentRequestSchema,
  EnrollRunnerRequestSchema,
  RevokeRunnerRequestSchema,
  RunnerHeartbeatRequestSchema,
  RunnerListQuerySchema,
  RunnerParamsSchema,
  RunnerTeamParamsSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { RunnerService } from "./runners.js";

export function registerRunnerRoutes(
  app: FastifyInstance,
  service: RunnerService,
): void {
  app.get("/api/teams/:teamId/runners", async (request) => {
    const { teamId } = parseRequest(RunnerTeamParamsSchema, request.params);
    const { cursor } = parseRequest(RunnerListQuerySchema, request.query);
    return service.list(request.cookies.ark_session, teamId, cursor);
  });
  app.post("/api/teams/:teamId/runner-enrollments", async (request, reply) => {
    const { teamId } = parseRequest(RunnerTeamParamsSchema, request.params);
    parseRequest(z.strictObject({}), request.query);
    const input = parseRequest(
      CreateRunnerEnrollmentRequestSchema,
      request.body,
    );
    const result = await service.issue(
      request.cookies.ark_session,
      teamId,
      input,
    );
    reply.code(result.created ? 201 : 200);
    return result.response;
  });
  app.post("/api/teams/:teamId/runners/:runnerId/revoke", async (request) => {
    const { teamId, runnerId } = parseRequest(
      RunnerParamsSchema,
      request.params,
    );
    parseRequest(z.strictObject({}), request.query);
    return service.revoke(
      request.cookies.ark_session,
      teamId,
      runnerId,
      parseRequest(RevokeRunnerRequestSchema, request.body),
    );
  });
  app.post("/api/runner/enroll", async (request) => {
    parseRequest(z.strictObject({}), request.query);
    return service.enroll(
      request.headers.authorization,
      parseRequest(EnrollRunnerRequestSchema, request.body),
    );
  });
  app.post("/api/runner/heartbeat", async (request) => {
    parseRequest(z.strictObject({}), request.query);
    parseRequest(RunnerHeartbeatRequestSchema, request.body);
    return service.heartbeat(request.headers.authorization);
  });
}
