ALTER TABLE resource_versions ADD CONSTRAINT resource_versions_identity_pair UNIQUE (resource_id,id);

CREATE TABLE execution_sessions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  started_by uuid NOT NULL,
  runner_id uuid NOT NULL,
  flow_resource_id uuid NOT NULL,
  flow_version_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES resources(id),
  flow_name text NOT NULL CHECK (length(btrim(flow_name)) BETWEEN 1 AND 80),
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object'),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot)='object'),
  input_values jsonb NOT NULL CHECK (jsonb_typeof(input_values)='object'),
  state text NOT NULL CHECK (state IN ('queued','running','blocked','cancelling','cancelled','failed','completed')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  stage_index integer NOT NULL DEFAULT 0 CHECK (stage_index BETWEEN 0 AND 20),
  stage_results jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(stage_results)='object'),
  outputs jsonb CHECK (jsonb_typeof(outputs)='object'),
  block_reason text CHECK (block_reason IN ('lease_expired','permission_changed','runner_stopped','recovery_required')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (team_id,organization_id) REFERENCES teams(id,organization_id),
  FOREIGN KEY (team_id,started_by) REFERENCES team_memberships(team_id,user_id),
  FOREIGN KEY (organization_id,started_by) REFERENCES organization_memberships(organization_id,user_id),
  FOREIGN KEY (runner_id,team_id,organization_id) REFERENCES runners(id,team_id,organization_id),
  FOREIGN KEY (flow_resource_id,flow_version_id) REFERENCES resource_versions(resource_id,id),
  UNIQUE (id,runner_id,team_id,organization_id,workspace_id),
  CHECK ((state='completed')=(outputs IS NOT NULL))
);
CREATE INDEX execution_sessions_team_list ON execution_sessions(organization_id,team_id,id);
CREATE INDEX execution_sessions_queue ON execution_sessions(runner_id,created_at,id) WHERE state='queued';

CREATE FUNCTION preserve_session_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.id,NEW.organization_id,NEW.team_id,NEW.started_by,NEW.runner_id,NEW.flow_resource_id,NEW.flow_version_id,NEW.workspace_id,NEW.flow_name,NEW.request,NEW.snapshot,NEW.input_values,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.team_id,OLD.started_by,OLD.runner_id,OLD.flow_resource_id,OLD.flow_version_id,OLD.workspace_id,OLD.flow_name,OLD.request,OLD.snapshot,OLD.input_values,OLD.created_at) THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_SESSION_SNAPSHOT';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER execution_session_snapshot BEFORE UPDATE ON execution_sessions
  FOR EACH ROW EXECUTE FUNCTION preserve_session_snapshot();

CREATE TABLE session_leases (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL UNIQUE,
  runner_id uuid NOT NULL,
  team_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  generation integer NOT NULL DEFAULT 1 CHECK (generation=1),
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('active','uncertain','released')),
  FOREIGN KEY (session_id,runner_id,team_id,organization_id,workspace_id)
    REFERENCES execution_sessions(id,runner_id,team_id,organization_id,workspace_id)
);
CREATE UNIQUE INDEX session_leases_exclusive_runner ON session_leases(runner_id) WHERE status IN ('active','uncertain');
CREATE INDEX session_leases_expiry ON session_leases(expires_at) WHERE status='active';

CREATE TABLE execution_events (
  session_id uuid NOT NULL REFERENCES execution_sessions(id),
  sequence integer NOT NULL CHECK (sequence>0),
  id uuid NOT NULL,
  lease_id uuid REFERENCES session_leases(id),
  kind text NOT NULL CHECK (kind IN ('created','claimed','stage_completed','cancelling','lease_uncertain','cancelled','failed','completed','recovery_recorded')),
  state text NOT NULL CHECK (state IN ('queued','running','blocked','cancelling','cancelled','failed','completed')),
  stage_index integer NOT NULL CHECK (stage_index BETWEEN 0 AND 20),
  receipt jsonb CHECK (jsonb_typeof(receipt)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (session_id,sequence),
  UNIQUE (session_id,id)
);
