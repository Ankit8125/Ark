ALTER TABLE resources ADD CONSTRAINT resources_identity_scope_kind
  UNIQUE (id,team_id,organization_id,kind);

CREATE TABLE repository_plans (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  created_by uuid NOT NULL,
  workspace_resource_id uuid NOT NULL,
  workspace_version_id uuid NOT NULL,
  workspace_kind text NOT NULL DEFAULT 'workspace' CHECK (workspace_kind='workspace'),
  workspace_name text NOT NULL CHECK (workspace_name=btrim(workspace_name) AND length(workspace_name) BETWEEN 1 AND 80),
  request jsonb NOT NULL CHECK (jsonb_typeof(request)='object'),
  plan jsonb NOT NULL CHECK (jsonb_typeof(plan)='object'),
  plan_digest text NOT NULL CHECK (length(plan_digest)=64 AND plan_digest ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (team_id,organization_id) REFERENCES teams(id,organization_id),
  FOREIGN KEY (team_id,created_by) REFERENCES team_memberships(team_id,user_id),
  FOREIGN KEY (organization_id,created_by) REFERENCES organization_memberships(organization_id,user_id),
  FOREIGN KEY (workspace_resource_id,team_id,organization_id,workspace_kind)
    REFERENCES resources(id,team_id,organization_id,kind),
  FOREIGN KEY (workspace_resource_id,workspace_version_id)
    REFERENCES resource_versions(resource_id,id),
  CHECK (COALESCE(
    plan->'version'='1'::jsonb
    AND plan->>'runtime'='repository.v1'
    AND plan->>'status'='planned_unverified'
    AND plan#>>'{workspace,resourceId}'=workspace_resource_id::text
    AND plan#>>'{workspace,versionId}'=workspace_version_id::text,
    false
  )),
  CHECK (COALESCE(
    request->>'id'=id::text
    AND request#>>'{workspace,resourceId}'=workspace_resource_id::text
    AND request#>>'{workspace,versionId}'=workspace_version_id::text,
    false
  ))
);
CREATE INDEX repository_plans_team_list ON repository_plans(organization_id,team_id,id);

CREATE FUNCTION preserve_repository_plan() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'ARK_IMMUTABLE_REPOSITORY_PLAN';
END $$;
CREATE TRIGGER repository_plan_immutable BEFORE UPDATE OR DELETE ON repository_plans
  FOR EACH ROW EXECUTE FUNCTION preserve_repository_plan();
