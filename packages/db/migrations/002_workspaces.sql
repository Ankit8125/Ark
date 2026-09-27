CREATE TABLE resources (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id),
  team_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind = 'workspace'),
  name text NOT NULL CHECK (name = btrim(name) AND length(name) BETWEEN 1 AND 80),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams(id, organization_id)
);
CREATE UNIQUE INDEX resources_unique_name ON resources (team_id, kind, lower(name));
CREATE INDEX resources_team_list ON resources (team_id, kind, id);

CREATE TABLE resource_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES resources(id),
  revision integer NOT NULL CHECK (revision > 0),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  created_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, revision)
);

-- The current revision must always resolve to a complete immutable snapshot.
-- Deferring this check lets creation insert the resource and its first version
-- within one transaction without allowing a dangling reference at commit.
ALTER TABLE resources ADD CONSTRAINT resources_current_version
  FOREIGN KEY (id, revision) REFERENCES resource_versions(resource_id, revision)
  DEFERRABLE INITIALLY DEFERRED;
