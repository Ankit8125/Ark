-- Ordered flows keep their complete definition and pinned dependency identities
-- in the same immutable snapshot contract as workspaces and agents.
ALTER TABLE resources DROP CONSTRAINT resources_kind_check;
ALTER TABLE resources ADD CONSTRAINT resources_kind_check
  CHECK (kind IN ('workspace', 'agent', 'flow'));
