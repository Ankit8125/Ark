import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/credentials.js";
import { createPool, migrate } from "@ark/db";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const setup = {
  ownerName: "Test Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Test Organization",
  teamName: "Alpha",
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const post = (url: string, payload: unknown, cookie?: string) =>
  app.inject({
    method: "POST",
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
async function bootstrap() {
  const response = await post("/api/bootstrap", setup);
  expect(response.statusCode).toBe(201);
  const cookie = String(response.headers["set-cookie"]).split(";")[0]!;
  return { cookie, me: response.json(), response };
}
async function member(
  organizationId: string,
  teamId?: string,
  role = "member",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,$3,$4)",
    [id, email, "Test Member", await hashPassword(setup.password)],
  );
  await db.pool.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,$3)",
    [organizationId, id, role],
  );
  if (teamId)
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'developer')",
      [teamId, id, organizationId],
    );
  const login = await post("/api/auth/login", {
    email,
    password: setup.password,
  });
  expect(login.statusCode).toBe(200);
  return {
    id,
    email,
    cookie: String(login.headers["set-cookie"]).split(";")[0]!,
  };
}
beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("V0.1 identity with real PostgreSQL", () => {
  it("reports readiness and denies anonymous access", async () => {
    expect((await get("/api/health/live")).statusCode).toBe(200);
    expect((await get("/api/health/ready")).statusCode).toBe(200);
    expect((await get("/api/bootstrap/status")).json()).toEqual({
      required: true,
    });
    expect((await get("/api/me")).statusCode).toBe(401);
    expect((await get(`/api/teams/${randomUUID()}`)).statusCode).toBe(401);
    await db.pool.query("DELETE FROM schema_migrations");
    expect((await get("/api/health/ready")).statusCode).toBe(503);
  });
  it("creates exactly one organization, owner, team and persistent session atomically", async () => {
    const { cookie, me, response } = await bootstrap();
    expect(me.organization.role).toBe("owner");
    expect(me.teams[0].role).toBe("admin");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("SameSite=Strict");
    expect(response.headers["set-cookie"]).toContain("Path=/");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(me).not.toHaveProperty("token");
    const stored = await db.pool.query("SELECT token_hash FROM auth_sessions");
    expect(stored.rows[0].token_hash).not.toBe(cookie.split("=")[1]);
    const user = await db.pool.query("SELECT password_hash FROM users");
    expect(user.rows[0].password_hash).toMatch(/^\$argon2id\$/);
    expect(user.rows[0].password_hash).not.toContain(setup.password);
    await app.close();
    app = await buildApp({ pool: db.pool });
    expect((await get("/api/me", cookie)).json()).toEqual(me);
    expect((await get("/api/bootstrap/status")).json()).toEqual({
      required: false,
    });
    expect((await post("/api/bootstrap", setup)).statusCode).toBe(409);
  });
  it("closes the concurrent first-setup race", async () => {
    const results = await Promise.all([
      post("/api/bootstrap", setup),
      post("/api/bootstrap", { ...setup, email: "second@example.test" }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    for (const table of ["organizations", "users", "teams", "auth_sessions"]) {
      expect(
        (await db.pool.query(`SELECT count(*)::int AS count FROM ${table}`))
          .rows[0].count,
      ).toBe(1);
    }
  });
  it("rejects malformed input before writing any identity records", async () => {
    expect(
      (await post("/api/bootstrap", { ...setup, role: "owner" })).statusCode,
    ).toBe(400);
    expect(
      (await post("/api/bootstrap", { ...setup, password: "weak" })).statusCode,
    ).toBe(400);
    expect(
      (await db.pool.query("SELECT count(*)::int AS count FROM users")).rows[0]
        .count,
    ).toBe(0);
  });
  it("rolls back every setup record if a later database write fails", async () => {
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT force_test_failure CHECK(action <> 'installation.bootstrap')",
    );
    expect((await post("/api/bootstrap", setup)).statusCode).toBe(500);
    for (const table of [
      "organizations",
      "users",
      "teams",
      "organization_memberships",
      "team_memberships",
      "auth_sessions",
    ]) {
      expect(
        (await db.pool.query(`SELECT count(*)::int AS count FROM ${table}`))
          .rows[0].count,
      ).toBe(0);
    }
    expect((await get("/api/bootstrap/status")).json()).toEqual({
      required: true,
    });
  });
  it("requires an allowed Host, exact Origin and JSON for mutations", async () => {
    for (const invalid of [
      { origin: "https://evil.example" },
      { origin: "http://127.0.0.1:5173.evil.example" },
      { origin: "" },
      { host: "evil.example" },
    ]) {
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/bootstrap",
            headers: { ...headers, ...invalid },
            payload: setup,
          })
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/bootstrap",
          headers: { ...headers, "content-type": "text/plain" },
          payload: JSON.stringify(setup),
        })
      ).statusCode,
    ).toBe(415);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/health/live",
          headers: { host: "evil.example", "x-forwarded-host": headers.host },
        })
      ).statusCode,
    ).toBe(403);
  });
  it("returns generic login failures, rotates cookies, and revokes logout sessions", async () => {
    const { cookie } = await bootstrap();
    const wrong = await post("/api/auth/login", {
      email: setup.email,
      password: "wrong-password",
    });
    const unknown = await post("/api/auth/login", {
      email: "unknown@example.test",
      password: "wrong-password",
    });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json()).toEqual(wrong.json());
    const login = await post(
      "/api/auth/login",
      { email: setup.email.toUpperCase(), password: setup.password },
      cookie,
    );
    expect(login.statusCode).toBe(200);
    const renewed = String(login.headers["set-cookie"]).split(";")[0]!;
    expect(renewed).not.toBe(cookie);
    expect((await get("/api/me", cookie)).statusCode).toBe(401);
    expect((await get("/api/me", renewed)).statusCode).toBe(200);
    expect((await post("/api/auth/logout", {}, renewed)).statusCode).toBe(204);
    expect((await get("/api/me", renewed)).statusCode).toBe(401);
  });
  it("enforces expiry and immediate user/membership revocation", async () => {
    const { me } = await bootstrap();
    const user = await member(me.organization.id, me.teams[0].id);
    await db.pool.query("UPDATE users SET disabled_at=now() WHERE id=$1", [
      user.id,
    ]);
    expect((await get("/api/me", user.cookie)).statusCode).toBe(401);
    await db.pool.query("UPDATE users SET disabled_at=NULL WHERE id=$1", [
      user.id,
    ]);
    await db.pool.query(
      "UPDATE organization_memberships SET revoked_at=now() WHERE user_id=$1",
      [user.id],
    );
    expect((await get("/api/me", user.cookie)).statusCode).toBe(401);
    await db.pool.query(
      "UPDATE organization_memberships SET revoked_at=NULL WHERE user_id=$1",
      [user.id],
    );
    await db.pool.query(
      "UPDATE auth_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",
      [user.id],
    );
    expect((await get("/api/me", user.cookie)).statusCode).toBe(401);
    expect((await get("/api/me", "ark_session=malformed")).statusCode).toBe(
      401,
    );
  });
  it("isolates two teams, including an organization owner with no membership", async () => {
    const { me, cookie } = await bootstrap();
    const teamId = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,$3)",
      [teamId, me.organization.id, "Beta"],
    );
    const beta = await member(me.organization.id, teamId);
    expect((await get(`/api/teams/${teamId}`, cookie)).statusCode).toBe(404);
    expect(
      (await get(`/api/teams/${me.teams[0].id}`, beta.cookie)).statusCode,
    ).toBe(404);
    expect((await get(`/api/teams/${teamId}`, beta.cookie)).statusCode).toBe(
      200,
    );
    expect(
      (await get("/api/me", beta.cookie))
        .json()
        .teams.map((team: { id: string }) => team.id),
    ).toEqual([teamId]);
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
      [beta.id],
    );
    expect((await get(`/api/teams/${teamId}`, beta.cookie)).statusCode).toBe(
      404,
    );
    expect((await get("/api/me", beta.cookie)).json().teams).toEqual([]);
  });
  it("prevents last-owner deletion, demotion, revocation, and deactivation in the database", async () => {
    const { me } = await bootstrap();
    const statements = [
      "DELETE FROM organization_memberships WHERE user_id=$1",
      "UPDATE organization_memberships SET role='member' WHERE user_id=$1",
      "UPDATE organization_memberships SET revoked_at=now() WHERE user_id=$1",
      "UPDATE users SET disabled_at=now() WHERE id=$1",
      "DELETE FROM users WHERE id=$1",
    ];
    for (const sql of statements)
      await expect(db.pool.query(sql, [me.user.id])).rejects.toThrow(
        "ARK_LAST_OWNER",
      );
    const other = await member(me.organization.id, undefined, "owner");
    await db.pool.query(
      "UPDATE organization_memberships SET role='member' WHERE user_id=$1",
      [me.user.id],
    );
    await expect(
      db.pool.query("UPDATE users SET disabled_at=now() WHERE id=$1", [
        other.id,
      ]),
    ).rejects.toThrow("ARK_LAST_OWNER");
  });
  it("serializes competing owner removals", async () => {
    const { me } = await bootstrap();
    const other = await member(me.organization.id, undefined, "owner");
    const results = await Promise.allSettled(
      [me.user.id, other.id].map((id) =>
        db.pool.query(
          "UPDATE organization_memberships SET role='member' WHERE user_id=$1",
          [id],
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM organization_memberships WHERE role='owner' AND revoked_at IS NULL",
        )
      ).rows[0].count,
    ).toBe(1);
  });
  it("limits login attempts and rejects forged forwarded addresses as a bypass", async () => {
    for (let attempt = 0; attempt < 10; attempt++)
      expect(
        (
          await post("/api/auth/login", {
            email: "absent@example.test",
            password: "wrong",
          })
        ).statusCode,
      ).toBe(401);
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { ...headers, "x-forwarded-for": "192.0.2.1" },
      payload: { email: "absent@example.test", password: "wrong" },
    });
    expect(result.statusCode).toBe(429);
    expect(result.json().error.code).toBe("RATE_LIMITED");
  });
  it("replays migrations safely and detects edited migration history", async () => {
    await migrate(db.pool);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS count FROM schema_migrations",
        )
      ).rows[0].count,
    ).toBe(4);
    await db.pool.query("UPDATE schema_migrations SET checksum='tampered'");
    await expect(migrate(db.pool)).rejects.toThrow("checksum mismatch");
  });
  it("runs setup under a restricted role and denies DDL/audit tampering", async () => {
    const role = db.schema;
    await db.admin.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    let runtime: ReturnType<typeof createPool> | undefined;
    try {
      await db.admin.query(`GRANT USAGE ON SCHEMA "${db.schema}" TO "${role}"`);
      await db.admin.query(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${db.schema}" TO "${role}"`,
      );
      await db.admin.query(
        `REVOKE UPDATE, DELETE ON "${db.schema}".audit_events FROM "${role}"`,
      );
      await db.admin.query(
        `REVOKE UPDATE, DELETE ON "${db.schema}".resource_versions FROM "${role}"`,
      );
      await db.admin.query(
        `REVOKE DELETE ON "${db.schema}".resources FROM "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime });
      await bootstrap();
      await expect(
        runtime.query("CREATE TABLE forbidden(id int)"),
      ).rejects.toThrow();
      await expect(runtime.query("DELETE FROM audit_events")).rejects.toThrow();
      await expect(runtime.query("TRUNCATE users CASCADE")).rejects.toThrow();
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });
});
