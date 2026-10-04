import type { CatalogStatus, ResourceLifecycleRequest } from "@ark/contracts";
import { requestJson } from "../../api";

export function catalogListQuery(status: CatalogStatus, cursor?: string) {
  const query = new URLSearchParams();
  if (status === "archived") query.set("status", status);
  if (cursor) query.set("cursor", cursor);
  return query.size ? `?${query}` : "";
}

export function catalogLifecycleApi<RecordType>(
  plural: "workspaces" | "agents" | "flows",
  response: (
    teamId: string,
    id: string,
  ) => { parse: (value: unknown) => RecordType },
) {
  function transition(action: "archive" | "unarchive") {
    return (
      teamId: string,
      id: string,
      input: ResourceLifecycleRequest,
      signal?: AbortSignal,
    ) =>
      requestJson(
        `/api/teams/${encodeURIComponent(teamId)}/${plural}/${encodeURIComponent(id)}/${action}`,
        response(teamId, id),
        { method: "POST", body: JSON.stringify(input), signal },
      );
  }
  return { archive: transition("archive"), unarchive: transition("unarchive") };
}
