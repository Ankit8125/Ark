import {
  ResourceVersionListResponseSchema,
  ResourceVersionResponseSchema,
  type RestoreResourceRequest,
} from "@ark/contracts";
import { requestJson } from "../../api";

// Each feature still parses its own concrete current-record response.
export function catalogHistoryApi<RecordType>(
  plural: "workspaces" | "agents" | "flows",
  response: (
    teamId: string,
    id: string,
  ) => { parse: (value: unknown) => RecordType },
) {
  function resource(teamId: string, id: string) {
    return `/api/teams/${encodeURIComponent(teamId)}/${plural}/${encodeURIComponent(id)}`;
  }
  return {
    listVersions: (
      teamId: string,
      id: string,
      cursor?: number,
      signal?: AbortSignal,
    ) =>
      requestJson(
        `${resource(teamId, id)}/versions${cursor === undefined ? "" : `?cursor=${cursor}`}`,
        {
          parse(value: unknown) {
            const result = ResourceVersionListResponseSchema.parse(value);
            if (
              result.versions.some(
                (version, index) =>
                  version.teamId !== teamId ||
                  version.resourceId !== id ||
                  (cursor !== undefined && version.revision >= cursor) ||
                  (index > 0 &&
                    version.revision >= result.versions[index - 1]!.revision),
              ) ||
              (result.nextCursor !== null &&
                result.nextCursor !== result.versions.at(-1)?.revision)
            )
              throw new Error("Unexpected resource history context");
            return result;
          },
        },
        { signal },
      ),
    getVersion: (
      teamId: string,
      id: string,
      versionId: string,
      signal?: AbortSignal,
    ) =>
      requestJson(
        `${resource(teamId, id)}/versions/${encodeURIComponent(versionId)}`,
        {
          parse(value: unknown) {
            const { version } = ResourceVersionResponseSchema.parse(value);
            if (
              version.teamId !== teamId ||
              version.resourceId !== id ||
              version.versionId !== versionId
            )
              throw new Error("Unexpected resource version context");
            return version;
          },
        },
        { signal },
      ),
    restore: (
      teamId: string,
      id: string,
      input: RestoreResourceRequest,
      signal?: AbortSignal,
    ) =>
      requestJson(`${resource(teamId, id)}/restore`, response(teamId, id), {
        method: "POST",
        body: JSON.stringify(input),
        signal,
      }),
  };
}
