import type { Team } from "@ark/contracts";
import { FolderGit2 } from "lucide-react";
import { CatalogList } from "../catalog/CatalogList";
import { workspaceApi } from "./api";

async function loadPage(teamId: string, cursor?: string, signal?: AbortSignal) {
  const result = await workspaceApi.list(teamId, cursor, signal);
  return { items: result.workspaces, nextCursor: result.nextCursor };
}

export function WorkspaceList(props: { team: Team; onExpired: () => void }) {
  return (
    <CatalogList
      {...props}
      kind="workspace"
      plural="workspaces"
      title="Workspaces"
      description="Repository, environment, and actions for your team’s work."
      createDescription="Create a workspace to save the repository and commands your team will use."
      icon={FolderGit2}
      loadPage={loadPage}
    />
  );
}
