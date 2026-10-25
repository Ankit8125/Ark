import { createHash, randomBytes, randomUUID } from "node:crypto";
import { get as httpGet, type IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SessionClaimResponseSchema,
  SessionEventLogResponseSchema,
  SessionJobSchema,
  SessionListResponseSchema,
  SessionPreviewResponseSchema,
  SessionResponseSchema,
  stubFinalOutputs,
  stubStageOutputs,
  type FlowDefinition,
  type MeResponse,
  type SessionClaimRequest,
  type SessionJob,
  type StartSessionRequest,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
import {
  newSessionToken,
  sessionTokenHash,
} from "../../apps/api/src/credentials.js";
import { IdentityService } from "../../apps/api/src/identity.js";
import { SessionService } from "../../apps/api/src/sessions.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const get = (
  url: string,
  cookie?: string,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: "GET",
    url,
    headers: { host: headers.host, ...(cookie ? { cookie } : {}), ...extra },
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
const base = (teamId: string) => `/api/teams/${teamId}/sessions`;
const secret = () => randomBytes(32).toString("hex");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");

async function setup() {
  const boot = await post("/api/bootstrap", {
    ownerName: "Session Owner",
    email: "owner@example.test",
    password: "test-only-long-password",
    organizationName: "Session Tests",
    teamName: "Alpha",
  });
  expect(boot.statusCode).toBe(201);
  const me = boot.json<MeResponse>();
  const teamId = me.teams[0]!.id;
  const cookie = String(boot.headers["set-cookie"]).split(";")[0]!;
  const workspaceDefinition = {
    name: "Session workspace",
    description: "Inert test repository.",
    repositoryUrl: "https://github.com/example/project.git",
    sourceRef: "main",
    defaultBranch: "main",
    sandboxImage: "node:24",
    workingDirectory: ".",
    actions: {
      install: "",
      test: "this command must never execute",
      lint: "",
      build: "",
    },
  };
  const agentDefinition = {
    name: "Session stub",
    description: "Pure deterministic fixture.",
    instructions: "Produce the declared outputs without external work.",
    runtime: "stub",
    modelPreference: null,
    capabilities: ["run_commands"],
  };
  const workspaceResult = await post(
    `/api/teams/${teamId}/workspaces`,
    { id: randomUUID(), schemaVersion: 1, definition: workspaceDefinition },
    cookie,
  );
  expect(workspaceResult.statusCode).toBe(201);
  const workspace = workspaceResult.json().workspace as {
    id: string;
    versionId: string;
    lifecycleRevision: number;
  };
  const agentResult = await post(
    `/api/teams/${teamId}/agents`,
    { id: randomUUID(), schemaVersion: 1, definition: agentDefinition },
    cookie,
  );
  expect(agentResult.statusCode).toBe(201);
  const agent = agentResult.json().agent as { id: string; versionId: string };
  const first = randomUUID(),
    second = randomUUID();
  const definition: FlowDefinition = {
    name: "Ordered session flow",
    description: "Typed deterministic stages.",
    workspace: { resourceId: workspace.id, versionId: workspace.versionId },
    inputs: [
      { name: "task", type: "text" },
      { name: "settings", type: "json" },
    ],
    stages: [
      {
        id: first,
        name: "Plan",
        agent: { resourceId: agent.id, versionId: agent.versionId },
        inputs: [
          {
            name: "task",
            type: "text",
            source: { kind: "flow_input", port: "task" },
          },
          {
            name: "settings",
            type: "json",
            source: { kind: "flow_input", port: "settings" },
          },
        ],
        outputs: [
          { name: "note", type: "text" },
          { name: "data", type: "json" },
        ],
      },
      {
        id: second,
        name: "Review",
        agent: { resourceId: agent.id, versionId: agent.versionId },
        inputs: [
          {
            name: "note",
            type: "text",
            source: { kind: "stage_output", stageId: first, port: "note" },
          },
          {
            name: "data",
            type: "json",
            source: { kind: "stage_output", stageId: first, port: "data" },
          },
        ],
        outputs: [
          { name: "summary", type: "text" },
          { name: "report", type: "json" },
        ],
      },
    ],
    outputs: [
      {
        name: "result",
        type: "text",
        source: { kind: "stage_output", stageId: second, port: "summary" },
      },
      {
        name: "report",
        type: "json",
        source: { kind: "stage_output", stageId: second, port: "report" },
      },
    ],
  };
  const flowResult = await post(
    `/api/teams/${teamId}/flows`,
    { id: randomUUID(), schemaVersion: 1, definition },
    cookie,
  );
  expect(flowResult.statusCode).toBe(201);
  const flow = flowResult.json().flow as { id: string; versionId: string };
  const runnerId = randomUUID();
  const enrollmentToken = `ark_enroll_${runnerId}_${secret()}`;
  const credential = `ark_runner_${runnerId}_${secret()}`;
  expect(
    (
      await post(
        `/api/teams/${teamId}/runner-enrollments`,
        { id: runnerId, name: "Session runner", enrollmentToken },
        cookie,
      )
    ).statusCode,
  ).toBe(201);
  expect(
    (
      await post(
        "/api/runner/enroll",
        { runnerCredential: credential },
        undefined,
        `Bearer ${enrollmentToken}`,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post(
        `/api/teams/${teamId}/runners/${runnerId}/dispatch-approval`,
        { expectedLifecycleRevision: 2, approved: true },
        cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post(
        `/api/teams/${teamId}/runners/${runnerId}/grants/${me.user.id}`,
        { expectedLifecycleRevision: 3, granted: true },
        cookie,
      )
    ).statusCode,
  ).toBe(200);
  const input: StartSessionRequest = {
    id: randomUUID(),
    flow: { resourceId: flow.id, versionId: flow.versionId },
    runnerId,
    inputValues: {
      task: { type: "text", value: "Sample input" },
      settings: { type: "json", value: { enabled: true } },
    },
  };
  return {
    me,
    teamId,
    cookie,
    workspace,
    agent,
    flow,
    definition,
    input,
    runnerId,
    credential,
    enrollmentToken,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function member(
  f: Fixture,
  role: "admin" | "developer" | "reviewer" | "viewer",
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) SELECT $1,$2,'Session Member',password_hash FROM users WHERE id=$3",
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
  const token = newSessionToken();
  await db.pool.query(
    "INSERT INTO auth_sessions(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [id, f.me.organization.id, sessionTokenHash(token)],
  );
  return { id, cookie: `ark_session=${token}` };
}
async function started(f: Fixture, input = f.input, cookie = f.cookie) {
  const result = await post(base(f.teamId), input, cookie);
  expect(result.statusCode).toBe(201);
  return SessionResponseSchema.parse(result.json()).session;
}
const claimInput = (): SessionClaimRequest => ({
  claimId: randomUUID(),
  leaseToken: secret(),
  runtime: "stub.v1",
});
async function claim(f: Fixture, input = claimInput()) {
  const result = await post(
    "/api/runner/sessions/claim",
    input,
    undefined,
    `Bearer ${f.credential}`,
  );
  expect(result.statusCode).toBe(200);
  return { input, ...SessionClaimResponseSchema.parse(result.json()) };
}
function fields(job: SessionJob, input: SessionClaimRequest) {
  return {
    eventId: randomUUID(),
    leaseId: job.lease.id,
    leaseToken: input.leaseToken,
    generation: job.lease.generation,
    expectedRevision: job.session.revision,
  };
}
const advance = (f: Fixture, payload: unknown, credential = f.credential) =>
  post(
    "/api/runner/sessions/advance",
    payload,
    undefined,
    `Bearer ${credential}`,
  );
async function stage(f: Fixture, job: SessionJob, input: SessionClaimRequest) {
  const payload = {
    ...fields(job, input),
    kind: "stage_completed",
    stageId:
      job.session.snapshot.flow.definition.stages[job.session.stageIndex]!.id,
    outputs: stubStageOutputs(job.session),
  };
  const result = await advance(f, payload);
  expect(result.statusCode).toBe(200);
  return { payload, job: SessionJobSchema.parse(result.json()) };
}
async function completeStages(
  f: Fixture,
  job: SessionJob,
  input: SessionClaimRequest,
) {
  while (
    job.session.stageIndex < job.session.snapshot.flow.definition.stages.length
  )
    job = (await stage(f, job, input)).job;
  return job;
}
const service = () =>
  new SessionService(db.pool, new IdentityService(db.pool, 43200));
async function counts() {
  return (
    await db.pool.query(
      "SELECT (SELECT count(*)::int FROM execution_sessions) AS sessions,(SELECT count(*)::int FROM session_leases) AS leases,(SELECT count(*)::int FROM execution_events) AS events,(SELECT count(*)::int FROM audit_events WHERE action LIKE 'session.%') AS audits",
    )
  ).rows[0];
}
async function current(f: Fixture, id = f.input.id) {
  const result = await get(`${base(f.teamId)}/${id}`, f.cookie);
  expect(result.statusCode).toBe(200);
  return SessionResponseSchema.parse(result.json()).session;
}
async function revokeRunner(f: Fixture) {
  const revision = (
    await db.pool.query("SELECT lifecycle_revision FROM runners WHERE id=$1", [
      f.runnerId,
    ])
  ).rows[0].lifecycle_revision as number;
  expect(
    (
      await post(
        `/api/teams/${f.teamId}/runners/${f.runnerId}/revoke`,
        { expectedLifecycleRevision: revision },
        f.cookie,
      )
    ).statusCode,
  ).toBe(200);
}
async function blockedBy(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      (
        await db.pool.query<{ blocked: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))) AS blocked",
          [pid],
        )
      ).rows[0]!.blocked
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Expected a database lock wait.");
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool, sessionStreamMilliseconds: 2500 });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (app) await app.close();
  if (db) await db.close();
});

describe("durable deterministic sessions", () => {
  it("previews without writes, validates actual input names/types, and snapshots immutable pins", async () => {
    const f = await setup();
    const { id: _, ...preview } = f.input;
    const before = await counts();
    const result = await post(
      `/api/teams/${f.teamId}/session-previews`,
      preview,
      f.cookie,
    );
    expect(result.statusCode).toBe(200);
    const pinned = SessionPreviewResponseSchema.parse(result.json());
    expect(pinned.snapshot.flow.definition).toEqual(f.definition);
    expect(pinned.snapshot.workspace.resourceId).toBe(f.workspace.id);
    expect(pinned.snapshot.agents).toHaveLength(1);
    expect(await counts()).toEqual(before);
    for (const inputValues of [
      {
        task: { type: "json", value: "wrong" },
        settings: preview.inputValues.settings,
      },
      { task: preview.inputValues.task },
      { ...preview.inputValues, extra: { type: "text", value: "unexpected" } },
    ])
      expect(
        (
          await post(
            `/api/teams/${f.teamId}/session-previews`,
            { ...preview, inputValues },
            f.cookie,
          )
        ).statusCode,
      ).toBe(400);
    const saved = await started(f);
    expect(saved.snapshot).toEqual(pinned.snapshot);
    expect(saved.quality).toBe("not_evaluated");
    expect(saved.state).toBe("queued");
    expect(saved.stageResults).toEqual({});
  });

  it("replays identical concurrent starts once and keeps copied definitions after catalog archival", async () => {
    const f = await setup();
    const results = await Promise.all([
      post(base(f.teamId), f.input, f.cookie),
      post(base(f.teamId), f.input, f.cookie),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(await counts()).toEqual({
      sessions: 1,
      leases: 0,
      events: 1,
      audits: 1,
    });
    await db.pool.query(
      "UPDATE resources SET archived_at=clock_timestamp(),lifecycle_revision=lifecycle_revision+1 WHERE id=$1",
      [f.flow.id],
    );
    const repeated = await post(base(f.teamId), f.input, f.cookie);
    expect(repeated.statusCode).toBe(200);
    expect(
      SessionResponseSchema.parse(repeated.json()).session.snapshot.flow
        .definition,
    ).toEqual(f.definition);
    expect(
      (
        await post(
          base(f.teamId),
          {
            ...f.input,
            inputValues: {
              ...f.input.inputValues,
              task: { type: "text", value: "changed" },
            },
          },
          f.cookie,
        )
      ).statusCode,
    ).toBe(409);
    expect(
      (await post(base(f.teamId), { ...f.input, id: randomUUID() }, f.cookie))
        .statusCode,
    ).toBe(400);
    await expect(
      db.pool.query(
        "UPDATE execution_sessions SET input_values='{}'::jsonb WHERE id=$1",
        [f.input.id],
      ),
    ).rejects.toThrow("ARK_IMMUTABLE_SESSION_SNAPSHOT");
  });

  it("persists a queued session across API restart and replays its start before claiming", async () => {
    const f = await setup();
    const queued = await started(f);
    const eventPath = `${base(f.teamId)}/${queued.id}/event-log`;
    const initialEvents = SessionEventLogResponseSchema.parse(
      (await get(eventPath, f.cookie)).json(),
    );
    expect(initialEvents.events.map((entry) => entry.kind)).toEqual([
      "created",
    ]);
    const initialCounts = await counts();

    await app.close();
    app = await buildApp({ pool: db.pool, sessionStreamMilliseconds: 2500 });
    expect(await current(f)).toEqual(queued);
    const repeated = await post(base(f.teamId), f.input, f.cookie);
    expect(repeated.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(repeated.json()).session).toEqual(
      queued,
    );
    expect(
      SessionEventLogResponseSchema.parse(
        (await get(eventPath, f.cookie)).json(),
      ),
    ).toEqual(initialEvents);
    expect(await counts()).toEqual(initialCounts);

    const assigned = await claim(f);
    expect(assigned.job!.session.id).toBe(queued.id);
    expect(assigned.job!.session.state).toBe("running");
    expect(assigned.job!.session.snapshot).toEqual(queued.snapshot);
    const accepted = await stage(f, assigned.job!, assigned.input);
    const recordedCounts = await counts();
    await app.close();
    app = await buildApp({ pool: db.pool, sessionStreamMilliseconds: 2500 });
    expect(await current(f)).toEqual(accepted.job.session);
    expect(
      SessionJobSchema.parse((await advance(f, accepted.payload)).json()),
    ).toEqual(accepted.job);
    expect(await counts()).toEqual(recordedCounts);
  });

  it.each(["admin", "developer", "reviewer", "viewer"] as const)(
    "enforces %s start permission while allowing explicit team reads",
    async (role) => {
      const f = await setup();
      await started(f);
      const m = await member(f, role);
      expect((await get(base(f.teamId), m.cookie)).statusCode).toBe(200);
      expect(
        (await get(`${base(f.teamId)}/${f.input.id}`, m.cookie)).statusCode,
      ).toBe(200);
      expect(
        (await get(`${base(f.teamId)}/${f.input.id}/event-log`, m.cookie))
          .statusCode,
      ).toBe(200);
      expect(
        (await post(base(f.teamId), { ...f.input, id: randomUUID() }, m.cookie))
          .statusCode,
      ).toBe(403);
      if (role === "admin" || role === "developer") {
        await db.pool.query(
          "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
          [f.runnerId, f.teamId, f.me.organization.id, m.id],
        );
        expect(
          (
            await post(
              base(f.teamId),
              { ...f.input, id: randomUUID() },
              m.cookie,
            )
          ).statusCode,
        ).toBe(201);
      }
    },
  );

  it("denies unshared teams, unknown sessions, unauthenticated reads and credential-realm substitution", async () => {
    const f = await setup();
    await started(f);
    const foreignTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Unshared')",
      [foreignTeam, f.me.organization.id],
    );
    expect((await get(base(foreignTeam), f.cookie)).statusCode).toBe(404);
    expect(
      (await get(`${base(foreignTeam)}/${f.input.id}`, f.cookie)).statusCode,
    ).toBe(404);
    expect(
      (await get(`${base(f.teamId)}/${randomUUID()}`, f.cookie)).statusCode,
    ).toBe(404);
    expect((await get(base(f.teamId))).statusCode).toBe(401);
    expect(
      (
        await get(base(f.teamId), undefined, {
          authorization: `Bearer ${f.credential}`,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await post("/api/runner/sessions/claim", claimInput(), f.cookie))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await post(
          "/api/runner/sessions/claim",
          claimInput(),
          undefined,
          `Bearer ${f.enrollmentToken}`,
        )
      ).statusCode,
    ).toBe(401);
  });

  it("requires current grants at claim but ignores a starter's subsequent browser logout", async () => {
    const f = await setup();
    await started(f);
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, f.me.user.id],
    );
    expect((await claim(f)).job).toBeNull();
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=true WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, f.me.user.id],
    );
    expect((await post("/api/auth/logout", {}, f.cookie)).statusCode).toBe(204);
    expect((await claim(f)).job?.session.state).toBe("running");
  });

  it("serializes competing claims, persists only a token hash, and replays assignments across restart", async () => {
    const f = await setup();
    await started(f);
    await started(f, { ...f.input, id: randomUUID() });
    const a = claimInput(),
      b = claimInput();
    const result = await Promise.all([claim(f, a), claim(f, b)]);
    expect(result.filter((r) => r.job)).toHaveLength(1);
    const chosen = result.find((r) => r.job)!;
    const held = (await db.pool.query("SELECT * FROM session_leases")).rows;
    expect(held).toHaveLength(1);
    expect(held[0].token_hash).toBe(sha(chosen.input.leaseToken));
    expect(JSON.stringify(held)).not.toContain(chosen.input.leaseToken);
    expect(
      JSON.stringify(
        (await db.pool.query("SELECT receipt FROM execution_events")).rows,
      ),
    ).not.toContain(chosen.input.leaseToken);
    await app.close();
    app = await buildApp({ pool: db.pool, sessionStreamMilliseconds: 2500 });
    const replay = await claim(f, chosen.input);
    expect(replay.job).toEqual(chosen.job);
  });

  it("rejects claim identity reuse with a different token without disclosing the assignment", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    const result = await post(
      "/api/runner/sessions/claim",
      { ...c.input, leaseToken: secret() },
      undefined,
      `Bearer ${f.credential}`,
    );
    expect(result.statusCode).toBe(409);
    expect(result.body).not.toContain(f.input.id);
    expect(await counts()).toEqual({
      sessions: 1,
      leases: 1,
      events: 2,
      audits: 2,
    });
  });

  it("skips an ineligible queued starter without starving later authorized work", async () => {
    const f = await setup();
    const starter = await member(f, "developer");
    await db.pool.query(
      "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
      [f.runnerId, f.teamId, f.me.organization.id, starter.id],
    );
    const first = await started(f, f.input, starter.cookie);
    const second = await started(f, { ...f.input, id: randomUUID() });
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, starter.id],
    );
    const assigned = await claim(f);
    expect(assigned.job!.session.id).toBe(second.id);
    expect((await current(f, first.id)).state).toBe("queued");
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=true WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, starter.id],
    );
    expect((await claim(f)).job).toBeNull();
  });

  it("validates server-side stub stages and replays stage/final receipts without duplicating events", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    let job = c.job!;
    const bad = {
      ...fields(job, c.input),
      kind: "stage_completed",
      stageId: f.definition.stages[0]!.id,
      outputs: { note: { type: "text", value: "fabricated" } },
    };
    expect((await advance(f, bad)).statusCode).toBe(400);
    expect(
      (
        await advance(f, {
          ...fields(job, c.input),
          kind: "completed",
          confirmedStopped: true,
        })
      ).statusCode,
    ).toBe(409);
    const first = await stage(f, job, c.input);
    job = first.job;
    const before = await counts();
    expect(
      SessionJobSchema.parse((await advance(f, first.payload)).json()),
    ).toEqual(job);
    expect(await counts()).toEqual(before);
    expect(
      (
        await advance(f, {
          ...first.payload,
          outputs: { note: { type: "text", value: "different" } },
        })
      ).statusCode,
    ).toBe(409);
    job = await completeStages(f, job, c.input);
    const expected = stubFinalOutputs(job.session);
    const payload = {
      ...fields(job, c.input),
      kind: "completed",
      confirmedStopped: true,
    };
    const completed = await advance(f, payload);
    expect(completed.statusCode).toBe(200);
    const final = SessionJobSchema.parse(completed.json());
    expect(final.session.state).toBe("completed");
    expect(final.session.outputs).toEqual(expected);
    expect(final.session.quality).toBe("not_evaluated");
    expect(final.lease.status).toBe("released");
    const finalCounts = await counts();
    expect(SessionJobSchema.parse((await advance(f, payload)).json())).toEqual(
      final,
    );
    expect(await counts()).toEqual(finalCounts);
    expect((await claim(f, c.input)).job).toEqual(final);
    expect(
      (
        await advance(f, {
          ...fields(final, c.input),
          kind: "stopped",
          confirmedStopped: true,
        })
      ).statusCode,
    ).toBe(409);
  });

  it.each(["grant withdrawal", "lease expiry"] as const)(
    "identical stage receipt replay rechecks %s before allowing more work",
    async (cause) => {
      const f = await setup();
      await started(f);
      const claimed = await claim(f);
      const accepted = await stage(f, claimed.job!, claimed.input);
      const before = await counts();
      if (cause === "grant withdrawal")
        await db.pool.query(
          "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
          [f.runnerId, f.me.user.id],
        );
      else
        await db.pool.query(
          "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [accepted.job.lease.id],
        );

      // Replay the exact accepted request, including its older revision, before
      // the engine has observed either change. A receipt cannot renew authority.
      const repeated = await advance(f, accepted.payload);
      expect(repeated.statusCode).toBe(200);
      const blocked = SessionJobSchema.parse(repeated.json());
      expect(blocked.session.state).toBe("blocked");
      expect(blocked.session.blockReason).toBe(
        cause === "grant withdrawal" ? "permission_changed" : "lease_expired",
      );
      expect(blocked.lease.status).toBe("uncertain");
      expect(blocked.session.stageIndex).toBe(accepted.job.session.stageIndex);
      expect(blocked.session.stageResults).toEqual(
        accepted.job.session.stageResults,
      );
      expect((await counts()).events).toBe(before.events + 1);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM execution_events WHERE session_id=$1 AND kind='stage_completed'",
            [f.input.id],
          )
        ).rows[0].count,
      ).toBe(1);
      expect(
        (
          await db.pool.query(
            "SELECT count(*)::int AS count FROM execution_events WHERE session_id=$1 AND kind='lease_uncertain'",
            [f.input.id],
          )
        ).rows[0].count,
      ).toBe(1);
      const after = await counts();
      expect(
        SessionJobSchema.parse((await advance(f, accepted.payload)).json()),
      ).toEqual(blocked);
      expect(await counts()).toEqual(after);
    },
  );

  it("rejects wrong lease tokens, generations, out-of-order stages and stale session revisions", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    const job = c.job!;
    const payload = {
      ...fields(job, c.input),
      kind: "stage_completed",
      stageId: f.definition.stages[0]!.id,
      outputs: stubStageOutputs(job.session),
    };
    expect(
      (await advance(f, { ...payload, leaseToken: secret() })).statusCode,
    ).toBe(401);
    expect((await advance(f, { ...payload, generation: 2 })).statusCode).toBe(
      409,
    );
    expect(
      (await advance(f, { ...payload, expectedRevision: 1 })).statusCode,
    ).toBe(409);
    expect(
      (await advance(f, { ...payload, stageId: f.definition.stages[1]!.id }))
        .statusCode,
    ).toBe(400);
    expect((await current(f)).stageIndex).toBe(0);
  });

  it("cancels queued work immediately and holds active cancellation until confirmed stopped", async () => {
    const f = await setup();
    const queued = await started(f);
    const cancelled = await post(
      `${base(f.teamId)}/${queued.id}/cancel`,
      { expectedRevision: 1 },
      f.cookie,
    );
    expect(cancelled.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(cancelled.json()).session.state).toBe(
      "cancelled",
    );
    expect((await claim(f)).job).toBeNull();
    const active = await started(f, { ...f.input, id: randomUUID() });
    const c = await claim(f);
    const cancel = await post(
      `${base(f.teamId)}/${active.id}/cancel`,
      { expectedRevision: c.job!.session.revision },
      f.cookie,
    );
    expect(cancel.statusCode).toBe(200);
    const replay = await claim(f, c.input);
    expect(replay.job!.session.state).toBe("cancelling");
    expect(replay.job!.lease.status).toBe("active");
    expect((await claim(f)).job).toBeNull();
    const stopped = SessionJobSchema.parse(
      (
        await advance(f, {
          ...fields(replay.job!, c.input),
          kind: "stopped",
          confirmedStopped: true,
        })
      ).json(),
    );
    expect(stopped.session.state).toBe("cancelled");
    expect(stopped.lease.status).toBe("released");
  });

  it("allows admins and the eligible starter to cancel while denying unrelated developers", async () => {
    const f = await setup();
    const starter = await member(f, "developer"),
      other = await member(f, "developer");
    await db.pool.query(
      "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
      [f.runnerId, f.teamId, f.me.organization.id, starter.id],
    );
    const row = await started(f, f.input, starter.cookie);
    expect(
      (
        await post(
          `${base(f.teamId)}/${row.id}/cancel`,
          { expectedRevision: 1 },
          other.cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          `${base(f.teamId)}/${row.id}/cancel`,
          { expectedRevision: 1 },
          starter.cookie,
        )
      ).statusCode,
    ).toBe(200);
    const next = await started(
      f,
      { ...f.input, id: randomUUID() },
      starter.cookie,
    );
    expect(
      (
        await post(
          `${base(f.teamId)}/${next.id}/cancel`,
          { expectedRevision: 1 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
  });

  it("expires into uncertainty without releasing ownership and records late output only as recovery evidence", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    await started(f, { ...f.input, id: randomUUID() });
    await db.pool.query(
      "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [c.job!.lease.id],
    );
    expect(await service().expireLeases()).toBe(1);
    expect(await service().expireLeases()).toBe(0);
    const blocked = (await claim(f, c.input)).job!;
    expect(blocked.session.state).toBe("blocked");
    expect(blocked.session.blockReason).toBe("lease_expired");
    expect(blocked.lease.status).toBe("uncertain");
    expect((await claim(f)).job).toBeNull();
    const late = {
      ...fields(blocked, c.input),
      kind: "stage_completed",
      stageId: f.definition.stages[0]!.id,
      outputs: stubStageOutputs(blocked.session),
    };
    const recovery = SessionJobSchema.parse((await advance(f, late)).json());
    expect(recovery.session.state).toBe("blocked");
    expect(recovery.session.stageIndex).toBe(0);
    expect(recovery.session.stageResults).toEqual({});
    const events = SessionEventLogResponseSchema.parse(
      (await get(`${base(f.teamId)}/${f.input.id}/event-log`, f.cookie)).json(),
    ).events;
    expect(events.at(-1)!.kind).toBe("recovery_recorded");
    const stopped = SessionJobSchema.parse(
      (
        await advance(f, {
          ...fields(recovery, c.input),
          kind: "stopped",
          confirmedStopped: true,
        })
      ).json(),
    );
    expect(stopped.session.state).toBe("failed");
    expect(stopped.lease.status).toBe("released");
    expect((await claim(f)).job?.session.state).toBe("running");
  });

  it("withdrawn approval blocks ordinary progress but still permits stopped acknowledgement", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    await db.pool.query(
      "UPDATE runners SET dispatch_approved=false WHERE id=$1",
      [f.runnerId],
    );
    const payload = {
      ...fields(c.job!, c.input),
      kind: "stage_completed",
      stageId: f.definition.stages[0]!.id,
      outputs: stubStageOutputs(c.job!.session),
    };
    const blocked = SessionJobSchema.parse((await advance(f, payload)).json());
    expect(blocked.session.state).toBe("blocked");
    expect(blocked.session.blockReason).toBe("permission_changed");
    expect(blocked.session.stageIndex).toBe(0);
    const stopped = await advance(f, {
      ...fields(blocked, c.input),
      kind: "stopped",
      confirmedStopped: true,
    });
    expect(stopped.statusCode).toBe(200);
    expect(SessionJobSchema.parse(stopped.json()).lease.status).toBe(
      "released",
    );
  });

  it("requires revoked runner plus admin confirmation to manually reconcile lost work", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    const other = await member(f, "developer");
    await db.pool.query(
      "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [c.job!.lease.id],
    );
    await service().expireLeases();
    const blocked = await current(f);
    const path = `${base(f.teamId)}/${blocked.id}/reconcile`;
    expect(
      (
        await post(
          path,
          { expectedRevision: blocked.revision, confirmedStopped: true },
          other.cookie,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await post(
          path,
          { expectedRevision: blocked.revision, confirmedStopped: true },
          f.cookie,
        )
      ).statusCode,
    ).toBe(409);
    await revokeRunner(f);
    expect(
      (
        await post(
          path,
          { expectedRevision: blocked.revision, confirmedStopped: false },
          f.cookie,
        )
      ).statusCode,
    ).toBe(400);
    const result = await post(
      path,
      { expectedRevision: blocked.revision, confirmedStopped: true },
      f.cookie,
    );
    expect(result.statusCode).toBe(200);
    expect(SessionResponseSchema.parse(result.json()).session.state).toBe(
      "failed",
    );
    expect(
      (
        await advance(f, {
          ...fields(c.job!, c.input),
          kind: "stopped",
          confirmedStopped: true,
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await db.pool.query("SELECT status FROM session_leases WHERE id=$1", [
          c.job!.lease.id,
        ])
      ).rows[0].status,
    ).toBe("released");
  });

  it("serializes completion against cancellation and never reopens a terminal session", async () => {
    const f = await setup();
    await started(f);
    const c = await claim(f);
    const job = await completeStages(f, c.job!, c.input);
    const results = await Promise.all([
      advance(f, {
        ...fields(job, c.input),
        kind: "completed",
        confirmedStopped: true,
      }),
      post(
        `${base(f.teamId)}/${job.session.id}/cancel`,
        { expectedRevision: job.session.revision },
        f.cookie,
      ),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const final = await current(f);
    if (final.state === "completed") expect(final.outputs).not.toBeNull();
    else {
      expect(final.state).toBe("cancelling");
      const replay = (await claim(f, c.input)).job!;
      expect(
        SessionJobSchema.parse(
          (
            await advance(f, {
              ...fields(replay, c.input),
              kind: "stopped",
              confirmedStopped: true,
            })
          ).json(),
        ).session.state,
      ).toBe("cancelled");
    }
    const ending = await current(f);
    expect(
      (
        await post(
          `${base(f.teamId)}/${ending.id}/cancel`,
          { expectedRevision: ending.revision },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    expect((await current(f)).state).toBe(ending.state);
  });

  it("rechecks a grant recipient's membership after a claim waits on its identity lock", async () => {
    const f = await setup();
    const starter = await member(f, "developer");
    await db.pool.query(
      "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
      [f.runnerId, f.teamId, f.me.organization.id, starter.id],
    );
    await started(f, f.input, starter.cookie);
    const locker = await db.pool.connect();
    let pending: ReturnType<typeof claim> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query(
        "SELECT 1 FROM team_memberships WHERE team_id=$1 AND user_id=$2 FOR UPDATE",
        [f.teamId, starter.id],
      );
      pending = claim(f);
      await blockedBy(pid);
      await locker.query(
        "UPDATE team_memberships SET role='viewer' WHERE team_id=$1 AND user_id=$2",
        [f.teamId, starter.id],
      );
      await locker.query("COMMIT");
      expect((await pending).job).toBeNull();
      expect((await counts()).leases).toBe(0);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });

  it("rejects an expired Start actor after waiting for the runner lock", async () => {
    const f = await setup();
    const locker = await db.pool.connect();
    let pending: ReturnType<typeof post> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query("SELECT 1 FROM runners WHERE id=$1 FOR UPDATE", [
        f.runnerId,
      ]);
      const token = f.cookie.slice("ark_session=".length);
      await db.pool.query(
        "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE token_hash=$1",
        [sessionTokenHash(token)],
      );
      pending = post(base(f.teamId), f.input, f.cookie);
      await blockedBy(pid);
      await locker.query("SELECT pg_sleep(2.1)");
      await locker.query("COMMIT");
      expect((await pending).statusCode).toBe(401);
      expect(await counts()).toEqual({
        sessions: 0,
        leases: 0,
        events: 0,
        audits: 0,
      });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });

  it.each(["start", "stage", "completion"] as const)(
    "rolls back %s when event storage or response validation fails",
    async (operation) => {
      const f = await setup();
      let c: Awaited<ReturnType<typeof claim>> | undefined;
      let job: SessionJob | undefined;
      if (operation !== "start") {
        await started(f);
        c = await claim(f);
        job = c.job!;
        if (operation === "completion")
          job = await completeStages(f, job, c.input);
      }
      const before = await counts();
      const saved = operation === "start" ? undefined : await current(f);
      if (operation === "completion") {
        await db.pool.query(
          "CREATE FUNCTION invalid_session_timestamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at='infinity'::timestamptz; RETURN NEW; END $$",
        );
        await db.pool.query(
          "CREATE TRIGGER invalid_session_timestamp BEFORE UPDATE ON execution_sessions FOR EACH ROW EXECUTE FUNCTION invalid_session_timestamp()",
        );
      } else {
        await db.pool.query(
          "CREATE FUNCTION reject_session_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Rejected event fixture'; END $$",
        );
        await db.pool.query(
          "CREATE TRIGGER reject_session_event BEFORE INSERT ON execution_events FOR EACH ROW EXECUTE FUNCTION reject_session_event()",
        );
      }
      const result =
        operation === "start"
          ? await post(base(f.teamId), f.input, f.cookie)
          : operation === "stage"
            ? await advance(f, {
                ...fields(job!, c!.input),
                kind: "stage_completed",
                stageId: f.definition.stages[0]!.id,
                outputs: stubStageOutputs(job!.session),
              })
            : await advance(f, {
                ...fields(job!, c!.input),
                kind: "completed",
                confirmedStopped: true,
              });
      expect(result.statusCode).toBe(500);
      expect(result.body).not.toContain("Rejected event fixture");
      expect(await counts()).toEqual(before);
      if (saved) expect(await current(f)).toEqual(saved);
    },
  );

  it("provides durable ordered event-log and session-bound SSE replay while rejecting mismatched cursors", async () => {
    const f = await setup();
    const initial = await started(f);
    const viewer = await member(f, "viewer");
    await post(
      `${base(f.teamId)}/${initial.id}/cancel`,
      { expectedRevision: initial.revision },
      f.cookie,
    );
    const events = SessionEventLogResponseSchema.parse(
      (
        await get(
          `${base(f.teamId)}/${initial.id}/event-log?after=0`,
          viewer.cookie,
        )
      ).json(),
    );
    expect(events.events.map((e) => e.sequence)).toEqual([1, 2]);
    const path = `${base(f.teamId)}/${initial.id}/events`;
    const streamed = await get(`${path}?after=${initial.id}:1`, viewer.cookie);
    expect(streamed.statusCode).toBe(200);
    expect(streamed.headers["content-type"]).toContain("text/event-stream");
    expect(streamed.body).toContain(`id: ${initial.id}:2`);
    expect(streamed.body).not.toContain(`id: ${initial.id}:1`);
    expect(
      (await get(path, viewer.cookie, { "last-event-id": `${initial.id}:1` }))
        .body,
    ).toContain(`id: ${initial.id}:2`);
    for (const query of [
      `?after=${randomUUID()}:1`,
      `?after=${initial.id}:01`,
      `?after=${initial.id}:999`,
      `?after=invalid`,
    ])
      expect((await get(path + query, viewer.cookie)).statusCode).toBe(400);
    expect(
      (
        await get(`${path}?after=${initial.id}:1`, viewer.cookie, {
          "last-event-id": `${initial.id}:0`,
        })
      ).statusCode,
    ).toBe(400);
  });

  it("rejects final line terminators in event-log and SSE cursor queries", async () => {
    const f = await setup();
    const initial = await started(f);
    // Keep the session terminal so a regressed SSE parser cannot leave this
    // negative-format check waiting for the ordinary stream lifetime.
    expect(
      (
        await post(
          `${base(f.teamId)}/${initial.id}/cancel`,
          { expectedRevision: initial.revision },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    const path = `${base(f.teamId)}/${initial.id}`;
    for (const terminator of ["\n", "\r", "\u2028", "\u2029"]) {
      expect(
        (
          await get(
            `${path}/event-log?after=${encodeURIComponent(`1${terminator}`)}`,
            f.cookie,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await get(
            `${path}/events?after=${encodeURIComponent(`${initial.id}:1${terminator}`)}`,
            f.cookie,
          )
        ).statusCode,
      ).toBe(400);
    }
  });

  it.each(["logout", "membership"] as const)(
    "closes a real HTTP stream on midstream %s without delivering later private events",
    async (reason) => {
      const f = await setup();
      await started(f);
      const viewer = await member(f, "viewer");
      const endpoint = await app.listen({ host: "127.0.0.1", port: 0 });
      // node:fetch does not preserve a caller-supplied Host for this request.
      // Native HTTP lets the ephemeral listener retain the production allowlist.
      const result = await new Promise<IncomingMessage>((resolve, reject) => {
        const request = httpGet(
          `${endpoint}${base(f.teamId)}/${f.input.id}/events`,
          {
            headers: { Host: headers.host, cookie: viewer.cookie },
            signal: AbortSignal.timeout(6000),
          },
          resolve,
        );
        request.once("error", reject);
      });
      expect(result.statusCode).toBe(200);
      const reader = result[Symbol.asyncIterator](),
        decoder = new TextDecoder();
      let body = "";
      while (!body.includes(`id: ${f.input.id}:1`)) {
        const chunk = await reader.next();
        expect(chunk.done).toBe(false);
        body += decoder.decode(chunk.value);
      }
      if (reason === "logout")
        expect(
          (await post("/api/auth/logout", {}, viewer.cookie)).statusCode,
        ).toBe(204);
      else
        await db.pool.query(
          "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE team_id=$1 AND user_id=$2",
          [f.teamId, viewer.id],
        );
      expect(
        (
          await post(
            `${base(f.teamId)}/${f.input.id}/cancel`,
            { expectedRevision: 1 },
            f.cookie,
          )
        ).statusCode,
      ).toBe(200);
      for (;;) {
        const chunk = await reader.next();
        if (chunk.done) break;
        body += decoder.decode(chunk.value);
      }
      expect(body).not.toContain(`id: ${f.input.id}:2`);
      expect(body).not.toContain("cancelled");
      expect(
        (await get(`${base(f.teamId)}/${f.input.id}/event-log`, viewer.cookie))
          .statusCode,
      ).toBe(reason === "logout" ? 401 : 404);
    },
  );

  it("works under runtime privileges while denying event tampering, snapshot changes, deletion and DDL", async () => {
    const f = await setup();
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
        `GRANT UPDATE ON "${db.schema}".users,"${db.schema}".organization_memberships,"${db.schema}".teams,"${db.schema}".team_memberships,"${db.schema}".auth_sessions,"${db.schema}".resources,"${db.schema}".runners TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT,UPDATE ON "${db.schema}".execution_sessions,"${db.schema}".session_leases TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT ON "${db.schema}".execution_events,"${db.schema}".audit_events TO "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime, sessionStreamMilliseconds: 2500 });
      const saved = await started(f);
      const c = await claim(f);
      let job = await completeStages(f, c.job!, c.input);
      const completed = await advance(f, {
        ...fields(job, c.input),
        kind: "completed",
        confirmedStopped: true,
      });
      expect(completed.statusCode).toBe(200);
      job = SessionJobSchema.parse(completed.json());
      expect(job.session.outputs).not.toBeNull();
      const list = SessionListResponseSchema.parse(
        (await get(base(f.teamId), f.cookie)).json(),
      );
      expect(list.sessions[0]!.id).toBe(saved.id);
      for (const sql of [
        "DELETE FROM execution_sessions",
        "DELETE FROM session_leases",
        "UPDATE execution_events SET kind='failed'",
        "DELETE FROM execution_events",
        "CREATE TABLE forbidden_session_table(id integer)",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      await expect(
        runtime.query(
          "UPDATE execution_sessions SET snapshot='{}'::jsonb WHERE id=$1",
          [saved.id],
        ),
      ).rejects.toThrow("ARK_IMMUTABLE_SESSION_SNAPSHOT");
      const receipts = JSON.stringify(
        (await runtime.query("SELECT receipt FROM execution_events")).rows,
      );
      expect(receipts).not.toContain(c.input.leaseToken);
      expect(receipts).not.toContain(f.credential);
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });
});
