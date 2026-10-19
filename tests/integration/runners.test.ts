import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  RunnerListResponseSchema,
  RunnerResponseSchema,
  type MeResponse,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/credentials.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const setup = {
  ownerName: "Runner Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Runner Tests",
  teamName: "Alpha",
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const listPath = (teamId: string) => `/api/teams/${teamId}/runners`;
const issuePath = (teamId: string) => `/api/teams/${teamId}/runner-enrollments`;
const revokePath = (teamId: string, id: string) =>
  `${listPath(teamId)}/${id}/revoke`;
const token = (realm: "enroll" | "runner", id: string) =>
  `ark_${realm}_${id}_${randomBytes(32).toString("hex")}`;
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
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
  payload: unknown,
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
    payload: payload as object,
  });
const enroll = (code: string, credential: string, cookie?: string) =>
  post(
    "/api/runner/enroll",
    { runnerCredential: credential },
    cookie,
    `Bearer ${code}`,
  );
const heartbeat = (credential: string, payload: unknown = {}) =>
  post("/api/runner/heartbeat", payload, undefined, `Bearer ${credential}`);
function input(id = randomUUID(), name = "Local runner") {
  return { id, name, enrollmentToken: token("enroll", id) };
}
async function bootstrap() {
  const result = await post("/api/bootstrap", setup);
  expect(result.statusCode).toBe(201);
  const me = result.json<MeResponse>();
  return {
    me,
    teamId: me.teams[0]!.id,
    cookie: String(result.headers["set-cookie"]).split(";")[0]!,
  };
}
async function member(
  f: Awaited<ReturnType<typeof bootstrap>>,
  role: "admin" | "developer" | "reviewer" | "viewer",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Runner Member',$3)",
    [id, email, await hashPassword(setup.password)],
  );
  await db.pool.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
    [f.me.organization.id, id],
  );
  await db.pool.query(
    "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [f.teamId, id, f.me.organization.id, role],
  );
  const result = await post("/api/auth/login", {
    email,
    password: setup.password,
  });
  expect(result.statusCode).toBe(200);
  return { id, cookie: String(result.headers["set-cookie"]).split(";")[0]! };
}
async function issue(f: { teamId: string; cookie: string }, request = input()) {
  const result = await post(issuePath(f.teamId), request, f.cookie);
  expect(result.statusCode).toBe(201);
  return {
    request,
    credential: token("runner", request.id),
    ...RunnerResponseSchema.parse(result.json()),
  };
}
async function connected(f: { teamId: string; cookie: string }) {
  const issued = await issue(f);
  const result = await enroll(
    issued.request.enrollmentToken,
    issued.credential,
  );
  expect(result.statusCode).toBe(200);
  return { ...issued, ...RunnerResponseSchema.parse(result.json()) };
}
async function listed(f: { teamId: string; cookie: string }) {
  const result = await get(listPath(f.teamId), f.cookie);
  expect(result.statusCode).toBe(200);
  return RunnerListResponseSchema.parse(result.json());
}
const denied = (
  result: Awaited<ReturnType<typeof post>>,
  status: number,
  code?: string,
) => {
  expect(result.statusCode).toBe(status);
  if (code) expect(result.json().error.code).toBe(code);
};
async function counts() {
  return (
    await db.pool.query(
      "SELECT (SELECT count(*)::integer FROM runners) AS runners, (SELECT count(*)::integer FROM audit_events WHERE action LIKE 'runner.%') AS audits",
    )
  ).rows[0];
}
async function row(id: string) {
  return (await db.pool.query("SELECT * FROM runners WHERE id=$1", [id]))
    .rows[0];
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
  if (app) await app.close();
  if (db) await db.close();
});

describe("local runner enrollment with PostgreSQL", () => {
  it("issues a hash-only pending identity, replays without extending TTL, and rejects changed ID details", async () => {
    const f = await bootstrap();
    const issued = await issue(f);
    expect(issued.runner).toMatchObject({
      id: issued.request.id,
      teamId: f.teamId,
      organizationId: f.me.organization.id,
      lifecycleRevision: 1,
      enrolledAt: null,
      lastHeartbeatAt: null,
      revokedAt: null,
      health: "unknown",
      dispatchApproved: false,
    });
    expect(
      Date.parse(issued.runner.enrollmentExpiresAt) -
        Date.parse(issued.runner.createdAt),
    ).toBeGreaterThan(599000);
    expect(
      Date.parse(issued.runner.enrollmentExpiresAt) -
        Date.parse(issued.runner.createdAt),
    ).toBeLessThanOrEqual(600000);
    const saved = await row(issued.runner.id);
    expect(saved.enrollment_token_hash).toBe(
      hash(issued.request.enrollmentToken),
    );
    expect(saved.credential_hash).toBeNull();
    expect(JSON.stringify(saved)).not.toContain(issued.request.enrollmentToken);
    const replay = await post(issuePath(f.teamId), issued.request, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(replay.json()).runner).toEqual(
      issued.runner,
    );
    for (const changed of [
      { ...issued.request, name: "Other name" },
      { ...issued.request, enrollmentToken: token("enroll", issued.runner.id) },
    ])
      denied(
        await post(issuePath(f.teamId), changed, f.cookie),
        409,
        "ID_CONFLICT",
      );
    expect(await counts()).toEqual({ runners: 1, audits: 1 });
    const text = JSON.stringify(await listed(f));
    expect(text).not.toContain("hash");
    expect(text).not.toContain(issued.request.enrollmentToken);
    expect(text).not.toContain(issued.credential);
  });

  it.each(["admin", "developer", "reviewer", "viewer"] as const)(
    "lets %s read while only explicit admins issue and revoke",
    async (role) => {
      const f = await bootstrap();
      const actor = await member(f, role);
      const issued = await issue(f);
      const result = await get(listPath(f.teamId), actor.cookie);
      expect(result.statusCode).toBe(200);
      const created = await post(issuePath(f.teamId), input(), actor.cookie);
      const revoked = await post(
        revokePath(f.teamId, issued.runner.id),
        { expectedLifecycleRevision: 1 },
        actor.cookie,
      );
      if (role === "admin") {
        expect(created.statusCode).toBe(201);
        expect(revoked.statusCode).toBe(200);
      } else {
        denied(created, 403, "FORBIDDEN");
        denied(revoked, 403, "FORBIDDEN");
      }
    },
  );

  it("keeps team isolation, explicit ownership access, sessions, and machine realms separate", async () => {
    const f = await bootstrap();
    const issued = await issue(f);
    const other = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Other team')",
      [other, f.me.organization.id],
    );
    denied(await get(listPath(f.teamId)), 401);
    denied(await get(listPath(other), f.cookie), 404);
    denied(await post(issuePath(other), input(), f.cookie), 404);
    const foreignOrganization = randomUUID();
    const foreignTeam = randomUUID();
    // Relax only the disposable fixture to exercise the defensive organization boundary.
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
    denied(await get(listPath(foreignTeam), f.cookie), 404);
    denied(await post(issuePath(foreignTeam), input(), f.cookie), 404);
    denied(
      await post(
        revokePath(foreignTeam, issued.runner.id),
        { expectedLifecycleRevision: 1 },
        f.cookie,
      ),
      404,
    );
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [other, f.me.user.id, f.me.organization.id],
    );
    expect((await listed({ ...f, teamId: other })).runners).toEqual([]);
    denied(
      await post(
        revokePath(other, issued.runner.id),
        { expectedLifecycleRevision: 1 },
        f.cookie,
      ),
      404,
    );
    denied(await post(issuePath(other), issued.request, f.cookie), 409);
    denied(
      await get(listPath(f.teamId), undefined, `Bearer ${issued.credential}`),
      401,
    );
    denied(
      await post(
        issuePath(f.teamId),
        input(),
        undefined,
        `Bearer ${issued.request.enrollmentToken}`,
      ),
      401,
    );
    denied(
      await post(
        "/api/runner/enroll",
        { runnerCredential: issued.credential },
        f.cookie,
      ),
      401,
    );
    denied(await post("/api/runner/heartbeat", {}, f.cookie), 401);
    denied(await enroll(issued.credential, issued.credential), 401);
    denied(await heartbeat(issued.request.enrollmentToken), 401);
    denied(
      await enroll(
        issued.request.enrollmentToken,
        token("runner", randomUUID()),
      ),
      401,
    );
    denied(
      await enroll(token("enroll", issued.runner.id), issued.credential),
      401,
    );
    denied(await heartbeat(issued.credential), 401);
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE team_id=$1 AND user_id=$2",
      [f.teamId, f.me.user.id],
    );
    denied(await get(listPath(f.teamId), f.cookie), 404);
    denied(
      await post(
        revokePath(f.teamId, issued.runner.id),
        { expectedLifecycleRevision: 1 },
        f.cookie,
      ),
      404,
    );
    expect(await counts()).toEqual({ runners: 1, audits: 1 });
  });

  it("rejects management through a logged-out session while the enrolled runner can heartbeat", async () => {
    const f = await bootstrap();
    const issued = await connected(f);
    expect((await post("/api/auth/logout", {}, f.cookie)).statusCode).toBe(204);
    denied(await get(listPath(f.teamId), f.cookie), 401);
    denied(await post(issuePath(f.teamId), input(), f.cookie), 401);
    denied(
      await post(
        revokePath(f.teamId, issued.runner.id),
        { expectedLifecycleRevision: 2 },
        f.cookie,
      ),
      401,
    );
    expect((await heartbeat(issued.credential)).statusCode).toBe(200);
    expect(await counts()).toEqual({ runners: 1, audits: 2 });
  });

  it.each(["issue", "revoke"] as const)(
    "rechecks admin permission when %s waits behind a membership change",
    async (operation) => {
      const f = await bootstrap();
      const actor = await member(f, "admin");
      const issued = await issue(f);
      const before = await counts();
      const locker = await db.pool.connect();
      let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
      try {
        await locker.query("BEGIN");
        const pid = (await locker.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid as number;
        await locker.query(
          "SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
          [f.teamId, actor.id],
        );
        request = Promise.resolve(
          operation === "issue"
            ? post(issuePath(f.teamId), input(), actor.cookie)
            : post(
                revokePath(f.teamId, issued.runner.id),
                { expectedLifecycleRevision: 1 },
                actor.cookie,
              ),
        );
        await blockedBy(pid);
        await locker.query(
          "UPDATE team_memberships SET role='developer' WHERE team_id=$1 AND user_id=$2",
          [f.teamId, actor.id],
        );
        await locker.query("COMMIT");
        denied(await request, 403, "FORBIDDEN");
        expect(await counts()).toEqual(before);
        expect((await row(issued.runner.id)).revoked_at).toBeNull();
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        if (request) await request;
      }
    },
  );

  it.each([
    ["issue", "membership"],
    ["revoke", "membership"],
    ["replay", "runner"],
    ["revoke", "runner"],
  ] as const)(
    "rejects %s when its session expires while waiting for the %s lock",
    async (operation, lock) => {
      const f = await bootstrap();
      const issued = await issue(f);
      const before = await counts();
      const saved = await row(issued.runner.id);
      const locker = await db.pool.connect();
      let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
      try {
        await locker.query("BEGIN");
        const pid = (await locker.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid as number;
        if (lock === "membership")
          await locker.query(
            "SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
            [f.teamId, f.me.user.id],
          );
        else
          await locker.query("SELECT 1 FROM runners WHERE id=$1 FOR UPDATE", [
            issued.runner.id,
          ]);
        await db.pool.query(
          "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '1 second' WHERE user_id=$1",
          [f.me.user.id],
        );
        request = Promise.resolve(
          operation === "revoke"
            ? post(
                revokePath(f.teamId, issued.runner.id),
                { expectedLifecycleRevision: 1 },
                f.cookie,
              )
            : post(
                issuePath(f.teamId),
                operation === "issue" ? input() : issued.request,
                f.cookie,
              ),
        );
        await blockedBy(pid);
        await locker.query(
          "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM auth_sessions WHERE user_id=$1",
          [f.me.user.id],
        );
        await locker.query("COMMIT");
        denied(await request, 401, "UNAUTHENTICATED");
        expect(await counts()).toEqual(before);
        expect(await row(issued.runner.id)).toEqual(saved);
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        if (request) await request;
      }
    },
  );

  it("preserves exact Host, Origin, JSON, strict body/query, and token-to-ID validation", async () => {
    const f = await bootstrap();
    const issued = await issue(f);
    for (const [patch, status] of [
      [{ host: "untrusted.test" }, 403],
      [{ origin: "http://untrusted.test" }, 403],
      [{ "content-type": "text/plain" }, 415],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url: "/api/runner/enroll",
        headers: {
          ...headers,
          ...patch,
          authorization: `Bearer ${issued.request.enrollmentToken}`,
        },
        payload: JSON.stringify({ runnerCredential: issued.credential }),
      });
      denied(result, status);
    }
    for (const [url, body] of [
      [issuePath(f.teamId), { ...issued.request, extra: true }],
      [issuePath(f.teamId), { ...issued.request, id: randomUUID() }],
      [
        issuePath(f.teamId),
        {
          ...issued.request,
          enrollmentToken: `ark_enroll_${"-".repeat(36)}_${"a".repeat(64)}`,
        },
      ],
      [issuePath(f.teamId), { ...input(), name: "bad\u0000text" }],
      [
        "/api/runner/enroll",
        { runnerCredential: issued.credential, extra: true },
      ],
      ["/api/runner/heartbeat", { timestamp: "2099-01-01T00:00:00.000Z" }],
      [
        `${revokePath(f.teamId, issued.runner.id)}?force=true`,
        { expectedLifecycleRevision: 1 },
      ],
      [
        revokePath(f.teamId, issued.runner.id),
        { expectedLifecycleRevision: 1, force: true },
      ],
    ] as const)
      denied(
        await post(
          url,
          body,
          f.cookie,
          `Bearer ${issued.request.enrollmentToken}`,
        ),
        400,
      );
    denied(await get(`${listPath(f.teamId)}?status=active`, f.cookie), 400);
    denied(await get("/api/teams/invalid/runners", f.cookie), 400);
    expect(await counts()).toEqual({ runners: 1, audits: 1 });
  });

  it("enrolls once, permits identical exchange replay only within TTL, and reconciles with heartbeat after expiry", async () => {
    const f = await bootstrap();
    const issued = await connected(f);
    expect(issued.runner).toMatchObject({
      lifecycleRevision: 2,
      health: "unknown",
      lastHeartbeatAt: null,
      dispatchApproved: false,
    });
    expect(issued.runner.enrolledAt).not.toBeNull();
    const original = await row(issued.runner.id);
    expect(original.credential_hash).toBe(hash(issued.credential));
    const replay = await enroll(
      issued.request.enrollmentToken,
      issued.credential,
    );
    expect(replay.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(replay.json()).runner).toEqual(
      issued.runner,
    );
    denied(
      await enroll(
        issued.request.enrollmentToken,
        token("runner", issued.runner.id),
      ),
      401,
    );
    await db.pool.query(
      "UPDATE runners SET created_at=clock_timestamp()-interval '1 hour',enrollment_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [issued.runner.id],
    );
    denied(
      await enroll(issued.request.enrollmentToken, issued.credential),
      401,
    );
    const beat = await heartbeat(issued.credential);
    expect(beat.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(beat.json()).runner).toMatchObject({
      lifecycleRevision: 2,
      health: "online",
    });
    const issueReplay = await post(
      issuePath(f.teamId),
      issued.request,
      f.cookie,
    );
    expect(issueReplay.statusCode).toBe(200);
    expect(
      RunnerResponseSchema.parse(issueReplay.json()).runner.enrollmentExpiresAt,
    ).toBe((await row(issued.runner.id)).enrollment_expires_at.toISOString());
    expect(await counts()).toEqual({ runners: 1, audits: 2 });
  });

  it.each([
    "team_revoked",
    "demoted",
    "organization_revoked",
    "disabled",
  ] as const)("rejects unused code when its issuer is %s", async (state) => {
    const f = await bootstrap();
    const issuer = await member(f, "admin");
    const issued = await issue({ ...f, cookie: issuer.cookie });
    if (state === "team_revoked")
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [issuer.id],
      );
    if (state === "demoted")
      await db.pool.query(
        "UPDATE team_memberships SET role='developer' WHERE user_id=$1",
        [issuer.id],
      );
    if (state === "organization_revoked")
      await db.pool.query(
        "UPDATE organization_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [issuer.id],
      );
    if (state === "disabled")
      await db.pool.query(
        "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1",
        [issuer.id],
      );
    denied(
      await enroll(issued.request.enrollmentToken, issued.credential),
      401,
    );
    expect(await row(issued.runner.id)).toMatchObject({
      credential_hash: null,
      enrolled_at: null,
      lifecycle_revision: 1,
    });
    expect(await counts()).toEqual({ runners: 1, audits: 1 });
  });

  it("keeps an enrolled service identity independent of subsequent issuer logout and access loss", async () => {
    const f = await bootstrap();
    const issuer = await member(f, "admin");
    const issued = await issue({ ...f, cookie: issuer.cookie });
    expect((await post("/api/auth/logout", {}, issuer.cookie)).statusCode).toBe(
      204,
    );
    expect(
      (await enroll(issued.request.enrollmentToken, issued.credential))
        .statusCode,
    ).toBe(200);
    await db.pool.query(
      "UPDATE team_memberships SET role='viewer',revoked_at=clock_timestamp() WHERE user_id=$1",
      [issuer.id],
    );
    await db.pool.query(
      "UPDATE organization_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
      [issuer.id],
    );
    await db.pool.query(
      "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1",
      [issuer.id],
    );
    expect((await heartbeat(issued.credential)).statusCode).toBe(200);
    expect((await listed(f)).runners[0]).toMatchObject({
      lifecycleRevision: 2,
      health: "online",
    });
  });

  it("uses database receipt time, derives offline health, and revokes once without changing history", async () => {
    const f = await bootstrap();
    const issued = await connected(f);
    const before = (await db.pool.query("SELECT clock_timestamp() AS time"))
      .rows[0].time as Date;
    const beat = RunnerResponseSchema.parse(
      (await heartbeat(issued.credential)).json(),
    );
    const after = (await db.pool.query("SELECT clock_timestamp() AS time"))
      .rows[0].time as Date;
    expect(Date.parse(beat.runner.lastHeartbeatAt!)).toBeGreaterThanOrEqual(
      before.getTime(),
    );
    expect(Date.parse(beat.runner.lastHeartbeatAt!)).toBeLessThanOrEqual(
      after.getTime(),
    );
    expect(beat.observedAt).toBe(beat.runner.lastHeartbeatAt);
    expect(beat.runner.lifecycleRevision).toBe(2);
    await db.pool.query(
      "UPDATE runners SET last_heartbeat_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
      [issued.runner.id],
    );
    expect((await listed(f)).runners[0]!.health).toBe("offline");
    const oldSeen = (await row(issued.runner.id)).last_heartbeat_at;
    denied(
      await post(
        revokePath(f.teamId, issued.runner.id),
        { expectedLifecycleRevision: 1 },
        f.cookie,
      ),
      409,
      "LIFECYCLE_CONFLICT",
    );
    const revoked = await post(
      revokePath(f.teamId, issued.runner.id),
      { expectedLifecycleRevision: 2 },
      f.cookie,
    );
    expect(revoked.statusCode).toBe(200);
    const revokedRunner = RunnerResponseSchema.parse(revoked.json()).runner;
    expect(revokedRunner).toMatchObject({
      lifecycleRevision: 3,
      health: "unknown",
      lastHeartbeatAt: oldSeen.toISOString(),
      dispatchApproved: false,
    });
    const repeated = await post(
      revokePath(f.teamId, issued.runner.id),
      { expectedLifecycleRevision: 1 },
      f.cookie,
    );
    expect(repeated.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(repeated.json()).runner).toEqual(
      revokedRunner,
    );
    denied(await heartbeat(issued.credential), 401);
    denied(
      await enroll(issued.request.enrollmentToken, issued.credential),
      401,
    );
    const replay = await post(issuePath(f.teamId), issued.request, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(replay.json()).runner).toEqual(
      revokedRunner,
    );
    const events = (
      await db.pool.query(
        "SELECT action,actor_user_id,metadata FROM audit_events WHERE target_id=$1 ORDER BY action",
        [issued.runner.id],
      )
    ).rows;
    expect(events).toEqual([
      {
        action: "runner.enrolled",
        actor_user_id: null,
        metadata: {
          teamId: f.teamId,
          lifecycleRevision: 2,
          actorKind: "runner",
        },
      },
      {
        action: "runner.enrollment_issued",
        actor_user_id: f.me.user.id,
        metadata: { teamId: f.teamId, lifecycleRevision: 1 },
      },
      {
        action: "runner.revoked",
        actor_user_id: f.me.user.id,
        metadata: { teamId: f.teamId, lifecycleRevision: 3 },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain(
      issued.request.enrollmentToken,
    );
    expect(JSON.stringify(events)).not.toContain(issued.credential);
  });

  it("revokes an unused pending code and rejects expired codes without consuming either", async () => {
    const f = await bootstrap();
    const revoked = await issue(f);
    const expired = await issue(f);
    expect(
      (
        await post(
          revokePath(f.teamId, revoked.runner.id),
          { expectedLifecycleRevision: 1 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    await db.pool.query(
      "UPDATE runners SET created_at=clock_timestamp()-interval '1 hour',enrollment_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [expired.runner.id],
    );
    for (const candidate of [revoked, expired])
      denied(
        await enroll(candidate.request.enrollmentToken, candidate.credential),
        401,
      );
    expect(await row(revoked.runner.id)).toMatchObject({
      credential_hash: null,
      enrolled_at: null,
      lifecycle_revision: 2,
    });
    expect(await row(expired.runner.id)).toMatchObject({
      credential_hash: null,
      enrolled_at: null,
      lifecycle_revision: 1,
    });
    expect(await counts()).toEqual({ runners: 2, audits: 3 });
  });

  it("serializes issue replay and simultaneous enrollment without duplicate identities or audits", async () => {
    const f = await bootstrap();
    const request = input();
    const results = await Promise.all([
      post(issuePath(f.teamId), request, f.cookie),
      post(issuePath(f.teamId), request, f.cookie),
    ]);
    expect(results.map((value) => value.statusCode).sort()).toEqual([200, 201]);
    expect(RunnerResponseSchema.parse(results[0]!.json()).runner).toEqual(
      RunnerResponseSchema.parse(results[1]!.json()).runner,
    );
    const credential = token("runner", request.id);
    const exchanges = await Promise.all([
      enroll(request.enrollmentToken, credential),
      enroll(request.enrollmentToken, credential),
    ]);
    expect(exchanges.map((value) => value.statusCode)).toEqual([200, 200]);
    expect(await counts()).toEqual({ runners: 1, audits: 2 });
    const second = await issue(f);
    const competing = token("runner", second.runner.id);
    const contenders = await Promise.all([
      enroll(second.request.enrollmentToken, second.credential),
      enroll(second.request.enrollmentToken, competing),
    ]);
    expect(contenders.map((value) => value.statusCode).sort()).toEqual([
      200, 401,
    ]);
    const winner =
      contenders[0]!.statusCode === 200 ? second.credential : competing;
    const loser = winner === second.credential ? competing : second.credential;
    expect((await heartbeat(winner)).statusCode).toBe(200);
    denied(await heartbeat(loser), 401);
    expect(await counts()).toEqual({ runners: 2, audits: 4 });
  });

  it("checks enrollment expiry after waiting for the runner lock", async () => {
    const f = await bootstrap();
    const issued = await issue(f);
    const locker = await db.pool.connect();
    let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query(
        "UPDATE runners SET enrollment_expires_at=clock_timestamp()+interval '1 second' WHERE id=$1",
        [issued.runner.id],
      );
      request = Promise.resolve(
        enroll(issued.request.enrollmentToken, issued.credential),
      );
      await blockedBy(pid);
      await locker.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM enrollment_expires_at-clock_timestamp())+0.05)) FROM runners WHERE id=$1",
        [issued.runner.id],
      );
      await locker.query("COMMIT");
      denied(await request, 401);
      expect(await row(issued.runner.id)).toMatchObject({
        credential_hash: null,
        enrolled_at: null,
        lifecycle_revision: 1,
      });
      expect(await counts()).toEqual({ runners: 1, audits: 1 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (request) await request;
    }
  });

  it("rechecks an issuer demoted while enrollment waits for membership locks", async () => {
    const f = await bootstrap();
    const issuer = await member(f, "admin");
    const issued = await issue({ ...f, cookie: issuer.cookie });
    const locker = await db.pool.connect();
    let request: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query(
        "SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
        [f.teamId, issuer.id],
      );
      request = Promise.resolve(
        enroll(issued.request.enrollmentToken, issued.credential),
      );
      await blockedBy(pid);
      await locker.query(
        "UPDATE team_memberships SET role='developer' WHERE team_id=$1 AND user_id=$2",
        [f.teamId, issuer.id],
      );
      await locker.query("COMMIT");
      denied(await request, 401);
      expect(await counts()).toEqual({ runners: 1, audits: 1 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (request) await request;
    }
  });

  it("orders heartbeat against revoke on the runner lock and never accepts a post-revoke heartbeat", async () => {
    const f = await bootstrap();
    const issued = await connected(f);
    const locker = await db.pool.connect();
    let beat: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    let revoke: Promise<Awaited<ReturnType<typeof post>>> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query("SELECT 1 FROM runners WHERE id=$1 FOR UPDATE", [
        issued.runner.id,
      ]);
      beat = Promise.resolve(heartbeat(issued.credential));
      revoke = Promise.resolve(
        post(
          revokePath(f.teamId, issued.runner.id),
          { expectedLifecycleRevision: 2 },
          f.cookie,
        ),
      );
      await blockedBy(pid);
      await locker.query("COMMIT");
      expect([200, 401]).toContain((await beat).statusCode);
      expect((await revoke).statusCode).toBe(200);
      denied(await heartbeat(issued.credential), 401);
      expect(
        (
          await db.pool.query(
            "SELECT lifecycle_revision,last_heartbeat_at IS NULL OR last_heartbeat_at <= revoked_at AS ordered FROM runners WHERE id=$1",
            [issued.runner.id],
          )
        ).rows[0],
      ).toEqual({ lifecycle_revision: 3, ordered: true });
      expect(await counts()).toEqual({ runners: 1, audits: 3 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (beat) await beat;
      if (revoke) await revoke;
    }
  });

  it.each(["issue", "enroll", "revoke"] as const)(
    "rolls back %s when its safe audit cannot persist",
    async (operation) => {
      const f = await bootstrap();
      const issued = operation === "issue" ? undefined : await issue(f);
      const before = await counts();
      const action =
        operation === "issue"
          ? "runner.enrollment_issued"
          : operation === "enroll"
            ? "runner.enrolled"
            : "runner.revoked";
      await db.pool.query(
        `CREATE FUNCTION reject_runner_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='${action}' THEN RAISE EXCEPTION 'Rejected test audit'; END IF; RETURN NEW; END $$`,
      );
      await db.pool.query(
        "CREATE TRIGGER reject_runner_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_runner_audit()",
      );
      const result =
        operation === "issue"
          ? await post(issuePath(f.teamId), input(), f.cookie)
          : operation === "enroll"
            ? await enroll(issued!.request.enrollmentToken, issued!.credential)
            : await post(
                revokePath(f.teamId, issued!.runner.id),
                { expectedLifecycleRevision: 1 },
                f.cookie,
              );
      denied(result, 500, "INTERNAL_ERROR");
      expect(await counts()).toEqual(before);
      if (issued)
        expect(await row(issued.runner.id)).toMatchObject({
          credential_hash: null,
          enrolled_at: null,
          revoked_at: null,
          lifecycle_revision: 1,
        });
      expect(result.body).not.toContain("Rejected test audit");
      if (issued) {
        expect(result.body).not.toContain(issued.request.enrollmentToken);
        expect(result.body).not.toContain(issued.credential);
      }
    },
  );

  it.each(["issue", "enroll", "heartbeat", "revoke"] as const)(
    "rolls back %s if the concrete response cannot represent its result",
    async (operation) => {
      const f = await bootstrap();
      const issued =
        operation === "issue"
          ? undefined
          : operation === "heartbeat"
            ? await connected(f)
            : await issue(f);
      const saved = issued ? await row(issued.runner.id) : undefined;
      const before = await counts();
      // Infinity is legal PostgreSQL timestamp data but not an ISO API timestamp.
      await db.pool.query(
        "CREATE FUNCTION invalid_runner_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.enrollment_expires_at='infinity'::timestamptz; RETURN NEW; END $$",
      );
      await db.pool.query(
        "CREATE TRIGGER invalid_runner_timestamp BEFORE INSERT OR UPDATE ON runners FOR EACH ROW EXECUTE FUNCTION invalid_runner_timestamp()",
      );
      const result =
        operation === "issue"
          ? await post(issuePath(f.teamId), input(), f.cookie)
          : operation === "enroll"
            ? await enroll(issued!.request.enrollmentToken, issued!.credential)
            : operation === "heartbeat"
              ? await heartbeat(issued!.credential)
              : await post(
                  revokePath(f.teamId, issued!.runner.id),
                  { expectedLifecycleRevision: 1 },
                  f.cookie,
                );
      denied(result, 500, "INTERNAL_ERROR");
      expect(await counts()).toEqual(before);
      if (issued) expect(await row(issued.runner.id)).toEqual(saved);
    },
  );

  it("paginates non-secret metadata by ID and persists a running identity across API restart", async () => {
    const f = await bootstrap();
    const issued = await connected(f);
    for (let index = 0; index < 51; index++) {
      const id = randomUUID();
      await db.pool.query(
        "INSERT INTO runners(id,organization_id,team_id,name,issued_by,enrollment_token_hash,enrollment_expires_at) VALUES($1,$2,$3,'Repeated label',$4,$5,clock_timestamp()+interval '10 minutes')",
        [
          id,
          f.me.organization.id,
          f.teamId,
          f.me.user.id,
          hash(token("enroll", id)),
        ],
      );
    }
    const first = await listed(f);
    expect(first.runners).toHaveLength(50);
    expect(first.nextCursor).toBe(first.runners.at(-1)!.id);
    const next = await get(
      `${listPath(f.teamId)}?cursor=${first.nextCursor}`,
      f.cookie,
    );
    const second = RunnerListResponseSchema.parse(next.json());
    expect(second.runners).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.runners, ...second.runners].map((value) => value.id);
    expect(new Set(ids).size).toBe(52);
    expect(ids).toEqual([...ids].sort());
    await app.close();
    app = await buildApp({ pool: db.pool });
    const beat = await heartbeat(issued.credential);
    expect(beat.statusCode).toBe(200);
    expect(RunnerResponseSchema.parse(beat.json()).runner).toMatchObject({
      id: issued.runner.id,
      lifecycleRevision: 2,
      health: "online",
    });
  });

  it("works with restricted runtime privileges and denies runner deletion, audit tampering, and DDL", async () => {
    const f = await bootstrap();
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
        `GRANT INSERT,UPDATE ON "${db.schema}".runners TO "${role}"`,
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
      const issued = await connected(f);
      expect((await heartbeat(issued.credential)).statusCode).toBe(200);
      expect((await listed(f)).runners[0]!.health).toBe("online");
      expect(
        (
          await post(
            revokePath(f.teamId, issued.runner.id),
            { expectedLifecycleRevision: 2 },
            f.cookie,
          )
        ).statusCode,
      ).toBe(200);
      for (const sql of [
        "DELETE FROM runners",
        "UPDATE audit_events SET metadata='{}'::jsonb",
        "CREATE TABLE forbidden_runtime_table(id integer)",
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
