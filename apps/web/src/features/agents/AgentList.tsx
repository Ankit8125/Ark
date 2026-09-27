import type { Team } from "@ark/contracts";
import { Bot } from "lucide-react";
import { CatalogList } from "../catalog/CatalogList";
import { agentApi } from "./api";

async function loadPage(teamId: string, cursor?: string, signal?: AbortSignal) {
  const result = await agentApi.list(teamId, cursor, signal);
  return { items: result.agents, nextCursor: result.nextCursor };
}
export function AgentList(props: { team: Team; onExpired: () => void }) {
  return (
    <CatalogList
      {...props}
      kind="agent"
      plural="agents"
      title="Agents"
      description="Instructions and preferences for your team’s future agent runs."
      createDescription="Create an agent to save its instructions and requested capabilities."
      icon={Bot}
      loadPage={loadPage}
    />
  );
}
