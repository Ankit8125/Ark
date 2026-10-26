ALTER TABLE repository_executions ADD CONSTRAINT repository_executions_preparation_context
  UNIQUE (id,runner_id,team_id,organization_id,workspace_id,workspace_version_id,plan_digest);
ALTER TABLE session_leases ADD CONSTRAINT session_leases_preparation_context
  UNIQUE (id,repository_execution_id,runner_id,team_id,organization_id,workspace_id,generation,runtime);

CREATE TABLE repository_preparation_receipts (
  id uuid PRIMARY KEY,
  execution_id uuid NOT NULL,
  lease_id uuid NOT NULL UNIQUE,
  generation integer NOT NULL CHECK (generation=1),
  runtime text NOT NULL DEFAULT 'repository.v1' CHECK (runtime='repository.v1'),
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  reported_by_runner_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  workspace_version_id uuid NOT NULL,
  plan_digest text NOT NULL CHECK (length(plan_digest)=64 AND plan_digest ~ '^[a-f0-9]{64}$'),
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object' AND NOT (request ? 'leaseToken')),
  report_digest text NOT NULL CHECK (length(report_digest)=64 AND report_digest ~ '^[a-f0-9]{64}$'),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  evidence_status text NOT NULL DEFAULT 'runner_reported_unverified' CHECK (evidence_status='runner_reported_unverified'),
  FOREIGN KEY (execution_id,reported_by_runner_id,team_id,organization_id,workspace_id,workspace_version_id,plan_digest)
    REFERENCES repository_executions(id,runner_id,team_id,organization_id,workspace_id,workspace_version_id,plan_digest),
  FOREIGN KEY (lease_id,execution_id,reported_by_runner_id,team_id,organization_id,workspace_id,generation,runtime)
    REFERENCES session_leases(id,repository_execution_id,runner_id,team_id,organization_id,workspace_id,generation,runtime),
  CHECK (COALESCE(
    request->>'id'=id::text
    AND request->>'executionId'=execution_id::text
    AND request->>'leaseId'=lease_id::text
    AND request->'generation'='1'::jsonb
    AND request->>'planDigest'=plan_digest,
    false
  ))
);
CREATE INDEX repository_preparation_receipts_execution ON repository_preparation_receipts(execution_id);

CREATE FUNCTION preserve_repository_preparation_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ARK_IMMUTABLE_PREPARATION_RECEIPT';
END $$;
CREATE TRIGGER repository_preparation_receipt_immutable BEFORE UPDATE OR DELETE ON repository_preparation_receipts
  FOR EACH ROW EXECUTE FUNCTION preserve_repository_preparation_receipt();
