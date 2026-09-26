CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  singleton boolean NOT NULL DEFAULT true UNIQUE CHECK (singleton),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
  password_hash text NOT NULL,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);
CREATE TABLE teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id)
);
CREATE UNIQUE INDEX teams_unique_name ON teams (organization_id, lower(name));
CREATE TABLE team_memberships (
  team_id uuid NOT NULL,
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'developer', 'reviewer', 'viewer')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id),
  FOREIGN KEY (team_id, organization_id) REFERENCES teams(id, organization_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships(organization_id, user_id)
);
CREATE INDEX team_memberships_user ON team_memberships(user_id) WHERE revoked_at IS NULL;
CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, user_id) REFERENCES organization_memberships(organization_id, user_id)
);
CREATE INDEX auth_sessions_user ON auth_sessions(user_id);
CREATE TABLE bootstrap_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  organization_id uuid REFERENCES organizations(id)
);
INSERT INTO bootstrap_state(id) VALUES (1);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id),
  action text NOT NULL,
  target_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Serializing on the organization prevents concurrent removals of two owners
-- from both observing the other as the remaining owner.
CREATE FUNCTION protect_last_owner_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.role = 'owner' AND OLD.revoked_at IS NULL AND
    (TG_OP = 'DELETE' OR NEW.role <> 'owner' OR NEW.revoked_at IS NOT NULL OR
     NEW.user_id <> OLD.user_id OR NEW.organization_id <> OLD.organization_id) THEN
    PERFORM 1 FROM organizations WHERE id = OLD.organization_id FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = OLD.organization_id AND m.user_id <> OLD.user_id
        AND m.role = 'owner' AND m.revoked_at IS NULL AND u.disabled_at IS NULL
    ) THEN
      RAISE EXCEPTION 'ARK_LAST_OWNER' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER last_owner_membership BEFORE UPDATE OR DELETE ON organization_memberships
  FOR EACH ROW EXECUTE FUNCTION protect_last_owner_membership();

CREATE FUNCTION protect_last_owner_user() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE org_id uuid;
BEGIN
  IF OLD.disabled_at IS NULL AND (TG_OP = 'DELETE' OR NEW.disabled_at IS NOT NULL) THEN
    FOR org_id IN SELECT organization_id FROM organization_memberships
      WHERE user_id = OLD.id AND role = 'owner' AND revoked_at IS NULL ORDER BY organization_id
    LOOP
      PERFORM 1 FROM organizations WHERE id = org_id FOR UPDATE;
      IF NOT EXISTS (
        SELECT 1 FROM organization_memberships m JOIN users u ON u.id = m.user_id
        WHERE m.organization_id = org_id AND m.user_id <> OLD.id
          AND m.role = 'owner' AND m.revoked_at IS NULL AND u.disabled_at IS NULL
      ) THEN
        RAISE EXCEPTION 'ARK_LAST_OWNER' USING ERRCODE = 'P0001';
      END IF;
    END LOOP;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER last_owner_user BEFORE UPDATE OR DELETE ON users
  FOR EACH ROW EXECUTE FUNCTION protect_last_owner_user();
