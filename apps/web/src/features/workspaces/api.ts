import {
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
  type CreateWorkspaceRequest,
  type UpdateWorkspaceRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

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
  list: (teamId: string, cursor?: string, signal?: AbortSignal) =>
    requestJson(
      `${collection(teamId)}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      {
        parse(value: unknown) {
          const result = WorkspaceListResponseSchema.parse(value);
          if (
            result.workspaces.some((workspace) => workspace.teamId !== teamId)
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
