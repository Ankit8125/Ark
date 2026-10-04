import {
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
  type CatalogStatus,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";
import { catalogHistoryApi } from "../catalog/history-api";
import {
  catalogLifecycleApi,
  catalogListQuery,
} from "../catalog/lifecycle-api";

function collection(teamId: string) {
  return `/api/teams/${encodeURIComponent(teamId)}/workspaces`;
}

function workspaceResponse(teamId: string, id: string) {
  return {
    parse(value: unknown) {
      const { workspace } = WorkspaceResponseSchema.parse(value);
      if (workspace.teamId !== teamId || workspace.id !== id)
        throw new Error("Unexpected workspace context");
      return workspace;
    },
  };
}

export const workspaceApi = {
  ...catalogHistoryApi("workspaces", workspaceResponse),
  ...catalogLifecycleApi("workspaces", workspaceResponse),
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
          const result = WorkspaceListResponseSchema.parse(value);
          if (
            result.workspaces.some(
              (workspace) =>
                workspace.teamId !== teamId ||
                (workspace.archivedAt !== null) !== (status === "archived"),
            )
          )
            throw new Error("Unexpected workspace context");
          return result;
        },
      },
      { signal },
    ),
  get: (teamId: string, id: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      workspaceResponse(teamId, id),
      { signal },
    ),
  create: (
    teamId: string,
    input: CreateWorkspaceRequest,
    signal?: AbortSignal,
  ) =>
    requestJson(collection(teamId), workspaceResponse(teamId, input.id), {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    }),
  update: (
    teamId: string,
    id: string,
    input: UpdateWorkspaceRequest,
    signal?: AbortSignal,
  ) =>
    requestJson(
      `${collection(teamId)}/${encodeURIComponent(id)}`,
      workspaceResponse(teamId, id),
      {
        method: "PUT",
        body: JSON.stringify(input),
        signal,
      },
    ),
};
