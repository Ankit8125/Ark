import { setTimeout as delay } from "node:timers/promises";
import {
  SessionAdvanceRequestSchema,
  SessionCancelRequestSchema,
  SessionClaimRequestSchema,
  SessionEventLogQuerySchema,
  SessionListQuerySchema,
  SessionParamsSchema,
  SessionPreviewRequestSchema,
  SessionReconcileRequestSchema,
  SessionTeamParamsSchema,
  StartSessionRequestSchema,
} from "@ark/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ApiFailure, parseRequest } from "./errors.js";
import type { SessionService } from "./sessions.js";

const noQuery = z.strictObject({});
const streamQuery = z.strictObject({ after: z.string().max(80).optional() });
export function sessionStreamCursor(
  value: string | undefined,
  sessionId: string,
): number {
  if (value === undefined) return 0;
  const match = /^([a-fA-F0-9-]{36}):(0|[1-9]\d{0,9})$/.exec(value);
  if (
    !match ||
    match[0] !== value ||
    !z.uuid().safeParse(match[1]).success ||
    match[1]!.toLowerCase() !== sessionId.toLowerCase()
  )
    throw new ApiFailure(
      400,
      "INVALID_CURSOR",
      "Use an event cursor for this session.",
    );
  const cursor = Number(match[2]);
  if (cursor > 2_147_483_647)
    throw new ApiFailure(
      400,
      "INVALID_CURSOR",
      "Use a bounded event sequence.",
    );
  return cursor;
}

export function registerSessionRoutes(
  app: FastifyInstance,
  service: SessionService,
  streamMilliseconds = 20_000,
): void {
  if (
    !Number.isInteger(streamMilliseconds) ||
    streamMilliseconds < 250 ||
    streamMilliseconds > 30_000
  )
    throw new Error("Invalid session stream lifetime.");
  app.post("/api/teams/:teamId/session-previews", async (request) => {
    const { teamId } = parseRequest(SessionTeamParamsSchema, request.params);
    parseRequest(noQuery, request.query);
    return service.preview(
      request.cookies.ark_session,
      teamId,
      parseRequest(SessionPreviewRequestSchema, request.body),
    );
  });
  app.post("/api/teams/:teamId/sessions", async (request, reply) => {
    const { teamId } = parseRequest(SessionTeamParamsSchema, request.params);
    parseRequest(noQuery, request.query);
    const result = await service.start(
      request.cookies.ark_session,
      teamId,
      parseRequest(StartSessionRequestSchema, request.body),
    );
    reply.code(result.created ? 201 : 200);
    return result.response;
  });
  app.get("/api/teams/:teamId/sessions", async (request) => {
    const { teamId } = parseRequest(SessionTeamParamsSchema, request.params);
    const { cursor } = parseRequest(SessionListQuerySchema, request.query);
    return service.list(request.cookies.ark_session, teamId, cursor);
  });
  app.get("/api/teams/:teamId/sessions/:sessionId", async (request) => {
    const { teamId, sessionId } = parseRequest(
      SessionParamsSchema,
      request.params,
    );
    parseRequest(noQuery, request.query);
    return service.get(request.cookies.ark_session, teamId, sessionId);
  });
  app.post("/api/teams/:teamId/sessions/:sessionId/cancel", async (request) => {
    const { teamId, sessionId } = parseRequest(
      SessionParamsSchema,
      request.params,
    );
    parseRequest(noQuery, request.query);
    return service.cancel(
      request.cookies.ark_session,
      teamId,
      sessionId,
      parseRequest(SessionCancelRequestSchema, request.body).expectedRevision,
    );
  });
  app.post(
    "/api/teams/:teamId/sessions/:sessionId/reconcile",
    async (request) => {
      const { teamId, sessionId } = parseRequest(
        SessionParamsSchema,
        request.params,
      );
      parseRequest(noQuery, request.query);
      return service.reconcile(
        request.cookies.ark_session,
        teamId,
        sessionId,
        parseRequest(SessionReconcileRequestSchema, request.body)
          .expectedRevision,
      );
    },
  );
  app.get(
    "/api/teams/:teamId/sessions/:sessionId/event-log",
    async (request) => {
      const { teamId, sessionId } = parseRequest(
        SessionParamsSchema,
        request.params,
      );
      const { after } = parseRequest(SessionEventLogQuerySchema, request.query);
      return service.events(
        request.cookies.ark_session,
        teamId,
        sessionId,
        after,
      );
    },
  );
  app.get(
    "/api/teams/:teamId/sessions/:sessionId/events",
    async (request, reply) => {
      const { teamId, sessionId } = parseRequest(
        SessionParamsSchema,
        request.params,
      );
      const { after } = parseRequest(streamQuery, request.query);
      const header = request.headers["last-event-id"];
      if (header !== undefined && typeof header !== "string")
        throw new ApiFailure(400, "INVALID_CURSOR", "Use one event cursor.");
      const queryCursor = sessionStreamCursor(after, sessionId);
      const headerCursor = sessionStreamCursor(header, sessionId);
      if (
        after !== undefined &&
        header !== undefined &&
        queryCursor !== headerCursor
      )
        throw new ApiFailure(
          400,
          "INVALID_CURSOR",
          "Event cursors must agree.",
        );
      let cursor = after !== undefined ? queryCursor : headerCursor;
      // Validate authorization and cursor before committing an event-stream response.
      let batch = await service.eventBatch(
        request.cookies.ark_session,
        teamId,
        sessionId,
        cursor,
      );
      const controller = new AbortController();
      const stop = () => controller.abort();
      reply.raw.on("close", stop);
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const deadline = Date.now() + streamMilliseconds;
      try {
        while (!controller.signal.aborted) {
          // A bounded batch is authorized in its own short transaction. No DB
          // connection/transaction remains held while the browser is idle.
          for (const item of batch.log.events) {
            if (controller.signal.aborted) break;
            reply.raw.write(
              `id: ${sessionId}:${item.sequence}\nevent: session\ndata: ${JSON.stringify(item)}\n\n`,
            );
            cursor = item.sequence;
          }
          if (batch.terminal && batch.log.nextAfter === null) break;
          if (Date.now() >= deadline) break;
          if (batch.log.nextAfter === null) {
            reply.raw.write(": keepalive\n\n");
            await delay(
              Math.min(1000, Math.max(1, deadline - Date.now())),
              undefined,
              { signal: controller.signal },
            );
          }
          if (controller.signal.aborted) break;
          // Revocation/expiry throws here and closes without sending private data.
          batch = await service.eventBatch(
            request.cookies.ark_session,
            teamId,
            sessionId,
            cursor,
          );
        }
      } catch {
        // Stream headers are already sent; never serialize raw errors or credentials.
      } finally {
        reply.raw.off("close", stop);
        if (!reply.raw.destroyed) reply.raw.end();
      }
    },
  );
  app.post("/api/runner/sessions/claim", async (request) => {
    parseRequest(noQuery, request.query);
    return service.claim(
      request.headers.authorization,
      parseRequest(SessionClaimRequestSchema, request.body),
    );
  });
  app.post("/api/runner/sessions/advance", async (request) => {
    parseRequest(noQuery, request.query);
    return service.advance(
      request.headers.authorization,
      parseRequest(SessionAdvanceRequestSchema, request.body),
    );
  });
}
