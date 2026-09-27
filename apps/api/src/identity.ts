import { randomUUID } from "node:crypto";
import { MeResponseSchema, TeamSchema } from "@ark/contracts";
import type {
  BootstrapRequest,
  LoginRequest,
  MeResponse,
} from "@ark/contracts";
import { expectedMigrationVersion, withTransaction } from "@ark/db";
import type { Pool, PoolClient } from "pg";
import { ApiFailure } from "./errors.js";
import {
  hashPassword,
  newSessionToken,
  sessionTokenHash,
  verifyPassword,
} from "./credentials.js";

interface IdentityRow {
  user_id: string;
  display_name: string;
  email: string;
  organization_id: string;
  organization_name: string;
  organization_role: MeResponse["organization"]["role"];
}

interface SessionIdentityRow extends IdentityRow {
  session_id: string;
}

interface TeamRow {
  id: string;
  name: string;
  role: MeResponse["teams"][number]["role"];
}

interface PasswordRow {
  id: string;
  password_hash: string;
}

export interface SignedInSession {
  token: string;
  expiresAt: Date;
  me: MeResponse;
}

export interface TeamAccess {
  userId: string;
  organizationId: string;
  team: TeamRow;
}

const identityColumns = `
  u.id AS user_id, u.display_name, u.email,
  o.id AS organization_id, o.name AS organization_name,
  om.role AS organization_role`;

function unauthenticated(): ApiFailure {
  return new ApiFailure(401, "UNAUTHENTICATED", "Sign in to continue.");
}

function invalidLogin(): ApiFailure {
  return new ApiFailure(
    401,
    "INVALID_CREDENTIALS",
    "Email or password is incorrect.",
  );
}

function setupComplete(): ApiFailure {
  return new ApiFailure(
    409,
    "SETUP_COMPLETE",
    "This installation has already been set up.",
  );
}

export class IdentityService {
  readonly pool: Pool;
  readonly sessionTtlSeconds: number;

  constructor(pool: Pool, sessionTtlSeconds: number) {
    this.pool = pool;
    this.sessionTtlSeconds = sessionTtlSeconds;
  }

  async isReady(): Promise<boolean> {
    const result = await this.pool.query<{ version: string }>(
      "SELECT version FROM schema_migrations WHERE version = $1",
      [expectedMigrationVersion],
    );
    return result.rowCount === 1;
  }

  async setupRequired(): Promise<boolean> {
    const result = await this.pool.query<{ organization_id: string | null }>(
      "SELECT organization_id FROM bootstrap_state WHERE id = 1",
    );
    const state = result.rows[0];
    if (!state)
      throw new ApiFailure(503, "NOT_READY", "The installation is not ready.");
    return state.organization_id === null;
  }

  async bootstrap(input: BootstrapRequest): Promise<SignedInSession> {
    // Avoid expensive password work once setup has closed. The row lock below
    // is still required: two first requests can both observe required=true.
    if (!(await this.setupRequired())) throw setupComplete();
    const passwordHash = await hashPassword(input.password);

    return withTransaction(this.pool, async (client) => {
      const locked = await client.query<{ organization_id: string | null }>(
        "SELECT organization_id FROM bootstrap_state WHERE id = 1 FOR UPDATE",
      );
      const state = locked.rows[0];
      if (!state)
        throw new ApiFailure(
          503,
          "NOT_READY",
          "The installation is not ready.",
        );
      if (state.organization_id !== null) throw setupComplete();

      const organizationId = randomUUID();
      const userId = randomUUID();
      const teamId = randomUUID();
      await client.query(
        "INSERT INTO organizations (id, name) VALUES ($1, $2)",
        [organizationId, input.organizationName],
      );
      await client.query(
        "INSERT INTO users (id, email, display_name, password_hash) VALUES ($1, $2, $3, $4)",
        [userId, input.email, input.ownerName, passwordHash],
      );
      await client.query(
        "INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')",
        [organizationId, userId],
      );
      await client.query(
        "INSERT INTO teams (id, organization_id, name) VALUES ($1, $2, $3)",
        [teamId, organizationId, input.teamName],
      );
      await client.query(
        "INSERT INTO team_memberships (team_id, user_id, organization_id, role) VALUES ($1, $2, $3, 'admin')",
        [teamId, userId, organizationId],
      );
      await client.query(
        "UPDATE bootstrap_state SET organization_id = $1 WHERE id = 1",
        [organizationId],
      );
      await client.query(
        "INSERT INTO audit_events (organization_id, actor_user_id, action, target_id) VALUES ($1, $2, 'installation.bootstrap', $1)",
        [organizationId, userId],
      );

      const identity: IdentityRow = {
        user_id: userId,
        display_name: input.ownerName,
        email: input.email,
        organization_id: organizationId,
        organization_name: input.organizationName,
        organization_role: "owner",
      };
      return this.createSession(client, identity, undefined);
    });
  }

  async login(
    input: LoginRequest,
    previousToken: string | undefined,
  ): Promise<SignedInSession> {
    const result = await this.pool.query<PasswordRow>(
      `SELECT u.id, u.password_hash
       FROM users u
       JOIN organization_memberships om ON om.user_id = u.id AND om.revoked_at IS NULL
       WHERE u.email = $1 AND u.disabled_at IS NULL`,
      [input.email],
    );
    const candidate = result.rows[0];
    if (
      !(await verifyPassword(input.password, candidate?.password_hash)) ||
      !candidate
    )
      throw invalidLogin();

    return withTransaction(this.pool, async (client) => {
      // Recheck after password work; revocation or a password change must not
      // mint a session using the earlier authentication snapshot.
      const current = await client.query<IdentityRow>(
        `SELECT ${identityColumns}
         FROM users u
         JOIN organization_memberships om ON om.user_id = u.id
         JOIN organizations o ON o.id = om.organization_id
         WHERE u.id = $1 AND u.password_hash = $2
           AND u.disabled_at IS NULL AND om.revoked_at IS NULL
         FOR SHARE OF u, om`,
        [candidate.id, candidate.password_hash],
      );
      const identity = current.rows[0];
      if (!identity) throw invalidLogin();
      return this.createSession(client, identity, previousToken);
    });
  }

  private async createSession(
    client: PoolClient,
    identity: IdentityRow,
    previousToken: string | undefined,
  ): Promise<SignedInSession> {
    const oldHash = sessionTokenHash(previousToken);
    if (oldHash) {
      await client.query(
        "UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
        [oldHash],
      );
    }
    const token = newSessionToken();
    const sessionId = randomUUID();
    const result = await client.query<{ expires_at: Date }>(
      `INSERT INTO auth_sessions (id, user_id, organization_id, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, now() + ($5 * interval '1 second'))
       RETURNING expires_at`,
      [
        sessionId,
        identity.user_id,
        identity.organization_id,
        sessionTokenHash(token),
        this.sessionTtlSeconds,
      ],
    );
    const session = result.rows[0];
    if (!session) throw new Error("Session was not created.");
    await client.query(
      "INSERT INTO audit_events (organization_id, actor_user_id, action, target_id) VALUES ($1, $2, 'auth.login', $3)",
      [identity.organization_id, identity.user_id, sessionId],
    );
    return {
      token,
      expiresAt: session.expires_at,
      me: await this.meForIdentity(client, identity),
    };
  }

  private async authenticate(
    token: string | undefined,
    client: Pool | PoolClient = this.pool,
    lock = false,
  ): Promise<SessionIdentityRow> {
    const tokenHash = sessionTokenHash(token);
    if (!tokenHash) throw unauthenticated();
    const result = await client.query<SessionIdentityRow>(
      `SELECT s.id AS session_id, ${identityColumns}
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       JOIN organization_memberships om ON om.user_id = s.user_id AND om.organization_id = s.organization_id
       JOIN organizations o ON o.id = s.organization_id
       WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.disabled_at IS NULL AND om.revoked_at IS NULL
       ${lock ? "FOR SHARE OF s, u, om" : ""}`,
      [tokenHash],
    );
    const identity = result.rows[0];
    if (!identity) throw unauthenticated();
    return identity;
  }

  private async meForIdentity(
    client: Pool | PoolClient,
    identity: IdentityRow,
  ): Promise<MeResponse> {
    const teams = await client.query<TeamRow>(
      `SELECT t.id, t.name, tm.role
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id AND tm.organization_id = t.organization_id
       WHERE tm.user_id = $1 AND t.organization_id = $2 AND tm.revoked_at IS NULL
       ORDER BY t.name, t.id`,
      [identity.user_id, identity.organization_id],
    );
    return MeResponseSchema.parse({
      user: {
        id: identity.user_id,
        name: identity.display_name,
        email: identity.email,
      },
      organization: {
        id: identity.organization_id,
        name: identity.organization_name,
        role: identity.organization_role,
      },
      teams: teams.rows,
    });
  }

  async me(token: string | undefined): Promise<MeResponse> {
    const identity = await this.authenticate(token);
    return this.meForIdentity(this.pool, identity);
  }

  async team(
    token: string | undefined,
    teamId: string,
  ): Promise<{ team: TeamRow }> {
    const access = await this.authorizeTeam(token, teamId);
    return { team: access.team };
  }

  async authorizeTeam(
    token: string | undefined,
    teamId: string,
    mutation?: { client: PoolClient },
  ): Promise<TeamAccess> {
    const client = mutation?.client ?? this.pool;
    // Mutation callers hold these locks until their transaction commits. A
    // logout, disabled user, or membership revocation cannot slip between this
    // authorization decision and the resource write.
    const identity = await this.authenticate(token, client, !!mutation);
    const result = await client.query<TeamRow>(
      `SELECT t.id, t.name, tm.role
       FROM teams t
       JOIN team_memberships tm ON tm.team_id = t.id AND tm.organization_id = t.organization_id
       WHERE t.id = $1 AND tm.user_id = $2 AND t.organization_id = $3 AND tm.revoked_at IS NULL
       ${mutation ? "FOR SHARE OF t, tm" : ""}`,
      [teamId, identity.user_id, identity.organization_id],
    );
    const team = result.rows[0];
    // Same answer for nonexistent, unshared, and revoked teams, including an
    // organization owner without explicit team membership.
    if (!team)
      throw new ApiFailure(
        404,
        "NOT_FOUND",
        "The requested team was not found.",
      );
    if (mutation && team.role !== "admin" && team.role !== "developer")
      throw new ApiFailure(
        403,
        "FORBIDDEN",
        "Your team role does not allow catalog changes.",
      );
    return {
      userId: identity.user_id,
      organizationId: identity.organization_id,
      team: TeamSchema.parse(team),
    };
  }

  async logout(token: string | undefined): Promise<void> {
    const tokenHash = sessionTokenHash(token);
    if (!tokenHash) return;
    await withTransaction(this.pool, async (client) => {
      const result = await client.query<{
        id: string;
        user_id: string;
        organization_id: string;
      }>(
        `UPDATE auth_sessions SET revoked_at = now()
         WHERE token_hash = $1 AND revoked_at IS NULL
         RETURNING id, user_id, organization_id`,
        [tokenHash],
      );
      const session = result.rows[0];
      if (session) {
        await client.query(
          "INSERT INTO audit_events (organization_id, actor_user_id, action, target_id) VALUES ($1, $2, 'auth.logout', $3)",
          [session.organization_id, session.user_id, session.id],
        );
      }
    });
  }
}
