import { CatalogTemplateParamsSchema } from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseRequest } from "./errors.js";
import type { IdentityService } from "./identity.js";
import { listBuiltinTemplates } from "./catalog-templates.js";

export function registerCatalogTemplateRoutes(
  app: FastifyInstance,
  identity: IdentityService,
): void {
  app.get("/api/teams/:teamId/templates/:kind", async (request) => {
    const { teamId, kind } = parseRequest(
      CatalogTemplateParamsSchema,
      request.params,
    );
    parseRequest(z.strictObject({}), request.query);
    await identity.authorizeTeam(request.cookies.ark_session, teamId);
    return listBuiltinTemplates(kind);
  });
}
