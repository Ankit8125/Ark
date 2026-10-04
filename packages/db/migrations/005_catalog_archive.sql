-- Resource lifecycle is independent from immutable definition revisions.
ALTER TABLE resources
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN lifecycle_revision integer NOT NULL DEFAULT 1
    CHECK (lifecycle_revision > 0);

CREATE INDEX resources_team_archive_list
  ON resources (team_id, kind, (archived_at IS NOT NULL), id);
