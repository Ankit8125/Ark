-- Agent definitions share the existing team-owned resource/version contract.
-- Existing workspace rows, uniqueness, and immutable version privileges remain.
ALTER TABLE resources DROP CONSTRAINT resources_kind_check;
ALTER TABLE resources ADD CONSTRAINT resources_kind_check
  CHECK (kind IN ('workspace', 'agent'));
