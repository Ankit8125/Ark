ALTER TABLE repository_plans ADD CONSTRAINT repository_plans_execution_context
  UNIQUE (id,team_id,organization_id,workspace_resource_id,workspace_version_id,plan_digest);

CREATE TABLE repository_executions (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  started_by uuid NOT NULL,
  runner_id uuid NOT NULL,
  repository_plan_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (length(plan_digest)=64 AND plan_digest ~ '^[a-f0-9]{64}$'),
  workspace_id uuid NOT NULL,
  workspace_version_id uuid NOT NULL,
  workspace_name text NOT NULL CHECK (workspace_name=btrim(workspace_name) AND length(workspace_name) BETWEEN 1 AND 80),
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object'),
  state text NOT NULL CHECK (state IN ('queued','running','blocked','cancelling','cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  block_reason text CHECK (block_reason IN ('lease_expired','permission_changed','preparation_deadline','run_deadline')),
  claimed_at timestamptz,
  run_deadline_at timestamptz,
  preparation_deadline_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (team_id,organization_id) REFERENCES teams(id,organization_id),
  FOREIGN KEY (team_id,started_by) REFERENCES team_memberships(team_id,user_id),
  FOREIGN KEY (organization_id,started_by) REFERENCES organization_memberships(organization_id,user_id),
  FOREIGN KEY (runner_id,team_id,organization_id) REFERENCES runners(id,team_id,organization_id),
  FOREIGN KEY (repository_plan_id,team_id,organization_id,workspace_id,workspace_version_id,plan_digest)
    REFERENCES repository_plans(id,team_id,organization_id,workspace_resource_id,workspace_version_id,plan_digest),
  UNIQUE (id,runner_id,team_id,organization_id,workspace_id),
  CHECK (COALESCE(
    request->>'id'=id::text
    AND request->>'runnerId'=runner_id::text
    AND request->>'repositoryPlanId'=repository_plan_id::text
    AND request->>'expectedPlanDigest'=plan_digest,
    false
  )),
  CHECK (state<>'blocked' OR block_reason IS NOT NULL),
  CHECK (state IN ('blocked','cancelling') OR block_reason IS NULL),
  CHECK (
    (state IN ('queued','cancelled') AND claimed_at IS NULL AND run_deadline_at IS NULL AND preparation_deadline_at IS NULL)
    OR (state IN ('running','blocked','cancelling') AND claimed_at IS NOT NULL AND run_deadline_at IS NOT NULL AND preparation_deadline_at IS NOT NULL)
  ),
  CHECK (claimed_at IS NULL OR (
    run_deadline_at=claimed_at+interval '900 seconds'
    AND preparation_deadline_at=LEAST(claimed_at+interval '120 seconds',run_deadline_at-interval '30 seconds')
  ))
);
CREATE INDEX repository_executions_team_list ON repository_executions(organization_id,team_id,id);
CREATE INDEX repository_executions_queue ON repository_executions(runner_id,created_at,id) WHERE state='queued';

CREATE FUNCTION preserve_repository_execution_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_REPOSITORY_EXECUTION_ADMISSION';
  END IF;
  IF (NEW.id,NEW.organization_id,NEW.team_id,NEW.started_by,NEW.runner_id,NEW.repository_plan_id,NEW.plan_digest,NEW.workspace_id,NEW.workspace_version_id,NEW.workspace_name,NEW.request,NEW.created_at)
    IS DISTINCT FROM (OLD.id,OLD.organization_id,OLD.team_id,OLD.started_by,OLD.runner_id,OLD.repository_plan_id,OLD.plan_digest,OLD.workspace_id,OLD.workspace_version_id,OLD.workspace_name,OLD.request,OLD.created_at) THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_REPOSITORY_EXECUTION_ADMISSION';
  END IF;
  IF OLD.claimed_at IS NOT NULL AND (NEW.claimed_at,NEW.run_deadline_at,NEW.preparation_deadline_at)
    IS DISTINCT FROM (OLD.claimed_at,OLD.run_deadline_at,OLD.preparation_deadline_at) THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_REPOSITORY_EXECUTION_CLOCKS';
  END IF;
  IF (OLD.state='cancelled' AND NEW.state<>'cancelled')
    OR (OLD.state IN ('blocked','cancelling') AND NEW.state IN ('queued','running')) THEN
    RAISE EXCEPTION 'ARK_REPOSITORY_EXECUTION_CANNOT_RESTART';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER repository_execution_admission_immutable BEFORE UPDATE OR DELETE ON repository_executions
  FOR EACH ROW EXECUTE FUNCTION preserve_repository_execution_admission();

ALTER TABLE session_leases
  ALTER COLUMN session_id DROP NOT NULL,
  ADD COLUMN runtime text NOT NULL DEFAULT 'stub.v1' CHECK (runtime IN ('stub.v1','repository.v1')),
  ADD COLUMN repository_execution_id uuid UNIQUE,
  ADD COLUMN control_sequence integer NOT NULL DEFAULT 0 CHECK (control_sequence>=0),
  ADD CONSTRAINT session_leases_runtime_owner CHECK (
    (runtime='stub.v1' AND session_id IS NOT NULL AND repository_execution_id IS NULL AND control_sequence=0)
    OR (runtime='repository.v1' AND session_id IS NULL AND repository_execution_id IS NOT NULL)
  ),
  ADD CONSTRAINT session_leases_repository_owner
    FOREIGN KEY (repository_execution_id,runner_id,team_id,organization_id,workspace_id)
    REFERENCES repository_executions(id,runner_id,team_id,organization_id,workspace_id),
  ADD CONSTRAINT session_leases_repository_receipt_context UNIQUE (id,repository_execution_id);

CREATE FUNCTION preserve_work_lease_context() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_WORK_LEASE_CONTEXT';
  END IF;
  IF (NEW.id,NEW.runtime,NEW.session_id,NEW.repository_execution_id,NEW.runner_id,NEW.team_id,NEW.organization_id,NEW.workspace_id,NEW.generation,NEW.token_hash)
    IS DISTINCT FROM (OLD.id,OLD.runtime,OLD.session_id,OLD.repository_execution_id,OLD.runner_id,OLD.team_id,OLD.organization_id,OLD.workspace_id,OLD.generation,OLD.token_hash) THEN
    RAISE EXCEPTION 'ARK_IMMUTABLE_WORK_LEASE_CONTEXT';
  END IF;
  IF NEW.control_sequence<OLD.control_sequence THEN
    RAISE EXCEPTION 'ARK_WORK_CONTROL_SEQUENCE_CANNOT_REVERSE';
  END IF;
  IF (OLD.status='uncertain' AND NEW.status='active')
    OR (OLD.status='released' AND NEW.status<>'released') THEN
    RAISE EXCEPTION 'ARK_WORK_LEASE_CANNOT_REACTIVATE';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER work_lease_context_immutable BEFORE UPDATE OR DELETE ON session_leases
  FOR EACH ROW EXECUTE FUNCTION preserve_work_lease_context();

-- Keep session_leases_exclusive_runner unchanged: both runtimes share capacity.
DROP INDEX session_leases_expiry;
CREATE INDEX session_leases_expiry ON session_leases(runtime,expires_at,id) WHERE status='active';

CREATE TABLE repository_execution_events (
  execution_id uuid NOT NULL REFERENCES repository_executions(id),
  sequence integer NOT NULL CHECK (sequence>0),
  id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('created','claimed','cancel_requested','lease_uncertain')),
  state text NOT NULL CHECK (state IN ('queued','running','blocked','cancelling','cancelled')),
  block_reason text CHECK (block_reason IN ('lease_expired','permission_changed','preparation_deadline','run_deadline')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (execution_id,sequence),
  UNIQUE (execution_id,id)
);

CREATE TABLE repository_control_receipts (
  lease_id uuid NOT NULL,
  execution_id uuid NOT NULL,
  id uuid NOT NULL,
  sequence integer NOT NULL CHECK (sequence>0),
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object' AND NOT (request ? 'leaseToken')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (lease_id,id),
  UNIQUE (lease_id,sequence),
  FOREIGN KEY (lease_id,execution_id) REFERENCES session_leases(id,repository_execution_id)
);

CREATE FUNCTION preserve_repository_execution_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ARK_IMMUTABLE_REPOSITORY_EXECUTION_RECORD';
END $$;
CREATE TRIGGER repository_execution_event_immutable BEFORE UPDATE OR DELETE ON repository_execution_events
  FOR EACH ROW EXECUTE FUNCTION preserve_repository_execution_record();
CREATE TRIGGER repository_control_receipt_immutable BEFORE UPDATE OR DELETE ON repository_control_receipts
  FOR EACH ROW EXECUTE FUNCTION preserve_repository_execution_record();
