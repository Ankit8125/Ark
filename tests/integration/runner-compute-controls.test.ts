import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RunnerGrantsResponseSchema,
  RunnerResponseSchema,
  RunnerUseAccessResponseSchema,
  type MeResponse,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
import { IdentityService } from "../../apps/api/src/identity.js";
import {
  newSessionToken,
  sessionTokenHash,
} from "../../apps/api/src/credentials.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const base = (teamId: string, runnerId: string) =>
  `/api/teams/${teamId}/runners/${runnerId}`;
const get = (url: string, cookie?: string, authorization?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: {
      host: headers.host,
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
  });
const post = (
  url: string,
  payload: object,
  cookie?: string,
  authorization?: string,
) =>
  app.inject({
    method: "POST",
    url,
    headers: {
      ...headers,
      ...(cookie ? { cookie } : {}),
      ...(authorization ? { authorization } : {}),
    },
    payload,
  });
async function bootstrap() {
  const result = await post("/api/bootstrap", {
    ownerName: "Compute Owner",
    email: "owner@example.test",
    password: "test-only-long-password",
    organizationName: "Compute Tests",
    teamName: "Alpha",
  });
  expect(result.statusCode).toBe(201);
  const me = result.json<MeResponse>();
  return {
    me,
    teamId: me.teams[0]!.id,
    cookie: String(result.headers["set-cookie"]).split(";")[0]!,
  };
}
type Fixture = Awaited<ReturnType<typeof bootstrap>>;
async function member(
  f: Fixture,
  role: "admin" | "developer" | "reviewer" | "viewer" = "developer",
) {
  const id = randomUUID();
  await db.pool.query(
    `INSERT INTO users(id,email,display_name,password_hash)
     SELECT $1,$2,'Compute Member',password_hash FROM users WHERE id=$3`,
    [id, `${id}@example.test`, f.me.user.id],
  );
  await db.pool.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
    [f.me.organization.id, id],
  );
  await db.pool.query(
    "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [f.teamId, id, f.me.organization.id, role],
  );
  const session = newSessionToken();
  await db.pool.query(
    "INSERT INTO auth_sessions(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [id, f.me.organization.id, sessionTokenHash(session)],
  );
  return { id, cookie: `ark_session=${session}` };
}
async function runner(f: Fixture, enrolled = true) {
  const id = randomUUID();
  const enrollmentToken = `ark_enroll_${id}_${randomBytes(32).toString("hex")}`;
  const credential = `ark_runner_${id}_${randomBytes(32).toString("hex")}`;
  const issued = await post(
    `/api/teams/${f.teamId}/runner-enrollments`,
    { id, name: "Compute runner", enrollmentToken },
    f.cookie,
  );
  expect(issued.statusCode).toBe(201);
  if (enrolled) {
    const result = await post(
      "/api/runner/enroll",
      { runnerCredential: credential },
      undefined,
      `Bearer ${enrollmentToken}`,
    );
    expect(result.statusCode).toBe(200);
  }
  return { id, credential, enrollmentToken, path: base(f.teamId, id) };
}
const approval = (
  f: { cookie: string },
  r: { path: string },
  expectedLifecycleRevision: number,
  approved = true,
) =>
  post(
    `${r.path}/dispatch-approval`,
    { expectedLifecycleRevision, approved },
    f.cookie,
  );
const grant = (
  f: { cookie: string },
  r: { path: string },
  userId: string,
  expectedLifecycleRevision: number,
  granted = true,
) =>
  post(
    `${r.path}/grants/${userId}`,
    { expectedLifecycleRevision, granted },
    f.cookie,
  );
async function ownAccess(f: { cookie: string }, r: { path: string }) {
  const result = await get(`${r.path}/use-access`, f.cookie);
  expect(result.statusCode).toBe(200);
  return RunnerUseAccessResponseSchema.parse(result.json());
}
async function roster(f: { cookie: string }, r: { path: string }, cursor = "") {
  const result = await get(
    `${r.path}/grants${cursor ? `?cursor=${cursor}` : ""}`,
    f.cookie,
  );
  expect(result.statusCode).toBe(200);
  return RunnerGrantsResponseSchema.parse(result.json());
}
async function state(id: string) {
  return (
    await db.pool.query(
      `SELECT dispatch_approved,lifecycle_revision,revoked_at,
       (SELECT count(*)::integer FROM runner_use_grants WHERE runner_id=$1) AS grants,
       (SELECT count(*)::integer FROM audit_events WHERE target_id=$1) AS audits
       FROM runners WHERE id=$1`,
      [id],
    )
  ).rows[0];
}
function denied(
  result: Awaited<ReturnType<typeof post>>,
  status: number,
  code?: string,
) {
  expect(result.statusCode).toBe(status);
  if (code) expect(result.json().error.code).toBe(code);
}
async function blockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await db.pool.query<{ blocked: boolean }>(
      "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))) AS blocked",
      [pid],
    );
    if (result.rows[0]!.blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected a database lock wait.");
}
beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await db.close();
});

describe("runner dispatch approval and compute grants", () => {
  it.each(["admin", "developer", "reviewer", "viewer"] as const)(
    "allows %s to inspect only personal access, with administration reserved to admins",
    async (role) => {
      const f = await bootstrap();
      const actor = await member(f, role);
      const r = await runner(f);
      expect(await ownAccess(actor, r)).toMatchObject({
        hasUseGrant: false,
        useAllowed: false,
      });
      const expected = role === "admin" ? 200 : 403;
      expect((await approval(actor, r, 2)).statusCode).toBe(expected);
      expect((await get(`${r.path}/grants`, actor.cookie)).statusCode).toBe(
        expected,
      );
      expect(
        (await grant(actor, r, f.me.user.id, role === "admin" ? 3 : 2))
          .statusCode,
      ).toBe(expected);
      if (role === "admin")
        expect((await ownAccess(actor, r)).useAllowed).toBe(false);
    },
  );

  it("keeps grants, approval and health separate and revocation clears approval atomically", async () => {
    const f = await bootstrap();
    const developer = await member(f);
    const r = await runner(f);
    expect((await grant(f, r, developer.id, 2)).statusCode).toBe(200);
    expect(await ownAccess(developer, r)).toMatchObject({
      hasUseGrant: true,
      useAllowed: false,
      runner: {
        lifecycleRevision: 3,
        health: "unknown",
        dispatchApproved: false,
      },
    });
    expect((await approval(f, r, 3)).statusCode).toBe(200);
    expect(await ownAccess(developer, r)).toMatchObject({
      useAllowed: true,
      runner: { health: "unknown", lifecycleRevision: 4 },
    });
    expect((await ownAccess(f, r)).useAllowed).toBe(false);
    const beat = await post(
      "/api/runner/heartbeat",
      {},
      undefined,
      `Bearer ${r.credential}`,
    );
    expect(RunnerResponseSchema.parse(beat.json()).runner).toMatchObject({
      health: "online",
      dispatchApproved: true,
      lifecycleRevision: 4,
    });
    expect((await approval(f, r, 4, false)).statusCode).toBe(200);
    expect(await ownAccess(developer, r)).toMatchObject({
      hasUseGrant: true,
      useAllowed: false,
    });
    expect((await approval(f, r, 5)).statusCode).toBe(200);
    expect(
      (
        await post(
          `${r.path}/revoke`,
          { expectedLifecycleRevision: 6 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect(await ownAccess(developer, r)).toMatchObject({
      hasUseGrant: true,
      useAllowed: false,
      runner: {
        dispatchApproved: false,
        lifecycleRevision: 7,
        health: "unknown",
      },
    });
    denied(await approval(f, r, 7), 409, "RUNNER_UNAVAILABLE");
    denied(await grant(f, r, developer.id, 7), 409, "RUNNER_UNAVAILABLE");
    expect((await grant(f, r, developer.id, 7, false)).statusCode).toBe(200);
    expect((await approval(f, r, 8, false)).statusCode).toBe(200);
    denied(
      await post(
        "/api/runner/heartbeat",
        {},
        undefined,
        `Bearer ${r.credential}`,
      ),
      401,
    );
    const replacement = await runner(f);
    expect(await ownAccess(developer, replacement)).toMatchObject({
      hasUseGrant: false,
      useAllowed: false,
      runner: { dispatchApproved: false },
    });
  });

  it("rejects pending permissions and preserves current no-ops while rejecting stale matching writes", async () => {
    const f = await bootstrap();
    const r = await runner(f, false);
    denied(await approval(f, r, 1), 409, "RUNNER_UNAVAILABLE");
    denied(await grant(f, r, f.me.user.id, 1), 409, "RUNNER_UNAVAILABLE");
    expect((await approval(f, r, 1, false)).statusCode).toBe(200);
    expect((await grant(f, r, randomUUID(), 1, false)).statusCode).toBe(200);
    expect(await state(r.id)).toMatchObject({
      lifecycle_revision: 1,
      grants: 0,
      audits: 1,
    });
    const connected = await runner(f);
    expect((await approval(f, connected, 2)).statusCode).toBe(200);
    expect((await approval(f, connected, 3)).statusCode).toBe(200);
    denied(await approval(f, connected, 2), 409, "LIFECYCLE_CONFLICT");
    expect((await grant(f, connected, f.me.user.id, 3)).statusCode).toBe(200);
    expect((await grant(f, connected, f.me.user.id, 4)).statusCode).toBe(200);
    denied(
      await grant(f, connected, f.me.user.id, 3),
      409,
      "LIFECYCLE_CONFLICT",
    );
    expect(await state(connected.id)).toMatchObject({
      lifecycle_revision: 4,
      grants: 1,
      audits: 4,
    });
  });

  it.each([
    "reviewer",
    "viewer",
    "team_revoked",
    "organization_revoked",
    "disabled",
  ] as const)(
    "narrows retained grants after %s changes, permits removal, and restores effect only when eligible",
    async (change) => {
      const f = await bootstrap();
      const actor = await member(f);
      const r = await runner(f);
      expect((await grant(f, r, actor.id, 2)).statusCode).toBe(200);
      expect((await approval(f, r, 3)).statusCode).toBe(200);
      const sql =
        change === "disabled"
          ? "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1"
          : change === "organization_revoked"
            ? "UPDATE organization_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1"
            : change === "team_revoked"
              ? "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1"
              : `UPDATE team_memberships SET role='${change}' WHERE user_id=$1`;
      await db.pool.query(sql, [actor.id]);
      const personal = await get(`${r.path}/use-access`, actor.cookie);
      if (change === "reviewer" || change === "viewer")
        expect(
          RunnerUseAccessResponseSchema.parse(personal.json()),
        ).toMatchObject({
          hasUseGrant: true,
          useAllowed: false,
        });
      else denied(personal, change === "team_revoked" ? 404 : 401);
      const saved = (await roster(f, r)).members.find(
        (value) => value.userId === actor.id,
      );
      expect(saved).toMatchObject({ eligible: false, granted: true });
      denied(await grant(f, r, actor.id, 4), 403, "GRANT_RECIPIENT_INELIGIBLE");
      await db.pool.query("UPDATE users SET disabled_at=NULL WHERE id=$1", [
        actor.id,
      ]);
      await db.pool.query(
        "UPDATE organization_memberships SET revoked_at=NULL WHERE user_id=$1",
        [actor.id],
      );
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=NULL,role='developer' WHERE user_id=$1",
        [actor.id],
      );
      expect((await ownAccess(actor, r)).useAllowed).toBe(true);
      await db.pool.query(sql, [actor.id]);
      expect((await grant(f, r, actor.id, 4, false)).statusCode).toBe(200);
      expect(
        (await roster(f, r)).members.find((value) => value.userId === actor.id),
      ).toMatchObject({ eligible: false, granted: false });
      await db.pool.query("UPDATE users SET disabled_at=NULL WHERE id=$1", [
        actor.id,
      ]);
      await db.pool.query(
        "UPDATE organization_memberships SET revoked_at=NULL WHERE user_id=$1",
        [actor.id],
      );
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=NULL,role='developer' WHERE user_id=$1",
        [actor.id],
      );
      expect((await ownAccess(actor, r)).useAllowed).toBe(false);
    },
  );

  it("keeps organization ownership, teams and machine credentials outside permission administration", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    const other = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Other team')",
      [other, f.me.organization.id],
    );
    for (const path of [
      `${base(other, r.id)}/grants`,
      `${base(other, r.id)}/use-access`,
    ])
      denied(await get(path, f.cookie), 404);
    denied(await approval(f, { path: base(other, r.id) }, 2), 404);
    denied(await grant(f, { path: base(other, r.id) }, f.me.user.id, 2), 404);
    // Relax only the disposable schema's singleton to exercise organization isolation.
    const foreignOrganization = randomUUID();
    const foreignTeam = randomUUID();
    await db.pool.query(
      "ALTER TABLE organizations DROP CONSTRAINT organizations_singleton_key",
    );
    await db.pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Foreign organization')",
      [foreignOrganization],
    );
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Foreign team')",
      [foreignTeam, foreignOrganization],
    );
    const foreignFixture = {
      ...f,
      teamId: foreignTeam,
      me: {
        ...f.me,
        organization: { ...f.me.organization, id: foreignOrganization },
      },
    };
    const foreignAdmin = await member(foreignFixture, "admin");
    const foreignRunner = await runner({
      ...foreignFixture,
      cookie: foreignAdmin.cookie,
    });
    for (const path of [foreignRunner.path, base(f.teamId, foreignRunner.id)]) {
      denied(await get(`${path}/grants`, f.cookie), 404);
      denied(await get(`${path}/use-access`, f.cookie), 404);
      denied(await approval(f, { path }, 2), 404);
      denied(await grant(f, { path }, f.me.user.id, 2), 404);
    }
    denied(
      await grant(f, r, foreignAdmin.id, 2),
      403,
      "GRANT_RECIPIENT_INELIGIBLE",
    );
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [other, f.me.user.id, f.me.organization.id],
    );
    denied(await get(`${base(other, r.id)}/grants`, f.cookie), 404);
    denied(await get(`${base(other, r.id)}/use-access`, f.cookie), 404);
    denied(await approval(f, { path: base(other, r.id) }, 2), 404);
    denied(await grant(f, { path: base(other, r.id) }, f.me.user.id, 2), 404);
    for (const bearer of [r.credential, r.enrollmentToken]) {
      for (const suffix of ["grants", "use-access"])
        denied(
          await get(`${r.path}/${suffix}`, undefined, `Bearer ${bearer}`),
          401,
        );
      denied(
        await post(
          `${r.path}/dispatch-approval`,
          { expectedLifecycleRevision: 2, approved: true },
          undefined,
          `Bearer ${bearer}`,
        ),
        401,
      );
      denied(
        await post(
          `${r.path}/grants/${f.me.user.id}`,
          { expectedLifecycleRevision: 2, granted: true },
          undefined,
          `Bearer ${bearer}`,
        ),
        401,
      );
    }
    await db.pool.query(
      "UPDATE team_memberships SET role='viewer' WHERE team_id=$1 AND user_id=$2",
      [f.teamId, f.me.user.id],
    );
    denied(await approval(f, r, 2), 403);
    denied(await grant(f, r, f.me.user.id, 2), 403);
    denied(await get(`${r.path}/grants`, f.cookie), 403);
    expect((await ownAccess(f, r)).useAllowed).toBe(false);
  });

  it("rejects malformed requests, extra fields, untrusted origins and non-JSON writes without mutation", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    for (const [suffix, field] of [
      ["dispatch-approval", "approved"],
      [`grants/${f.me.user.id}`, "granted"],
    ] as const) {
      for (const payload of [
        { expectedLifecycleRevision: 2, [field]: "true" },
        { expectedLifecycleRevision: 0, [field]: true },
        { expectedLifecycleRevision: 2.5, [field]: true },
        { expectedLifecycleRevision: 2, [field]: true, surprise: true },
        { [field]: true },
      ])
        denied(await post(`${r.path}/${suffix}`, payload, f.cookie), 400);
      denied(
        await post(
          `${r.path}/${suffix}?extra=true`,
          { expectedLifecycleRevision: 2, [field]: true },
          f.cookie,
        ),
        400,
      );
      const forbidden = await app.inject({
        method: "POST",
        url: `${r.path}/${suffix}`,
        headers: {
          ...headers,
          origin: "http://evil.example",
          cookie: f.cookie,
        },
        payload: { expectedLifecycleRevision: 2, [field]: true },
      });
      denied(forbidden, 403);
      const nonJson = await app.inject({
        method: "POST",
        url: `${r.path}/${suffix}`,
        headers: { ...headers, "content-type": "text/plain", cookie: f.cookie },
        payload: "{}",
      });
      denied(nonJson, 415);
    }
    denied(await get(`${r.path}/grants?cursor=invalid`, f.cookie), 400);
    denied(await get(`${r.path}/grants?extra=true`, f.cookie), 400);
    denied(
      await get(`${r.path}/use-access?userId=${f.me.user.id}`, f.cookie),
      400,
    );
    expect(await state(r.id)).toMatchObject({
      lifecycle_revision: 2,
      grants: 0,
      audits: 2,
    });
  });

  it("uses fresh eligibility when a personal-access read follows a role change during authorization", async () => {
    const f = await bootstrap();
    const actor = await member(f);
    const r = await runner(f);
    expect((await grant(f, r, actor.id, 2)).statusCode).toBe(200);
    expect((await approval(f, r, 3)).statusCode).toBe(200);
    const original = IdentityService.prototype.authorizeTeam;
    vi.spyOn(IdentityService.prototype, "authorizeTeam").mockImplementationOnce(
      async function (this: IdentityService, ...args) {
        const access = await original.apply(this, args);
        await db.pool.query(
          "UPDATE team_memberships SET role='viewer' WHERE team_id=$1 AND user_id=$2",
          [f.teamId, actor.id],
        );
        return access;
      },
    );
    expect(await ownAccess(actor, r)).toMatchObject({
      hasUseGrant: true,
      useAllowed: false,
    });
  });

  it("paginates only eligible candidates and retained records without exposing emails or credentials", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    const viewer = await member(f, "viewer");
    for (let index = 0; index < 51; index++) await member(f);
    const first = await roster(f, r);
    expect(first.members).toHaveLength(50);
    expect(first.nextCursor).toBe(first.members.at(-1)!.userId);
    const second = await roster(f, r, first.nextCursor!);
    expect(second.members).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.members, ...second.members].map(
      (value) => value.userId,
    );
    expect(new Set(ids).size).toBe(52);
    expect(ids).toEqual([...ids].sort());
    expect(ids).not.toContain(viewer.id);
    const text = JSON.stringify(first);
    expect(text).not.toContain("@");
    expect(text).not.toContain(r.credential);
    expect(text).not.toContain(r.enrollmentToken);
  });

  it("serializes competing permission changes and approval versus irreversible revocation", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    const changes = await Promise.all([
      approval(f, r, 2),
      grant(f, r, f.me.user.id, 2),
    ]);
    expect(changes.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(await state(r.id)).toMatchObject({
      lifecycle_revision: 3,
      audits: 3,
    });
    const next = await runner(f);
    const race = await Promise.all([
      approval(f, next, 2),
      post(`${next.path}/revoke`, { expectedLifecycleRevision: 2 }, f.cookie),
    ]);
    expect(race.map((result) => result.statusCode).sort()).toEqual([200, 409]);
    const current = await state(next.id);
    if (!current.revoked_at)
      expect(
        (
          await post(
            `${next.path}/revoke`,
            { expectedLifecycleRevision: 3 },
            f.cookie,
          )
        ).statusCode,
      ).toBe(200);
    expect(await state(next.id)).toMatchObject({ dispatch_approved: false });
    expect((await ownAccess(f, next)).useAllowed).toBe(false);
  });

  it.each(["approval", "grant"] as const)(
    "rejects expired actor sessions after %s waits for a runner lock",
    async (operation) => {
      const f = await bootstrap();
      const actor = await member(f, "admin");
      const r = await runner(f);
      await db.pool.query(
        "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
        [actor.id],
      );
      const locker = await db.pool.connect();
      let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
      try {
        await locker.query("BEGIN");
        const pid = (await locker.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid as number;
        await locker.query("SELECT 1 FROM runners WHERE id=$1 FOR UPDATE", [
          r.id,
        ]);
        request = Promise.resolve(
          operation === "approval"
            ? approval(actor, r, 2)
            : grant(actor, r, f.me.user.id, 2),
        );
        await blockedBy(pid);
        await locker.query(
          "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM auth_sessions WHERE user_id=$1",
          [actor.id],
        );
        await locker.query("COMMIT");
        denied(await request, 401);
        expect(await state(r.id)).toMatchObject({
          lifecycle_revision: 2,
          grants: 0,
          audits: 2,
        });
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        if (request) await request;
      }
    },
  );

  it("rechecks recipient eligibility after waiting for a concurrent membership change", async () => {
    const f = await bootstrap();
    const recipient = await member(f);
    const r = await runner(f);
    const locker = await db.pool.connect();
    let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query(
        "SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
        [f.teamId, recipient.id],
      );
      request = Promise.resolve(grant(f, r, recipient.id, 2));
      await blockedBy(pid);
      await locker.query(
        "UPDATE team_memberships SET role='viewer' WHERE team_id=$1 AND user_id=$2",
        [f.teamId, recipient.id],
      );
      await locker.query("COMMIT");
      denied(await request, 403, "GRANT_RECIPIENT_INELIGIBLE");
      expect(await state(r.id)).toMatchObject({
        lifecycle_revision: 2,
        grants: 0,
        audits: 2,
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (request) await request;
    }
  });

  it.each(["approval", "grant"] as const)(
    "rolls back %s and its revision when audit insertion fails",
    async (operation) => {
      const f = await bootstrap();
      const r = await runner(f);
      await db.pool.query(
        "CREATE FUNCTION reject_compute_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action IN ('runner.dispatch_approval_changed','runner.use_grant_changed') THEN RAISE EXCEPTION 'Rejected test audit'; END IF; RETURN NEW; END $$",
      );
      await db.pool.query(
        "CREATE TRIGGER reject_compute_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_compute_audit()",
      );
      const result =
        operation === "approval"
          ? await approval(f, r, 2)
          : await grant(f, r, f.me.user.id, 2);
      denied(result, 500, "INTERNAL_ERROR");
      expect(result.body).not.toContain("Rejected test audit");
      expect(await state(r.id)).toMatchObject({
        dispatch_approved: false,
        lifecycle_revision: 2,
        grants: 0,
        audits: 2,
      });
    },
  );

  it("audits only safe permission details and prevents lifecycle overflow", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    expect((await approval(f, r, 2)).statusCode).toBe(200);
    expect((await grant(f, r, f.me.user.id, 3)).statusCode).toBe(200);
    const events = (
      await db.pool.query(
        "SELECT actor_user_id,action,metadata FROM audit_events WHERE target_id=$1 AND action IN ('runner.dispatch_approval_changed','runner.use_grant_changed') ORDER BY action",
        [r.id],
      )
    ).rows;
    expect(events).toEqual([
      {
        actor_user_id: f.me.user.id,
        action: "runner.dispatch_approval_changed",
        metadata: { teamId: f.teamId, lifecycleRevision: 3, approved: true },
      },
      {
        actor_user_id: f.me.user.id,
        action: "runner.use_grant_changed",
        metadata: {
          teamId: f.teamId,
          lifecycleRevision: 4,
          userId: f.me.user.id,
          granted: true,
        },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("@");
    await db.pool.query(
      "UPDATE runners SET lifecycle_revision=2147483647 WHERE id=$1",
      [r.id],
    );
    denied(await approval(f, r, 2147483647, false), 409, "LIFECYCLE_CONFLICT");
    denied(
      await grant(f, r, f.me.user.id, 2147483647, false),
      409,
      "LIFECYCLE_CONFLICT",
    );
    expect((await ownAccess(f, r)).useAllowed).toBe(true);
    expect(await state(r.id)).toMatchObject({ audits: 4 });
  });

  it.each(["approval", "grant"] as const)(
    "rolls back %s if response serialization cannot represent the result",
    async (operation) => {
      const f = await bootstrap();
      const r = await runner(f);
      const before = await state(r.id);
      await db.pool.query(
        "CREATE FUNCTION invalid_compute_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.enrollment_expires_at='infinity'::timestamptz; RETURN NEW; END $$",
      );
      await db.pool.query(
        "CREATE TRIGGER invalid_compute_timestamp BEFORE UPDATE ON runners FOR EACH ROW EXECUTE FUNCTION invalid_compute_timestamp()",
      );
      const result =
        operation === "approval"
          ? await approval(f, r, 2)
          : await grant(f, r, f.me.user.id, 2);
      denied(result, 500, "INTERNAL_ERROR");
      expect(await state(r.id)).toEqual(before);
    },
  );

  it("enforces ownership constraints and operates with restricted runtime privileges", async () => {
    const f = await bootstrap();
    const r = await runner(f);
    const pending = await runner(f, false);
    const otherTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Other')",
      [otherTeam, f.me.organization.id],
    );
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [otherTeam, f.me.user.id, f.me.organization.id],
    );
    await expect(
      db.pool.query("UPDATE runners SET dispatch_approved=true WHERE id=$1", [
        pending.id,
      ]),
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      db.pool.query(
        "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
        [r.id, otherTeam, f.me.organization.id, f.me.user.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const outsider = await member({ ...f, teamId: otherTeam });
    await expect(
      db.pool.query(
        "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
        [r.id, f.teamId, f.me.organization.id, outsider.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    const role = db.schema;
    let runtime: ReturnType<typeof createPool> | undefined;
    await db.admin.query(
      `CREATE ROLE "${role}" NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    try {
      await db.admin.query(`GRANT USAGE ON SCHEMA "${db.schema}" TO "${role}"`);
      await db.admin.query(
        `GRANT SELECT ON ALL TABLES IN SCHEMA "${db.schema}" TO "${role}"`,
      );
      await db.admin.query(
        `GRANT UPDATE ON "${db.schema}".users,"${db.schema}".organization_memberships,"${db.schema}".teams,"${db.schema}".team_memberships,"${db.schema}".auth_sessions TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT,UPDATE ON "${db.schema}".runners,"${db.schema}".runner_use_grants TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT ON "${db.schema}".audit_events TO "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime });
      expect((await approval(f, r, 2)).statusCode).toBe(200);
      expect((await grant(f, r, f.me.user.id, 3)).statusCode).toBe(200);
      expect((await ownAccess(f, r)).useAllowed).toBe(true);
      expect((await roster(f, r)).members[0]).toMatchObject({
        userId: f.me.user.id,
        granted: true,
      });
      expect((await grant(f, r, f.me.user.id, 4, false)).statusCode).toBe(200);
      for (const sql of [
        "DELETE FROM runner_use_grants",
        "UPDATE audit_events SET metadata='{}'::jsonb",
        "CREATE TABLE forbidden_compute_table(id integer)",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });
});
