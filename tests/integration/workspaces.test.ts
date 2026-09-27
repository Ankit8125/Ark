import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MeResponse, WorkspaceDefinition } from "@ark/contracts";
import {
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
} from "@ark/contracts";
import { createPool, withTransaction } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/credentials.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const setup = {
  ownerName: "Workspace Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Workspace Tests",
  teamName: "Alpha",
};
const definition: WorkspaceDefinition = {
  name: "Web application",
  description:
    "Shared application development.\nPreserve complete configuration. 🚀",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "feature/workspaces",
  defaultBranch: "main",
  sandboxImage: "ghcr.io/example/dev:24",
  workingDirectory: "apps/web",
  actions: {
    install: "pnpm install --frozen-lockfile",
    test: "pnpm test\npnpm test:integration",
    lint: "",
    build: "  pnpm build  ",
  },
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const mutate = (
  method: "POST" | "PUT",
  url: string,
  payload: unknown,
  cookie?: string,
) =>
  app.inject({
    method,
    url,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    payload: payload as Record<string, unknown>,
  });
const get = (url: string, cookie?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: { host: headers.host, ...(cookie ? { cookie } : {}) },
  });
const listPath = (teamId: string) => `/api/teams/${teamId}/workspaces`;
const detailPath = (teamId: string, id: string) => `${listPath(teamId)}/${id}`;
const create = (
  teamId: string,
  cookie: string,
  value = definition,
  id = randomUUID(),
) =>
  mutate(
    "POST",
    listPath(teamId),
    { id, schemaVersion: 1, definition: value },
    cookie,
  );
const update = (
  teamId: string,
  id: string,
  cookie: string,
  value = definition,
  revision = 1,
) =>
  mutate(
    "PUT",
    detailPath(teamId, id),
    { revision, schemaVersion: 1, definition: value },
    cookie,
  );

async function bootstrap() {
  const response = await mutate("POST", "/api/bootstrap", setup);
  expect(response.statusCode).toBe(201);
  const me = response.json<MeResponse>();
  return {
    me,
    teamId: me.teams[0]!.id,
    cookie: String(response.headers["set-cookie"]).split(";")[0]!,
  };
}

async function member(
  organizationId: string,
  teamId: string,
  role = "developer",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Workspace Member',$3)",
    [id, email, await hashPassword(setup.password)],
  );
  await db.pool.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
    [organizationId, id],
  );
  await db.pool.query(
    "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [teamId, id, organizationId, role],
  );
  const login = await mutate("POST", "/api/auth/login", {
    email,
    password: setup.password,
  });
  expect(login.statusCode).toBe(200);
  return { id, cookie: String(login.headers["set-cookie"]).split(";")[0]! };
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("V0.2 workspace catalog with real PostgreSQL", () => {
  it("rejects anonymous access, malformed routes and inputs without writing records", async () => {
    const { teamId, cookie } = await bootstrap();
    const id = randomUUID();
    expect((await get(listPath(teamId))).statusCode).toBe(401);
    expect((await get(detailPath(teamId, id))).statusCode).toBe(401);
    expect(
      (
        await mutate("POST", listPath(teamId), {
          id,
          schemaVersion: 1,
          definition,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await mutate("PUT", detailPath(teamId, id), {
          revision: 1,
          schemaVersion: 1,
          definition,
        })
      ).statusCode,
    ).toBe(401);
    for (const payload of [
      { id, schemaVersion: 1, definition, organizationId: randomUUID() },
      {
        id,
        schemaVersion: 1,
        definition: { ...definition, actions: { test: "pnpm test" } },
      },
      {
        id,
        schemaVersion: 1,
        definition: { ...definition, workingDirectory: "../private" },
      },
      {
        id,
        schemaVersion: 1,
        definition: {
          ...definition,
          repositoryUrl: "https://private@example.test/project",
        },
      },
      { id, schemaVersion: 2, definition },
      {
        id,
        schemaVersion: 1,
        definition: { ...definition, name: "bad\u0000name" },
      },
      {
        id,
        schemaVersion: 1,
        definition: { ...definition, description: "bad\ud800text" },
      },
      {
        id,
        schemaVersion: 1,
        definition: {
          ...definition,
          actions: { ...definition.actions, build: "bad\udfffcommand" },
        },
      },
    ]) {
      expect(
        (await mutate("POST", listPath(teamId), payload, cookie)).statusCode,
      ).toBe(400);
    }
    expect(
      (await get(`${listPath(teamId)}?cursor=bad`, cookie)).statusCode,
    ).toBe(400);
    expect(
      (await get(`${listPath(teamId)}?limit=10000`, cookie)).statusCode,
    ).toBe(400);
    expect((await get(detailPath(teamId, "bad"), cookie)).statusCode).toBe(400);
    expect(
      (await db.pool.query("SELECT count(*)::int AS count FROM resources"))
        .rows[0].count,
    ).toBe(0);
  });

  it("persists complete definitions across app recreation and creates immutable edit snapshots", async () => {
    const { teamId, cookie } = await bootstrap();
    const result = await create(teamId, cookie);
    expect(result.statusCode).toBe(201);
    const original = WorkspaceResponseSchema.parse(result.json()).workspace;
    expect(original).toMatchObject({
      teamId,
      name: definition.name,
      schemaVersion: 1,
      revision: 1,
      definition,
    });
    await app.close();
    app = await buildApp({ pool: db.pool });
    expect((await get(detailPath(teamId, original.id), cookie)).json()).toEqual(
      { workspace: original },
    );
    const changed: WorkspaceDefinition = {
      name: "API development",
      description: "Every field was changed.",
      repositoryUrl: "https://gitlab.com/example/backend.git",
      sourceRef: "releases/v2",
      defaultBranch: "develop",
      sandboxImage: "node:24",
      workingDirectory: ".",
      actions: {
        install: "npm ci",
        test: "npm test",
        lint: "npm run lint",
        build: "npm run build",
      },
    };
    const saved = await update(teamId, original.id, cookie, changed);
    expect(saved.statusCode).toBe(200);
    const current = WorkspaceResponseSchema.parse(saved.json()).workspace;
    expect(current).toMatchObject({
      id: original.id,
      revision: 2,
      schemaVersion: 1,
      definition: changed,
      createdAt: original.createdAt,
    });
    expect(current.versionId).not.toBe(original.versionId);
    expect((await get(detailPath(teamId, original.id), cookie)).json()).toEqual(
      { workspace: current },
    );
    const versions = await db.pool.query(
      "SELECT revision, schema_version, definition FROM resource_versions WHERE resource_id=$1 ORDER BY revision",
      [original.id],
    );
    expect(versions.rows).toEqual([
      { revision: 1, schema_version: 1, definition },
      { revision: 2, schema_version: 1, definition: changed },
    ]);
    const events = await db.pool.query(
      "SELECT action,metadata FROM audit_events WHERE action LIKE 'workspace.%' ORDER BY action",
    );
    expect(events.rows).toEqual([
      { action: "workspace.created", metadata: { revision: 1 } },
      { action: "workspace.updated", metadata: { revision: 2 } },
    ]);
  });

  it("replays the same creation safely but rejects a reused identity with different content", async () => {
    const { teamId, cookie } = await bootstrap();
    const id = randomUUID();
    const created = await create(teamId, cookie, definition, id);
    expect(created.statusCode).toBe(201);
    const replay = await create(teamId, cookie, definition, id);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(created.json());
    const conflict = await create(
      teamId,
      cookie,
      { ...definition, description: "Different" },
      id,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("ID_CONFLICT");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE action='workspace.created'",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("serializes concurrent retries of one creation without duplicate snapshots or audit events", async () => {
    const { teamId, cookie } = await bootstrap();
    const id = randomUUID();
    const results = await Promise.all([
      create(teamId, cookie, definition, id),
      create(teamId, cookie, definition, id),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 201,
    ]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect(
      (await db.pool.query("SELECT count(*)::int AS count FROM resources"))
        .rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE action='workspace.created'",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("keeps names unique within a team without changing a conflicting resource", async () => {
    const { teamId, cookie } = await bootstrap();
    const first = await create(teamId, cookie);
    expect(first.statusCode).toBe(201);
    const duplicate = await create(teamId, cookie, {
      ...definition,
      name: definition.name.toUpperCase(),
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe("NAME_CONFLICT");
    const second = await create(teamId, cookie, {
      ...definition,
      name: "Other workspace",
    });
    expect(second.statusCode).toBe(201);
    const id = second.json().workspace.id;
    expect((await update(teamId, id, cookie)).statusCode).toBe(409);
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      second.json(),
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions",
        )
      ).rows[0].count,
    ).toBe(2);
  });

  it("requires exact Host, Origin, and JSON for PUT as well as POST", async () => {
    const { teamId, cookie } = await bootstrap();
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    const payload = { revision: 1, schemaVersion: 1, definition };
    for (const invalid of [
      { origin: "https://evil.example" },
      { origin: "http://127.0.0.1:5173.evil.example" },
      { origin: "" },
      { host: "evil.example" },
    ]) {
      expect(
        (
          await app.inject({
            method: "PUT",
            url: detailPath(teamId, id),
            headers: { ...headers, cookie, ...invalid },
            payload,
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "PUT",
          url: detailPath(teamId, id),
          headers: { ...headers, cookie, "content-type": "text/plain" },
          payload: JSON.stringify(payload),
        })
      ).statusCode,
    ).toBe(415);
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      created.json(),
    );
  });

  it("isolates team resources even for an organization owner without explicit membership", async () => {
    const { teamId, cookie, me } = await bootstrap();
    const alpha = await create(teamId, cookie);
    const alphaId = alpha.json().workspace.id;
    const betaTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Beta')",
      [betaTeam, me.organization.id],
    );
    const beta = await member(me.organization.id, betaTeam);
    const betaCreated = await create(betaTeam, beta.cookie);
    expect(betaCreated.statusCode).toBe(201);
    const betaId = betaCreated.json().workspace.id;
    expect((await get(listPath(betaTeam), cookie)).statusCode).toBe(404);
    expect((await get(detailPath(betaTeam, betaId), cookie)).statusCode).toBe(
      404,
    );
    expect((await update(betaTeam, betaId, cookie)).statusCode).toBe(404);
    expect((await create(betaTeam, cookie)).statusCode).toBe(404);
    expect((await get(listPath(teamId), beta.cookie)).statusCode).toBe(404);
    expect(
      (await get(detailPath(teamId, alphaId), beta.cookie)).statusCode,
    ).toBe(404);
    expect((await get(detailPath(teamId, betaId), cookie)).statusCode).toBe(
      404,
    );
    expect(
      (await get(detailPath(betaTeam, alphaId), beta.cookie)).statusCode,
    ).toBe(404);
  });

  it("allows reviewers and viewers to read but denies both creation and editing", async () => {
    const { teamId, cookie, me } = await bootstrap();
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    for (const role of ["reviewer", "viewer"]) {
      const reader = await member(me.organization.id, teamId, role);
      expect((await get(listPath(teamId), reader.cookie)).statusCode).toBe(200);
      expect((await get(detailPath(teamId, id), reader.cookie)).json()).toEqual(
        created.json(),
      );
      const denied = await create(teamId, reader.cookie, {
        ...definition,
        name: `${role} attempted creation`,
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe("FORBIDDEN");
      expect((await update(teamId, id, reader.cookie)).statusCode).toBe(403);
    }
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      created.json(),
    );
  });

  it("applies team revocation, disabled users, organization revocation, and session expiry immediately", async () => {
    const { teamId, cookie, me } = await bootstrap();
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    const developer = await member(me.organization.id, teamId);
    for (const restriction of [
      {
        sql: "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
        reset: "UPDATE team_memberships SET revoked_at=NULL WHERE user_id=$1",
        status: 404,
      },
      {
        sql: "UPDATE users SET disabled_at=now() WHERE id=$1",
        reset: "UPDATE users SET disabled_at=NULL WHERE id=$1",
        status: 401,
      },
      {
        sql: "UPDATE organization_memberships SET revoked_at=now() WHERE user_id=$1",
        reset:
          "UPDATE organization_memberships SET revoked_at=NULL WHERE user_id=$1",
        status: 401,
      },
      {
        sql: "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
        reset:
          "UPDATE auth_sessions SET expires_at=now()+interval '1 hour' WHERE user_id=$1",
        status: 401,
      },
    ]) {
      await db.pool.query(restriction.sql, [developer.id]);
      expect((await get(listPath(teamId), developer.cookie)).statusCode).toBe(
        restriction.status,
      );
      expect(
        (await get(detailPath(teamId, id), developer.cookie)).statusCode,
      ).toBe(restriction.status);
      expect((await update(teamId, id, developer.cookie)).statusCode).toBe(
        restriction.status,
      );
      expect(
        (
          await create(teamId, developer.cookie, {
            ...definition,
            name: "Denied creation",
          })
        ).statusCode,
      ).toBe(restriction.status);
      await db.pool.query(restriction.reset, [developer.id]);
    }
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      created.json(),
    );
  });

  it("waits for a pending team revocation and rechecks membership before a blocked creation", async () => {
    const { teamId, me } = await bootstrap();
    const developer = await member(me.organization.id, teamId);
    const blocker = await db.pool.connect();
    let transactionFinished = false;
    let requestFinished = false;
    let pending: Promise<Awaited<ReturnType<typeof create>>> | undefined;
    try {
      await blocker.query("BEGIN");
      const blockerPid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await blocker.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2",
        [teamId, developer.id],
      );
      pending = create(teamId, developer.cookie).then((response) => {
        requestFinished = true;
        return response;
      });
      // Observe a real PostgreSQL lock dependency, rather than guessing when the
      // HTTP handler has reached authorization with a fixed sleep.
      await expect
        .poll(
          async () => {
            const waiting = await db.pool.query<{ blocked: boolean }>(
              `SELECT EXISTS (
             SELECT 1 FROM pg_stat_activity
             WHERE datname=current_database() AND state='active'
               AND wait_event_type='Lock'
               AND $1::integer=ANY(pg_blocking_pids(pid))
               AND query LIKE '%team_memberships%'
           ) AS blocked`,
              [blockerPid],
            );
            return waiting.rows[0]!.blocked;
          },
          { timeout: 5000, interval: 20 },
        )
        .toBe(true);
      expect(requestFinished).toBe(false);
      await blocker.query("COMMIT");
      transactionFinished = true;
      const result = await pending;
      expect(result.statusCode).toBe(404);
      expect(result.json().error.code).toBe("NOT_FOUND");
      expect(
        (await db.pool.query("SELECT count(*)::int AS count FROM resources"))
          .rows[0].count,
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM resource_versions",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM audit_events WHERE action='workspace.created'",
          )
        ).rows[0].count,
      ).toBe(0);
    } finally {
      try {
        if (!transactionFinished) await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
      // Always settle the request after releasing the lock before fixture cleanup.
      if (pending) await pending;
    }
  });

  it("serializes competing edits with one winner and an explicit revision conflict", async () => {
    const { teamId, cookie } = await bootstrap();
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    const results = await Promise.all([
      update(teamId, id, cookie, {
        ...definition,
        description: "First editor",
      }),
      update(teamId, id, cookie, {
        ...definition,
        description: "Second editor",
      }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const rejected = results.find((result) => result.statusCode === 409)!;
    expect(rejected.json().error.code).toBe("REVISION_CONFLICT");
    const winner = results.find((result) => result.statusCode === 200)!;
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      winner.json(),
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions WHERE resource_id=$1",
          [id],
        )
      ).rows[0].count,
    ).toBe(2);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM audit_events WHERE action='workspace.updated'",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("rolls back resources, snapshots, and edits when auditing fails", async () => {
    const { teamId, cookie } = await bootstrap();
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT force_workspace_failure CHECK(action <> 'workspace.created')",
    );
    expect((await create(teamId, cookie)).statusCode).toBe(500);
    expect(
      (await db.pool.query("SELECT count(*)::int AS count FROM resources"))
        .rows[0].count,
    ).toBe(0);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions",
        )
      ).rows[0].count,
    ).toBe(0);
    await db.pool.query(
      "ALTER TABLE audit_events DROP CONSTRAINT force_workspace_failure",
    );
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT force_workspace_failure CHECK(action <> 'workspace.updated')",
    );
    expect(
      (
        await update(teamId, id, cookie, {
          ...definition,
          description: "Must roll back",
        })
      ).statusCode,
    ).toBe(500);
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      created.json(),
    );
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM resource_versions",
        )
      ).rows[0].count,
    ).toBe(1);
  });

  it("reads unfamiliar stored schemas intact and refuses to overwrite them", async () => {
    const { teamId, cookie } = await bootstrap();
    const created = await create(teamId, cookie);
    const id = created.json().workspace.id;
    const futureDefinition = {
      ...definition,
      futureSetting: { enabled: true, value: "preserve me" },
    };
    // This administrative fixture simulates a snapshot produced by a future application version.
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2,definition=$2 WHERE resource_id=$1",
      [id, futureDefinition],
    );
    const read = await get(detailPath(teamId, id), cookie);
    expect(read.statusCode).toBe(200);
    expect(WorkspaceResponseSchema.parse(read.json()).workspace).toMatchObject({
      schemaVersion: 2,
      definition: futureDefinition,
    });
    const rejected = await update(teamId, id, cookie);
    expect(rejected.statusCode).toBe(409);
    expect(rejected.json().error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      read.json(),
    );
  });

  it("returns at most fifty summaries and advances an explicit UUID cursor without duplicates", async () => {
    const { teamId, cookie, me } = await bootstrap();
    const ids = Array.from({ length: 51 }, () => randomUUID()).sort();
    await withTransaction(db.pool, async (client) => {
      for (const [index, id] of ids.entries()) {
        const value = { ...definition, name: `Workspace ${index + 1}` };
        await client.query(
          "INSERT INTO resources(id,organization_id,team_id,kind,name,revision) VALUES($1,$2,$3,'workspace',$4,1)",
          [id, me.organization.id, teamId, value.name],
        );
        await client.query(
          "INSERT INTO resource_versions(resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,1,1,$2,$3)",
          [id, value, me.user.id],
        );
      }
    });
    const first = await get(listPath(teamId), cookie);
    expect(first.statusCode).toBe(200);
    const firstPage = WorkspaceListResponseSchema.parse(first.json());
    expect(firstPage.workspaces.map((workspace) => workspace.id)).toEqual(
      ids.slice(0, 50),
    );
    expect(firstPage.nextCursor).toBe(ids[49]);
    expect(firstPage.workspaces[0]).not.toHaveProperty("definition");
    const last = await get(
      `${listPath(teamId)}?cursor=${firstPage.nextCursor}`,
      cookie,
    );
    const lastPage = WorkspaceListResponseSchema.parse(last.json());
    expect(lastPage.workspaces.map((workspace) => workspace.id)).toEqual(
      ids.slice(50),
    );
    expect(lastPage.nextCursor).toBeNull();
    const exhausted = await get(
      `${listPath(teamId)}?cursor=${ids[50]}`,
      cookie,
    );
    expect(exhausted.json()).toEqual({ workspaces: [], nextCursor: null });
  });

  it("creates and edits through restricted runtime grants while denying version and audit tampering", async () => {
    const { teamId, cookie } = await bootstrap();
    const role = db.schema;
    await db.admin.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    let runtime: ReturnType<typeof createPool> | undefined;
    try {
      await db.admin.query(`GRANT USAGE ON SCHEMA "${db.schema}" TO "${role}"`);
      await db.admin.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA "${db.schema}" TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT,UPDATE ON "${db.schema}".resources TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT ON "${db.schema}".resource_versions,"${db.schema}".audit_events TO "${role}"`,
      );
      // Row-level authorization locks need the same UPDATE privilege as the local runtime role.
      await db.admin.query(
        `GRANT UPDATE ON "${db.schema}".users,"${db.schema}".organization_memberships,"${db.schema}".teams,"${db.schema}".team_memberships,"${db.schema}".auth_sessions TO "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime });
      const created = await create(teamId, cookie);
      expect(created.statusCode).toBe(201);
      const id = created.json().workspace.id;
      expect(
        (
          await update(teamId, id, cookie, {
            ...definition,
            description: "Runtime edit",
          })
        ).statusCode,
      ).toBe(200);
      for (const sql of [
        "UPDATE resource_versions SET definition='{}'::jsonb",
        "DELETE FROM resource_versions",
        "TRUNCATE resource_versions CASCADE",
        "DELETE FROM resources",
        "UPDATE audit_events SET metadata='{}'::jsonb",
        "DELETE FROM audit_events",
        "CREATE TABLE forbidden(id int)",
      ])
        await expect(runtime.query(sql)).rejects.toThrow();
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });
});
