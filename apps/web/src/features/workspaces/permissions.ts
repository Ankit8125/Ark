import type { Team } from "@ark/contracts";

export function canEditWorkspaces(team: Team) {
  return team.role === "admin" || team.role === "developer";
}
