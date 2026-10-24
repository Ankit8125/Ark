ALTER TABLE runners
  ADD COLUMN dispatch_approved boolean NOT NULL DEFAULT false,
  ADD CONSTRAINT runners_dispatch_requires_enrollment
    CHECK (NOT dispatch_approved OR (enrolled_at IS NOT NULL AND revoked_at IS NULL)),
  ADD CONSTRAINT runners_ownership_unique UNIQUE (id, team_id, organization_id);

CREATE TABLE runner_use_grants (
  runner_id uuid NOT NULL,
  team_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  granted boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (runner_id, user_id),
  FOREIGN KEY (runner_id, team_id, organization_id)
    REFERENCES runners(id, team_id, organization_id),
  FOREIGN KEY (team_id, user_id)
    REFERENCES team_memberships(team_id, user_id),
  FOREIGN KEY (organization_id, user_id)
    REFERENCES organization_memberships(organization_id, user_id)
);
