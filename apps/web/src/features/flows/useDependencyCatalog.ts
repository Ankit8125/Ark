import type { AgentSummary, WorkspaceSummary } from "@ark/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import { agentApi } from "../agents/api";
import { workspaceApi } from "../workspaces/api";

export type DependencySummary = AgentSummary | WorkspaceSummary;
type Page = { items: DependencySummary[]; nextCursor: string | null };
async function load(
  kind: "workspace" | "agent",
  teamId: string,
  cursor: string | undefined,
  signal: AbortSignal,
): Promise<Page> {
  if (kind === "workspace") {
    const page = await workspaceApi.list(teamId, cursor, signal);
    return { items: page.workspaces, nextCursor: page.nextCursor };
  }
  const page = await agentApi.list(teamId, cursor, signal);
  return { items: page.agents, nextCursor: page.nextCursor };
}

export function useDependencyCatalog(
  kind: "workspace" | "agent",
  teamId: string,
  onExpired: () => void,
) {
  const [page, setPage] = useState<Page>({ items: [], nextCursor: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const loadingMore = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void load(kind, teamId, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiRequestError && reason.status === 401)
          onExpired();
        else setError(errorMessage(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [kind, teamId, attempt, onExpired]);

  async function more() {
    if (!page.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError("");
    try {
      const result = await load(
        kind,
        teamId,
        page.nextCursor,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setPage((current) => ({
          items: [
            ...new Map(
              [...current.items, ...result.items].map((item) => [
                item.id,
                item,
              ]),
            ).values(),
          ],
          nextCursor: result.nextCursor,
        }));
    } catch (reason) {
      if (controller.signal.aborted) return;
      if (reason instanceof ApiRequestError && reason.status === 401)
        onExpired();
      else setError(errorMessage(reason));
    } finally {
      loadingMore.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function retry() {
    setError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  }
  return { ...page, loading, error, more, retry };
}
export type DependencyCatalog = ReturnType<typeof useDependencyCatalog>;
