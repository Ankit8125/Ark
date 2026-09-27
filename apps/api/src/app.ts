import Fastify, { LogController } from "fastify";
import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import { BootstrapRequestSchema, LoginRequestSchema } from "@ark/contracts";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiFailure, parseRequest, sendFailure } from "./errors.js";
import { IdentityService } from "./identity.js";
import type { SignedInSession } from "./identity.js";
import { WorkspaceService } from "./workspaces.js";
import { registerWorkspaceRoutes } from "./workspace-routes.js";

export interface AppOptions {
  pool: Pool;
  allowedOrigins?: string[];
  allowedHosts?: string[];
  secureCookies?: boolean;
  logger?: boolean;
  sessionTtlSeconds?: number;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 16_384,
    logger: options.logger
      ? {
          redact: [
            "req.headers.cookie",
            "req.headers.authorization",
            'res.headers["set-cookie"]',
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  const origins = new Set(
    options.allowedOrigins ?? [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
      "http://127.0.0.1:3001",
      "http://localhost:3001",
    ],
  );
  const hosts = new Set(
    options.allowedHosts ?? [
      "127.0.0.1:3001",
      "localhost:3001",
      "127.0.0.1:5173",
      "localhost:5173",
    ],
  );
  const ttl = options.sessionTtlSeconds ?? 43_200;
  if (!Number.isInteger(ttl) || ttl < 1)
    throw new Error("Session lifetime must be a positive integer.");
  const identity = new IdentityService(options.pool, ttl);
  const cookieOptions = {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: options.secureCookies ?? false,
  } as const;
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    if (!hosts.has(request.headers.host ?? ""))
      throw new ApiFailure(
        403,
        "HOST_NOT_ALLOWED",
        "This host is not allowed.",
      );
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      if (!origins.has(request.headers.origin ?? ""))
        throw new ApiFailure(
          403,
          "ORIGIN_NOT_ALLOWED",
          "This request origin is not allowed.",
        );
      if (
        request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      ) {
        throw new ApiFailure(415, "JSON_REQUIRED", "Send a JSON request.");
      }
    }
  });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiFailure) return sendFailure(reply, error);
    const status =
      error instanceof Error &&
      "statusCode" in error &&
      typeof error.statusCode === "number"
        ? error.statusCode
        : 500;
    if (status === 429)
      return reply.code(429).send({
        error: {
          code: "RATE_LIMITED",
          message: "Too many attempts. Try again shortly.",
        },
      });
    if (status >= 400 && status < 500)
      return sendFailure(
        reply,
        new ApiFailure(
          status,
          "INVALID_REQUEST",
          "The request could not be read.",
        ),
      );
    // Never log raw database errors, request bodies, or credentials.
    request.log.error({ requestId: request.id }, "Request failed.");
    return sendFailure(
      reply,
      new ApiFailure(
        500,
        "INTERNAL_ERROR",
        "The request could not be completed.",
      ),
    );
  });
  app.setNotFoundHandler((_request, reply) =>
    sendFailure(
      reply,
      new ApiFailure(404, "NOT_FOUND", "The requested endpoint was not found."),
    ),
  );
  const setSession = (
    reply: Parameters<typeof sendFailure>[0],
    session: SignedInSession,
  ) => {
    reply.setCookie("ark_session", session.token, {
      ...cookieOptions,
      expires: session.expiresAt,
      maxAge: ttl,
    });
    return session.me;
  };
  app.get("/api/health/live", async () => ({ status: "ok" }));
  app.get("/api/health/ready", async (_request, reply) => {
    try {
      if (await identity.isReady()) return { status: "ok" };
    } catch {
      /* Readiness deliberately exposes no connection details. */
    }
    return sendFailure(
      reply,
      new ApiFailure(
        503,
        "NOT_READY",
        "The database or migrations are not ready.",
      ),
    );
  });
  app.get("/api/bootstrap/status", async () => ({
    required: await identity.setupRequired(),
  }));
  app.post(
    "/api/bootstrap",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (request, reply) => {
      const session = await identity.bootstrap(
        parseRequest(BootstrapRequestSchema, request.body),
      );
      reply.code(201);
      return setSession(reply, session);
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (request, reply) => {
      return setSession(
        reply,
        await identity.login(
          parseRequest(LoginRequestSchema, request.body),
          request.cookies.ark_session,
        ),
      );
    },
  );
  app.post("/api/auth/logout", async (request, reply) => {
    parseRequest(z.strictObject({}), request.body);
    await identity.logout(request.cookies.ark_session);
    reply.clearCookie("ark_session", cookieOptions);
    return reply.code(204).send();
  });
  app.get("/api/me", async (request) =>
    identity.me(request.cookies.ark_session),
  );
  app.get("/api/teams/:teamId", async (request) => {
    const params = parseRequest(z.object({ teamId: z.uuid() }), request.params);
    return identity.team(request.cookies.ark_session, params.teamId);
  });
  registerWorkspaceRoutes(app, new WorkspaceService(options.pool, identity));
  await app.ready();
  return app;
}
