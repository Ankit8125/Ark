import {
  FlowListResponseSchema,
  FlowResponseSchema,
  ResourceVersionResponseSchema,
  type CatalogStatus,
  type CreateFlowRequest,
  type ResourceVersionReference,
  type UpdateFlowRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";
import { catalogHistoryApi } from "../catalog/history-api";
import {
  catalogLifecycleApi,
  catalogListQuery,
} from "../catalog/lifecycle-api";

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
  ...catalogHistoryApi("flows", flowResponse),
  ...catalogLifecycleApi("flows", flowResponse),
  list: (
    teamId: string,
    cursor?: string,
    signal?: AbortSignal,
    status: CatalogStatus = "active",
  ) =>
    requestJson(
      `${collection(teamId)}${catalogListQuery(status, cursor)}`,
      {
        parse(value: unknown) {
          const result = FlowListResponseSchema.parse(value);
          if (
            result.flows.some(
              (flow) =>
                flow.teamId !== teamId ||
                (flow.archivedAt !== null) !== (status === "archived"),
            )
          )
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
