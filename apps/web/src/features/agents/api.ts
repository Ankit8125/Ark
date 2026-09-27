import {
  AgentListResponseSchema,
  AgentResponseSchema,
  type CreateAgentRequest,
  type UpdateAgentRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

function collection(teamId: string) {
  return `/api/teams/${encodeURIComponent(teamId)}/agents`;
}
function agentResponse(teamId: string, id: string) {
  return {
    parse(value: unknown) {
      const { agent } = AgentResponseSchema.parse(value);
      if (agent.teamId !== teamId || agent.id !== id)
        throw new Error("Unexpected agent context");
      return agent;
    },
  };
}
export const agentApi = {
  list: (teamId: string, cursor?: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      {
        parse(value: unknown) {
          const result = AgentListResponseSchema.parse(value);
          if (result.agents.some((agent) => agent.teamId !== teamId))
            throw new Error("Unexpected agent context");
          return result;
        },
      },
      { signal },
    ),
  get: (teamId: string, id: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      agentResponse(teamId, id),
      { signal },
    ),
  create: (teamId: string, input: CreateAgentRequest, signal?: AbortSignal) =>
    requestJson(collection(teamId), agentResponse(teamId, input.id), {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  update: (
    teamId: string,
    id: string,
    input: UpdateAgentRequest,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      agentResponse(teamId, id),
      { method: "PUT", body: JSON.stringify(input), signal },
    ),
};
