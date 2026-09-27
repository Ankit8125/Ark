import type { Team } from "@ark/contracts";

export function canEditCatalog(team: Team) {
  return team.role === "admin" || team.role === "developer";
}
