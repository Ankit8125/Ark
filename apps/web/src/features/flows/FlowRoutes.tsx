import type { Team } from "@ark/contracts";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import type { DraftStatus } from "../catalog/useVersionedEditor";
import { FlowEditor } from "./FlowEditor";
import { FlowList } from "./FlowList";

type Props = {
  team: Team;
  onExpired: () => void;
  onDraftStatus: (status: DraftStatus) => void;
};
function SavedFlow(props: Props) {
  const { flowId } = useParams();
  return (
    <FlowEditor key={`${props.team.id}:${flowId}`} {...props} flowId={flowId} />
  );
}
export function FlowRoutes(props: Props) {
  return (
    <Routes>
      <Route
        index
        element={
          <FlowList
            key={props.team.id}
            team={props.team}
            onExpired={props.onExpired}
          />
        }
      />
      <Route
        path="new"
        element={<FlowEditor key={`${props.team.id}:new`} {...props} />}
      />
      <Route path=":flowId" element={<SavedFlow {...props} />} />
      <Route path="*" element={<Navigate to="/flows" replace />} />
    </Routes>
  );
}
