import {
  SessionEventSchema,
  SessionEventLogResponseSchema,
  SessionListResponseSchema,
  SessionPreviewResponseSchema,
  SessionResponseSchema,
  type SessionPreviewRequest,
  type StartSessionRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

const collection = (teamId: string) =>
  `/api/teams/${encodeURIComponent(teamId)}/sessions`;
const resource = (teamId: string, id: string) =>
  `${collection(teamId)}/${encodeURIComponent(id)}`;
function response(teamId: string, id: string, request?: StartSessionRequest) {
  return {
    parse(value: unknown) {
      const result = SessionResponseSchema.parse(value);
      const session = result.session;
      if (
        session.teamId !== teamId ||
        session.id !== id ||
        (request &&
          (session.runnerId !== request.runnerId ||
            session.flowResourceId !== request.flow.resourceId ||
            session.flowVersionId !== request.flow.versionId))
      )
        throw new Error("Unexpected session identity");
      return result;
    },
  };
}

export const sessionsApi = {
  list(teamId: string, cursor?: string, signal?: AbortSignal) {
    return requestJson(
      `${collection(teamId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      {
        parse(value: unknown) {
          const result = SessionListResponseSchema.parse(value);
          if (
            result.sessions.some((item) => item.teamId !== teamId) ||
            new Set(result.sessions.map((item) => item.id)).size !==
              result.sessions.length
          )
            throw new Error("Unexpected session list");
          return result;
        },
      },
      { signal },
    );
  },
  get(teamId: string, id: string, signal?: AbortSignal) {
    return requestJson(resource(teamId, id), response(teamId, id), { signal });
  },
  preview(teamId: string, input: SessionPreviewRequest, signal?: AbortSignal) {
    return requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/session-previews`,
      {
        parse(value: unknown) {
          const result = SessionPreviewResponseSchema.parse(value);
          if (
            result.runnerId !== input.runnerId ||
            result.snapshot.flow.resourceId !== input.flow.resourceId ||
            result.snapshot.flow.versionId !== input.flow.versionId
          )
            throw new Error("Unexpected preview identity");
          return result;
        },
      },
      { method: "POST", body: JSON.stringify(input), signal },
    );
  },
  start(teamId: string, input: StartSessionRequest, signal?: AbortSignal) {
    return requestJson(collection(teamId), response(teamId, input.id, input), {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
  },
  cancel(
    teamId: string,
    id: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return requestJson(`${resource(teamId, id)}/cancel`, response(teamId, id), {
      method: "POST",
      body: JSON.stringify({ expectedRevision }),
      signal,
    });
  },
  reconcile(
    teamId: string,
    id: string,
    expectedRevision: number,
    signal?: AbortSignal,
  ) {
    return requestJson(
      `${resource(teamId, id)}/reconcile`,
      response(teamId, id),
      {
        method: "POST",
        body: JSON.stringify({ expectedRevision, confirmedStopped: true }),
        signal,
      },
    );
  },
  events(teamId: string, id: string, after = 0, signal?: AbortSignal) {
    return requestJson(
      `${resource(teamId, id)}/event-log?after=${after}`,
      {
        parse(value: unknown) {
          const result = SessionEventLogResponseSchema.parse(value);
          let previous = after;
          const ids = new Set<string>();
          for (const event of result.events) {
            if (
              event.sessionId !== id ||
              event.sequence <= previous ||
              ids.has(event.id)
            )
              throw new Error("Unexpected session event log");
            previous = event.sequence;
            ids.add(event.id);
          }
          if (
            result.nextAfter !== null &&
            (result.events.length === 0 || result.nextAfter !== previous)
          )
            throw new Error("Unexpected event cursor");
          return result;
        },
      },
      { signal },
    );
  },
};

export function sessionEventsUrl(teamId: string, id: string, after: number) {
  if (!Number.isSafeInteger(after) || after < 0 || after > 2_147_483_647)
    throw new Error("Invalid session event cursor");
  return `${resource(teamId, id)}/events?after=${encodeURIComponent(`${id}:${after}`)}`;
}

export function parseSessionEvent(
  id: string,
  data: string,
  lastEventId: string,
) {
  const event = SessionEventSchema.parse(JSON.parse(data));
  if (event.sessionId !== id || lastEventId !== `${id}:${event.sequence}`)
    throw new Error("Unexpected stream event identity");
  return event;
}

export function isTerminal(state: string) {
  return state === "completed" || state === "failed" || state === "cancelled";
}
