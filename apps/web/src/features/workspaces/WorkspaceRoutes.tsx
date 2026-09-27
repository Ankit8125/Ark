import type { Team } from "@ark/contracts";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { WorkspaceEditor, type DraftStatus } from "./WorkspaceEditor";
import { WorkspaceList } from "./WorkspaceList";

type Props = {
  team: Team;
  onExpired: () => void;
  onDraftStatus: (status: DraftStatus) => void;
};

function SavedWorkspace(props: Props) {
  const { workspaceId } = useParams();
  return (
    <WorkspaceEditor
      key={`${props.team.id}:${workspaceId}`}
      {...props}
      workspaceId={workspaceId}
    />
  );
}

export function WorkspaceRoutes(props: Props) {
  return (
    <Routes>
      <Route
        index
        element={
          <WorkspaceList
            key={props.team.id}
            team={props.team}
            onExpired={props.onExpired}
          />
        }
      />
      <Route
        path="new"
        element={<WorkspaceEditor key={`${props.team.id}:new`} {...props} />}
      />
      <Route path=":workspaceId" element={<SavedWorkspace {...props} />} />
      <Route path="*" element={<Navigate to="/workspaces" replace />} />
    </Routes>
  );
}
