import {
  RepositoryExecutionParamsSchema,
  RepositoryPreparationReceiptRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { RepositoryPreparationReceiptService } from "./repository-preparation-receipts.js";

const noQuery = z.strictObject({});

export function registerRepositoryPreparationReceiptRoutes(
  app: FastifyInstance,
  service: RepositoryPreparationReceiptService,
): void {
  app.post(
    "/api/runner/repository-executions/preparation-receipts",
    async (request, reply) => {
      parseRequest(noQuery, request.query);
      const result = await service.upload(
        request.headers.authorization,
        parseRequest(RepositoryPreparationReceiptRequestSchema, request.body),
      );
      reply.code(result.created ? 201 : 200);
      return result.response;
    },
  );
  app.get(
    "/api/teams/:teamId/repository-executions/:executionId/preparation-receipt",
    async (request) => {
      const { teamId, executionId } = parseRequest(
        RepositoryExecutionParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      return service.get(request.cookies.ark_session, teamId, executionId);
    },
  );
}
