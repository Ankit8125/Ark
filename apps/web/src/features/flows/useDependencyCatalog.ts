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
  const [attempt, setAttempt] = useState(0);
  const key = `${kind}:${teamId}:${attempt}`;
  const [result, setResult] = useState<
    (Page & { key: string; error: string; loadingMore: boolean }) | null
  >(null);
  const request = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const page = result?.key === key ? result : null;
  const loading = page === null || page.loadingMore;
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    inFlight.current = true;
    void load(kind, teamId, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted)
          setResult({ ...value, key, error: "", loadingMore: false });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        const expired =
          reason instanceof ApiRequestError && reason.status === 401;
        if (expired) onExpired();
        setResult({
          key,
          items: [],
          nextCursor: null,
          error: expired ? "" : errorMessage(reason),
          loadingMore: false,
        });
      })
      .finally(() => {
        if (request.current === controller) inFlight.current = false;
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [kind, teamId, key, attempt, onExpired]);

  async function more() {
    if (!page?.nextCursor || loading || inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    request.current = controller;
    setResult({ ...page, error: "", loadingMore: true });
    try {
      const value = await load(
        kind,
        teamId,
        page.nextCursor,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setResult((current) =>
          current?.key === key
            ? {
                key,
                items: [
                  ...new Map(
                    [...current.items, ...value.items].map((item) => [
                      item.id,
                      item,
                    ]),
                  ).values(),
                ],
                nextCursor: value.nextCursor,
                error: "",
                loadingMore: false,
              }
            : current,
        );
    } catch (reason) {
      if (controller.signal.aborted) return;
      const expired =
        reason instanceof ApiRequestError && reason.status === 401;
      if (expired) onExpired();
      setResult((current) =>
        current?.key === key
          ? {
              ...current,
              error: expired ? "" : errorMessage(reason),
              loadingMore: false,
            }
          : current,
      );
    } finally {
      if (request.current === controller) inFlight.current = false;
    }
  }
  function retry() {
    setAttempt((value) => value + 1);
  }
  return {
    items: page?.items ?? [],
    nextCursor: page?.nextCursor ?? null,
    loading,
    error: page?.error ?? "",
    more,
    retry,
  };
}
export type DependencyCatalog = ReturnType<typeof useDependencyCatalog>;
