import type { Team } from "@ark/contracts";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import type { DraftStatus } from "../catalog/useVersionedEditor";
import { AgentEditor } from "./AgentEditor";
import { AgentList } from "./AgentList";

type Props = {
  team: Team;
  onExpired: () => void;
  onDraftStatus: (status: DraftStatus) => void;
};
function SavedAgent(props: Props) {
  const { agentId } = useParams();
  return (
    <AgentEditor
      key={`${props.team.id}:${agentId}`}
      {...props}
      agentId={agentId}
    />
  );
}
export function AgentRoutes(props: Props) {
  return (
    <Routes>
      <Route
        index
        element={
          <AgentList
            key={props.team.id}
            team={props.team}
            onExpired={props.onExpired}
          />
        }
      />
      <Route
        path="new"
        element={<AgentEditor key={`${props.team.id}:new`} {...props} />}
      />
      <Route path=":agentId" element={<SavedAgent {...props} />} />
      <Route path="*" element={<Navigate to="/agents" replace />} />
    </Routes>
  );
}
