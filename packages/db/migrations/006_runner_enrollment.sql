CREATE TABLE runners (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL,
  team_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  issued_by uuid NOT NULL,
  enrollment_token_hash text NOT NULL UNIQUE CHECK (enrollment_token_hash ~ '^[a-f0-9]{64}$'),
  enrollment_expires_at timestamptz NOT NULL,
  credential_hash text UNIQUE CHECK (credential_hash ~ '^[a-f0-9]{64}$'),
  enrolled_at timestamptz,
  last_heartbeat_at timestamptz,
  revoked_at timestamptz,
  lifecycle_revision integer NOT NULL DEFAULT 1 CHECK (lifecycle_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams(id, organization_id),
  FOREIGN KEY (team_id, issued_by) REFERENCES team_memberships(team_id, user_id),
  FOREIGN KEY (organization_id, issued_by) REFERENCES organization_memberships(organization_id, user_id),
  CHECK ((credential_hash IS NULL) = (enrolled_at IS NULL)),
  CHECK (last_heartbeat_at IS NULL OR enrolled_at IS NOT NULL),
  CHECK (enrollment_expires_at > created_at)
);
CREATE INDEX runners_team_list ON runners (organization_id, team_id, id);
