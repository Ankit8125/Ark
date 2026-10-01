import type { Team } from "@ark/contracts";
import { GitBranch } from "lucide-react";
import { CatalogList } from "../catalog/CatalogList";
import { flowApi } from "./api";

async function loadPage(teamId: string, cursor?: string, signal?: AbortSignal) {
  const result = await flowApi.list(teamId, cursor, signal);
  return { items: result.flows, nextCursor: result.nextCursor };
}
export function FlowList(props: { team: Team; onExpired: () => void }) {
  return (
    <CatalogList
      {...props}
      kind="flow"
      plural="flows"
      title="Flows"
      description="Ordered stages with pinned workspace and agent versions."
      createDescription="Create a flow to connect inputs, stages, and outputs. Execution comes later."
      icon={GitBranch}
      loadPage={loadPage}
    />
  );
}
