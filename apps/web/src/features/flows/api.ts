import {
  FlowListResponseSchema,
  FlowResponseSchema,
  ResourceVersionResponseSchema,
  type CreateFlowRequest,
  type ResourceVersionReference,
  type UpdateFlowRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

function collection(teamId: string) {
  return `/api/teams/${encodeURIComponent(teamId)}/flows`;
}
function flowResponse(teamId: string, id: string) {
  return {
    parse(value: unknown) {
      const { flow } = FlowResponseSchema.parse(value);
      if (flow.teamId !== teamId || flow.id !== id)
        throw new Error("Unexpected flow context");
      return flow;
    },
  };
}
export const flowApi = {
  list: (teamId: string, cursor?: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      {
        parse(value: unknown) {
          const result = FlowListResponseSchema.parse(value);
          if (result.flows.some((flow) => flow.teamId !== teamId))
            throw new Error("Unexpected flow context");
          return result;
        },
      },
      { signal },
    ),
  get: (teamId: string, id: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      flowResponse(teamId, id),
      { signal },
    ),
  create: (teamId: string, input: CreateFlowRequest, signal?: AbortSignal) =>
    requestJson(collection(teamId), flowResponse(teamId, input.id), {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  update: (
    teamId: string,
    id: string,
    input: UpdateFlowRequest,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      flowResponse(teamId, id),
      {
        method: "PUT",
        body: JSON.stringify(input),
        signal,
      },
    ),
  version: (
    teamId: string,
    kind: "workspace" | "agent",
    reference: ResourceVersionReference,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `/api/teams/${encodeURIComponent(teamId)}/${kind}s/${encodeURIComponent(reference.resourceId)}/versions/${encodeURIComponent(reference.versionId)}`,
      {
        parse(value: unknown) {
          const { version } = ResourceVersionResponseSchema.parse(value);
          if (
            version.teamId !== teamId ||
            version.resourceId !== reference.resourceId ||
            version.versionId !== reference.versionId
          )
            throw new Error("Unexpected resource version context");
          return version;
        },
      },
      { signal },
    ),
};
