import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RepositoryExecutionPreviewResponseSchema,
  RepositoryExecutionResponseSchema,
  RepositoryExecutionListResponseSchema,
  RepositoryExecutionEventLogResponseSchema,
  RepositoryExecutionClaimResponseSchema,
  RepositoryExecutionJobSchema,
  RepositoryPlanResponseSchema,
  SessionClaimResponseSchema,
  SessionResponseSchema,
  WorkspaceResponseSchema,
  type MeResponse,
  type RepositoryExecutionClaimRequest,
  type StartRepositoryExecutionRequest,
  type WorkspaceDefinition,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import type { PoolClient } from "pg";
import { buildApp } from "../../apps/api/src/app.js";
import {
  newSessionToken,
  sessionTokenHash,
} from "../../apps/api/src/credentials.js";
import { IdentityService } from "../../apps/api/src/identity.js";
import { RepositoryExecutionService } from "../../apps/api/src/repository-executions.js";
import { SessionService } from "../../apps/api/src/sessions.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const machine = "/api/runner/repository-executions";
const base = (teamId: string) => `/api/teams/${teamId}/repository-executions`;
const previewPath = (teamId: string) =>
  `/api/teams/${teamId}/repository-execution-previews`;
const secret = () => randomBytes(32).toString("hex");
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const definition: WorkspaceDefinition = {
  name: "Preparation fixture",
  description: "Declared intent only.",
  repositoryUrl: "https://github.com/example/preparation-fixture.git",
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
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let fixtureActive = false;
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
const get = (url: string, cookie?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: { host: headers.host, ...(cookie ? { cookie } : {}) },
  });
function denied(
  result: Awaited<ReturnType<typeof post>>,
  status: number,
  code?: string,
) {
  expect(result.statusCode).toBe(status);
  if (code) expect(result.json().error.code).toBe(code);
}

async function runner(teamId: string, cookie: string, userId: string) {
  const id = randomUUID();
  const enrollmentToken = `ark_enroll_${id}_${secret()}`;
  const credential = `ark_runner_${id}_${secret()}`;
  expect(
    (
      await post(
        `/api/teams/${teamId}/runner-enrollments`,
        { id, name: "Preparation runner", enrollmentToken },
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
        `/api/teams/${teamId}/runners/${id}/dispatch-approval`,
        { expectedLifecycleRevision: 2, approved: true },
        cookie,
      )
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await post(
        `/api/teams/${teamId}/runners/${id}/grants/${userId}`,
        { expectedLifecycleRevision: 3, granted: true },
        cookie,
      )
    ).statusCode,
  ).toBe(200);
  return { id, credential, enrollmentToken };
}
async function setup() {
  const boot = await post("/api/bootstrap", {
    ownerName: "Preparation Owner",
    email: "owner@example.test",
    password: "test-only-long-password",
    organizationName: "Preparation Tests",
    teamName: "Alpha",
  });
  expect(boot.statusCode).toBe(201);
  const me = boot.json<MeResponse>();
  const teamId = me.teams[0]!.id;
  const cookie = String(boot.headers["set-cookie"]).split(";")[0]!;
  const workspaceResult = await post(
    `/api/teams/${teamId}/workspaces`,
    { id: randomUUID(), schemaVersion: 1, definition },
    cookie,
  );
  expect(workspaceResult.statusCode).toBe(201);
  const workspace = WorkspaceResponseSchema.parse(
    workspaceResult.json(),
  ).workspace;
  const planResult = await post(
    `/api/teams/${teamId}/repository-plans`,
    {
      id: randomUUID(),
      workspace: { resourceId: workspace.id, versionId: workspace.versionId },
      selection: {
        action: "test",
        commitOid: "a".repeat(40),
        imageDigest: `node@sha256:${"b".repeat(64)}`,
      },
    },
    cookie,
  );
  expect(planResult.statusCode).toBe(201);
  const repositoryPlan = RepositoryPlanResponseSchema.parse(
    planResult.json(),
  ).repositoryPlan;
  const enrolled = await runner(teamId, cookie, me.user.id);
  const input: StartRepositoryExecutionRequest = {
    id: randomUUID(),
    repositoryPlanId: repositoryPlan.id,
    expectedPlanDigest: repositoryPlan.planDigest,
    runnerId: enrolled.id,
  };
  return {
    me,
    teamId,
    cookie,
    workspace,
    repositoryPlan,
    input,
    runnerId: enrolled.id,
    credential: enrolled.credential,
    enrollmentToken: enrolled.enrollmentToken,
  };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
type Job = ReturnType<typeof RepositoryExecutionJobSchema.parse>;
async function member(
  f: Fixture,
  role: "admin" | "developer" | "reviewer" | "viewer",
  grant = false,
  scope = { teamId: f.teamId, organizationId: f.me.organization.id },
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) SELECT $1,$2,'Preparation Member',password_hash FROM users WHERE id=$3",
    [id, `${id}@example.test`, f.me.user.id],
  );
  await db.pool.query(
    "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'member')",
    [scope.organizationId, id],
  );
  await db.pool.query(
    "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,$4)",
    [scope.teamId, id, scope.organizationId, role],
  );
  const token = newSessionToken();
  await db.pool.query(
    "INSERT INTO auth_sessions(user_id,organization_id,token_hash,expires_at) VALUES($1,$2,$3,clock_timestamp()+interval '1 hour')",
    [id, scope.organizationId, sessionTokenHash(token)],
  );
  if (grant)
    await db.pool.query(
      "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
      [f.runnerId, f.teamId, f.me.organization.id, id],
    );
  return { id, cookie: `ark_session=${token}` };
}
async function start(f: Fixture, input = f.input, cookie = f.cookie) {
  const result = await post(base(f.teamId), input, cookie);
  expect(result.statusCode).toBe(201);
  return RepositoryExecutionResponseSchema.parse(result.json())
    .repositoryExecution;
}
const previewInput = (f: Fixture) => ({
  repositoryPlanId: f.input.repositoryPlanId,
  expectedPlanDigest: f.input.expectedPlanDigest,
  runnerId: f.runnerId,
});
const claimInput = (): RepositoryExecutionClaimRequest => ({
  claimId: randomUUID(),
  leaseToken: secret(),
  runtime: "repository.v1" as const,
  policy: "docker-linux-offline.v1" as const,
});
const claim = (f: Fixture, input = claimInput(), credential = f.credential) =>
  post(`${machine}/claim`, input, undefined, `Bearer ${credential}`);
async function claimed(f: Fixture, input = claimInput()) {
  const result = await claim(f, input);
  expect(result.statusCode).toBe(200);
  const parsed = RepositoryExecutionClaimResponseSchema.parse(result.json());
  expect(parsed.job).not.toBeNull();
  return { input, job: parsed.job! };
}
function controlInput(job: Job) {
  return {
    controlId: randomUUID(),
    executionId: job.execution.id,
    leaseId: job.lease.id,
    leaseToken: "",
    generation: 1 as const,
    expectedControlSequence: job.lease.controlSequence,
    planDigest: job.execution.planDigest,
  };
}
const control = (
  f: Fixture,
  input: ReturnType<typeof controlInput>,
  credential = f.credential,
) => post(`${machine}/control`, input, undefined, `Bearer ${credential}`);
async function current(f: Fixture, id: string = f.input.id) {
  const result = await get(`${base(f.teamId)}/${id}`, f.cookie);
  expect(result.statusCode).toBe(200);
  return RepositoryExecutionResponseSchema.parse(result.json())
    .repositoryExecution;
}
async function events(f: Fixture, id = f.input.id, after = 0) {
  const result = await get(
    `${base(f.teamId)}/${id}/events?after=${after}`,
    f.cookie,
  );
  expect(result.statusCode).toBe(200);
  return RepositoryExecutionEventLogResponseSchema.parse(result.json());
}
const service = () =>
  new RepositoryExecutionService(db.pool, new IdentityService(db.pool, 43200));
async function counts() {
  return (
    await db.pool.query(
      "SELECT (SELECT count(*)::int FROM repository_executions) AS executions,(SELECT count(*)::int FROM repository_execution_events) AS events,(SELECT count(*)::int FROM repository_control_receipts) AS receipts,(SELECT count(*)::int FROM session_leases) AS leases,(SELECT count(*)::int FROM execution_sessions) AS stub_sessions,(SELECT count(*)::int FROM execution_events) AS stub_events,(SELECT count(*)::int FROM audit_events WHERE action LIKE 'repository_execution.%') AS audits,(SELECT count(*)::int FROM audit_events) AS all_audits",
    )
  ).rows[0] as Record<string, number>;
}
async function stubQueued(f: Fixture) {
  const agentResult = await post(
    `/api/teams/${f.teamId}/agents`,
    {
      id: randomUUID(),
      schemaVersion: 1,
      definition: {
        name: `Stub ${randomUUID()}`,
        description: "",
        instructions: "Inert stub",
        runtime: "stub",
        modelPreference: null,
        capabilities: [],
      },
    },
    f.cookie,
  );
  expect(agentResult.statusCode).toBe(201);
  const agent = agentResult.json().agent as { id: string; versionId: string };
  const stageId = randomUUID();
  const flowResult = await post(
    `/api/teams/${f.teamId}/flows`,
    {
      id: randomUUID(),
      schemaVersion: 1,
      definition: {
        name: `Flow ${randomUUID()}`,
        description: "",
        workspace: {
          resourceId: f.workspace.id,
          versionId: f.workspace.versionId,
        },
        inputs: [{ name: "task", type: "text" }],
        stages: [
          {
            id: stageId,
            name: "Stub stage",
            agent: { resourceId: agent.id, versionId: agent.versionId },
            inputs: [
              {
                name: "task",
                type: "text",
                source: { kind: "flow_input", port: "task" },
              },
            ],
            outputs: [{ name: "report", type: "text" }],
          },
        ],
        outputs: [
          {
            name: "result",
            type: "text",
            source: { kind: "stage_output", stageId, port: "report" },
          },
        ],
      },
    },
    f.cookie,
  );
  expect(flowResult.statusCode).toBe(201);
  const flow = flowResult.json().flow as { id: string; versionId: string };
  const response = await post(
    `/api/teams/${f.teamId}/sessions`,
    {
      id: randomUUID(),
      flow: { resourceId: flow.id, versionId: flow.versionId },
      runnerId: f.runnerId,
      inputValues: { task: { type: "text", value: "No repository work" } },
    },
    f.cookie,
  );
  expect(response.statusCode).toBe(201);
  return SessionResponseSchema.parse(response.json()).session;
}
const stubClaimInput = () => ({
  claimId: randomUUID(),
  leaseToken: secret(),
  runtime: "stub.v1" as const,
});
async function stubClaim(f: Fixture, input = stubClaimInput()) {
  const result = await post(
    "/api/runner/sessions/claim",
    input,
    undefined,
    `Bearer ${f.credential}`,
  );
  expect(result.statusCode).toBe(200);
  return { input, ...SessionClaimResponseSchema.parse(result.json()) };
}
async function blockedBy(pid: number) {
  await expect
    .poll(
      async () =>
        (
          await db.pool.query<{ blocked: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))) AS blocked",
            [pid],
          )
        ).rows[0]!.blocked,
      { timeout: 5000, interval: 15 },
    )
    .toBe(true);
}

async function shiftExecutionClocks(
  executionId: string,
  claimedAgoSeconds: number,
) {
  // Synthetic deadline evidence only. The parent explicitly authorized this
  // exact fixture schema and named trigger; production immutability is tested
  // separately. Real preparation/run durations and cleanup remain untested.
  if (!/^ark_test_[a-f0-9]{20}$/.test(db.schema))
    throw new Error("Unsafe clock fixture schema.");
  await db.pool.query(
    `ALTER TABLE "${db.schema}".repository_executions DISABLE TRIGGER repository_execution_admission_immutable`,
  );
  try {
    await db.pool.query(
      `WITH anchor AS (SELECT clock_timestamp()-$2::double precision*interval '1 second' AS claimed) UPDATE "${db.schema}".repository_executions e SET claimed_at=anchor.claimed,run_deadline_at=anchor.claimed+interval '900 seconds',preparation_deadline_at=anchor.claimed+interval '120 seconds' FROM anchor WHERE e.id=$1`,
      [executionId, claimedAgoSeconds],
    );
  } finally {
    await db.pool.query(
      `ALTER TABLE "${db.schema}".repository_executions ENABLE TRIGGER repository_execution_admission_immutable`,
    );
  }
}
async function waitForLeaseDeadline(client: PoolClient, id: string) {
  await client.query(
    "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM session_leases WHERE id=$1",
    [id],
  );
}

beforeEach(async () => {
  db = await databaseFixture();
  fixtureActive = true;
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  vi.restoreAllMocks();
  try {
    if (app) await app.close();
  } finally {
    if (fixtureActive) {
      fixtureActive = false;
      const observer = createPool(db.connection);
      try {
        await db.close();
        expect(
          (
            await observer.query<{ present: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS present",
              [db.schema],
            )
          ).rows[0]!.present,
        ).toBe(false);
      } finally {
        await observer.end();
      }
    }
  }
});

describe("Repository execution admission and preparation control with PostgreSQL", () => {
  it("previews only with no execution, lease, event, receipt or audit writes and permits offline queuing", async () => {
    const f = await setup();
    const before = await counts();
    const result = await post(previewPath(f.teamId), previewInput(f), f.cookie);
    expect(result.statusCode).toBe(200);
    expect(
      RepositoryExecutionPreviewResponseSchema.parse(result.json()),
    ).toEqual({
      repositoryPlan: f.repositoryPlan,
      runnerId: f.runnerId,
      compatibility: "pending_runner_claim",
    });
    expect(await counts()).toEqual(before);
    const execution = await start(f);
    expect(execution).toMatchObject({
      state: "queued",
      compatibility: "pending_runner_claim",
      runtime: "repository.v1",
      policy: "docker-linux-offline.v1",
      claimedAt: null,
      runDeadlineAt: null,
      preparationDeadlineAt: null,
    });
    expect(await counts()).toMatchObject({
      executions: 1,
      events: 1,
      leases: 0,
      receipts: 0,
      stub_sessions: 0,
    });
  });

  it("requires an eligible admin/developer and their own grant for preview and Start", async () => {
    const f = await setup();
    for (const role of ["admin", "developer", "reviewer", "viewer"] as const) {
      const actor = await member(f, role, true);
      for (const path of [previewPath(f.teamId), base(f.teamId)]) {
        const result = await post(
          path,
          path === base(f.teamId)
            ? { ...f.input, id: randomUUID() }
            : previewInput(f),
          actor.cookie,
        );
        if (role === "admin" || role === "developer")
          expect(result.statusCode).toBe(path === base(f.teamId) ? 201 : 200);
        else expect(result.statusCode).toBe(403);
      }
    }
    const ungranted = await member(f, "admin");
    denied(
      await post(previewPath(f.teamId), previewInput(f), ungranted.cookie),
      403,
      "COMPUTE_FORBIDDEN",
    );
    denied(
      await post(
        base(f.teamId),
        { ...f.input, id: randomUUID() },
        ungranted.cookie,
      ),
      403,
      "COMPUTE_FORBIDDEN",
    );
  });

  it("allows every current team role to read detail/events and paginates fifty metadata summaries", async () => {
    const f = await setup();
    const saved = await start(f);
    for (const role of ["admin", "developer", "reviewer", "viewer"] as const) {
      const actor = await member(f, role);
      const listing = await get(base(f.teamId), actor.cookie);
      expect(listing.statusCode).toBe(200);
      const summary = RepositoryExecutionListResponseSchema.parse(
        listing.json(),
      ).repositoryExecutions[0]!;
      expect(summary.id).toBe(saved.id);
      expect(summary).not.toHaveProperty("plan");
      const detail = await get(`${base(f.teamId)}/${saved.id}`, actor.cookie);
      expect(detail.statusCode).toBe(200);
      expect(
        RepositoryExecutionResponseSchema.parse(detail.json())
          .repositoryExecution,
      ).toEqual(saved);
      const log = await get(
        `${base(f.teamId)}/${saved.id}/events`,
        actor.cookie,
      );
      expect(log.statusCode).toBe(200);
      expect(
        RepositoryExecutionEventLogResponseSchema.parse(log.json()).events,
      ).toHaveLength(1);
    }
    const ids = [
      saved.id,
      ...Array.from({ length: 50 }, () => randomUUID()),
    ].sort();
    for (const id of ids.filter((id) => id !== saved.id))
      await start(f, { ...f.input, id });
    const first = RepositoryExecutionListResponseSchema.parse(
      (await get(base(f.teamId), f.cookie)).json(),
    );
    expect(first.repositoryExecutions.map((item) => item.id)).toEqual(
      ids.slice(0, 50),
    );
    expect(first.nextCursor).toBe(ids[49]);
    expect(
      first.repositoryExecutions.every((item) => !Object.hasOwn(item, "plan")),
    ).toBe(true);
    const last = RepositoryExecutionListResponseSchema.parse(
      (
        await get(`${base(f.teamId)}?cursor=${first.nextCursor}`, f.cookie)
      ).json(),
    );
    expect(last.repositoryExecutions.map((item) => item.id)).toEqual(
      ids.slice(50),
    );
    expect(last.nextCursor).toBeNull();
  });

  it("denies absent, expired, disabled and revoked human authority on every protected operation", async () => {
    const f = await setup();
    await start(f);
    for (const item of [
      {
        sql: "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1",
        status: 401,
      },
      {
        sql: "UPDATE organization_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
        status: 401,
      },
      {
        sql: "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
        status: 404,
      },
      {
        sql: "UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1",
        status: 401,
      },
    ]) {
      const actor = await member(f, "developer", true);
      await db.pool.query(item.sql, [actor.id]);
      denied(await get(base(f.teamId), actor.cookie), item.status);
      denied(
        await get(`${base(f.teamId)}/${f.input.id}`, actor.cookie),
        item.status,
      );
      denied(
        await get(`${base(f.teamId)}/${f.input.id}/events`, actor.cookie),
        item.status,
      );
      denied(
        await post(previewPath(f.teamId), previewInput(f), actor.cookie),
        item.status,
      );
      denied(
        await post(
          base(f.teamId),
          { ...f.input, id: randomUUID() },
          actor.cookie,
        ),
        item.status,
      );
    }
    denied(await get(base(f.teamId)), 401);
    denied(await post(previewPath(f.teamId), previewInput(f)), 401);
  });

  it("isolates team and organization plans, runners and saved execution reads", async () => {
    const f = await setup();
    await start(f);
    const beta = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Beta')",
      [beta, f.me.organization.id],
    );
    denied(await get(base(beta), f.cookie), 404);
    const actor = await member(f, "admin", false, {
      teamId: beta,
      organizationId: f.me.organization.id,
    });
    denied(await get(`${base(beta)}/${f.input.id}`, actor.cookie), 404);
    denied(await post(previewPath(beta), previewInput(f), actor.cookie), 400);
    await db.pool.query(
      "ALTER TABLE organizations DROP CONSTRAINT organizations_singleton_key",
    );
    const organization = randomUUID();
    const foreignTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Foreign preparation')",
      [organization],
    );
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Foreign')",
      [foreignTeam, organization],
    );
    const foreign = await member(f, "admin", false, {
      teamId: foreignTeam,
      organizationId: organization,
    });
    denied(
      await get(`${base(foreignTeam)}/${f.input.id}`, foreign.cookie),
      404,
    );
    denied(
      await post(
        base(foreignTeam),
        { ...f.input, id: randomUUID() },
        foreign.cookie,
      ),
      400,
    );
    expect((await counts()).executions).toBe(1);
  });

  it("requires the exact plan digest and an active supported Workspace at new admission", async () => {
    const f = await setup();
    const mismatch = await post(
      previewPath(f.teamId),
      { ...previewInput(f), expectedPlanDigest: "c".repeat(64) },
      f.cookie,
    );
    denied(mismatch, 409, "PLAN_CONFLICT");
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2 WHERE id=$1",
      [f.workspace.versionId],
    );
    denied(await post(previewPath(f.teamId), previewInput(f), f.cookie), 400);
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=1 WHERE id=$1",
      [f.workspace.versionId],
    );
    expect(
      (
        await post(
          `/api/teams/${f.teamId}/workspaces/${f.workspace.id}/archive`,
          { revision: 1, lifecycleRevision: 1 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    denied(await post(base(f.teamId), f.input, f.cookie), 400);
    expect((await counts()).executions).toBe(0);
  });

  it("preserves immutable admitted intent and identical replay across catalog archive and API restart", async () => {
    const f = await setup();
    const saved = await start(f);
    const edit = await app.inject({
      method: "PUT",
      url: `/api/teams/${f.teamId}/workspaces/${f.workspace.id}`,
      headers: { ...headers, cookie: f.cookie },
      payload: {
        revision: 1,
        lifecycleRevision: 1,
        schemaVersion: 1,
        definition: {
          ...definition,
          actions: { ...definition.actions, test: "different inert command" },
        },
      },
    });
    expect(edit.statusCode).toBe(200);
    expect(
      (
        await post(
          `/api/teams/${f.teamId}/workspaces/${f.workspace.id}/archive`,
          { revision: 2, lifecycleRevision: 1 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    await app.close();
    app = await buildApp({ pool: db.pool });
    expect(await current(f)).toEqual(saved);
    const replay = await post(base(f.teamId), f.input, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().repositoryExecution).toEqual(saved);
    expect(saved.plan.action.command).toBe(definition.actions.test);
    expect((await counts()).events).toBe(1);
  });

  it("conflicts on changed creation details or creator while identical Start replay adds no event or audit", async () => {
    const f = await setup();
    await start(f);
    const before = await counts();
    expect((await post(base(f.teamId), f.input, f.cookie)).statusCode).toBe(
      200,
    );
    const actor = await member(f, "developer", true);
    denied(
      await post(base(f.teamId), f.input, actor.cookie),
      409,
      "ID_CONFLICT",
    );
    denied(
      await post(
        base(f.teamId),
        { ...f.input, runnerId: randomUUID() },
        f.cookie,
      ),
      409,
      "ID_CONFLICT",
    );
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, f.me.user.id],
    );
    expect((await post(base(f.teamId), f.input, f.cookie)).statusCode).toBe(
      200,
    );
    denied(
      await post(base(f.teamId), { ...f.input, id: randomUUID() }, f.cookie),
      403,
      "COMPUTE_FORBIDDEN",
    );
    expect(await counts()).toEqual(before);
  });

  it("serializes concurrent identical Start requests into one atomic creation and exact replay", async () => {
    const f = await setup();
    const results = await Promise.all([
      post(base(f.teamId), f.input, f.cookie),
      post(base(f.teamId), structuredClone(f.input), f.cookie),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 201,
    ]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect(await counts()).toMatchObject({
      executions: 1,
      events: 1,
      audits: 1,
      leases: 0,
    });
  });

  it("enforces strict HTTP bodies, literal fields and bounded route/event cursors", async () => {
    const f = await setup();
    await start(f);
    for (const extra of [
      { execute: true },
      { command: "replacement" },
      { plan: f.repositoryPlan.plan },
      { limits: { runSeconds: 999999 } },
    ]) {
      denied(
        await post(
          previewPath(f.teamId),
          { ...previewInput(f), ...extra },
          f.cookie,
        ),
        400,
      );
      denied(
        await post(
          base(f.teamId),
          { ...f.input, id: randomUUID(), ...extra },
          f.cookie,
        ),
        400,
      );
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: base(f.teamId),
          headers: {
            ...headers,
            cookie: f.cookie,
            origin: "http://attacker.test",
          },
          payload: f.input,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base(f.teamId),
          headers: { ...headers, cookie: f.cookie, host: "attacker.test" },
          payload: f.input,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: base(f.teamId),
          headers: {
            ...headers,
            cookie: f.cookie,
            "content-type": "text/plain",
          },
          payload: JSON.stringify(f.input),
        })
      ).statusCode,
    ).toBe(415);
    for (const suffix of [
      "?after=-1",
      "?after=1%0A",
      "?after=2147483648",
      "?after=other:2",
      "?unknown=true",
    ])
      denied(
        await get(`${base(f.teamId)}/${f.input.id}/events${suffix}`, f.cookie),
        400,
      );
    denied(await get(`${base(f.teamId)}?cursor=bad`, f.cookie), 400);
    denied(await get(`${base(f.teamId)}?limit=500`, f.cookie), 400);
  });

  it("requires explicit repository runtime/policy opt-in and the machine bearer realm", async () => {
    const f = await setup();
    await start(f);
    for (const input of [
      { ...claimInput(), runtime: "stub.v1" },
      { ...claimInput(), policy: "privileged" },
      { ...claimInput(), command: "replacement" },
    ])
      denied(await claim(f, input as ReturnType<typeof claimInput>), 400);
    denied(await post(`${machine}/claim`, claimInput(), f.cookie), 401);
    denied(
      await post(
        `${machine}/claim`,
        claimInput(),
        undefined,
        `Bearer ${f.enrollmentToken}`,
      ),
      401,
    );
    expect((await counts()).leases).toBe(0);
    const c = await claimed(f);
    expect(
      (
        await post(
          `/api/teams/${f.teamId}/runners/${f.runnerId}/revoke`,
          { expectedLifecycleRevision: 4 },
          f.cookie,
        )
      ).statusCode,
    ).toBe(200);
    denied(await claim(f), 401, "RUNNER_UNAUTHENTICATED");
    denied(
      await control(f, {
        ...controlInput(c.job),
        leaseToken: c.input.leaseToken,
      }),
      401,
      "RUNNER_UNAUTHENTICATED",
    );
    expect(
      (
        await db.pool.query("SELECT status FROM session_leases WHERE id=$1", [
          c.job.lease.id,
        ])
      ).rows[0].status,
    ).toBe("active");
  });

  it("claims only this runner's oldest eligible queue entry and skips a starter whose grant was withdrawn", async () => {
    const f = await setup();
    const actor = await member(f, "developer", true);
    const older = await start(
      f,
      { ...f.input, id: randomUUID() },
      actor.cookie,
    );
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, actor.id],
    );
    const eligible = await start(f);
    const c = await claimed(f);
    expect(c.job.execution.id).toBe(eligible.id);
    expect((await current(f, older.id)).state).toBe("queued");
    expect((await claim(f)).json()).toEqual({ job: null });
  });

  it("replays the same claim assignment without extending its lease and rejects changed claim pairing", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const before = await counts();
    const replay = await claim(f, c.input);
    expect(replay.statusCode).toBe(200);
    const job = RepositoryExecutionClaimResponseSchema.parse(
      replay.json(),
    ).job!;
    expect(job.manifest).toEqual(c.job.manifest);
    expect(job.lease.expiresAt).toBe(c.job.lease.expiresAt);
    denied(await claim(f, { ...c.input, leaseToken: secret() }), 409);
    const other = await runner(f.teamId, f.cookie, f.me.user.id);
    denied(await claim(f, c.input, other.credential), 409);
    expect(await counts()).toMatchObject({
      executions: before.executions,
      leases: 1,
      events: before.events,
      receipts: 0,
    });
  });

  it("fixes one manifest and server deadlines before effects while keeping raw lease tokens out of storage", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const job = c.job;
    const root = `ark-repo-${job.lease.id}-g1`;
    expect(job.manifest).toEqual({
      version: 1,
      executionId: job.execution.id,
      leaseId: job.lease.id,
      generation: 1,
      planDigest: job.execution.planDigest,
      resources: {
        preparationContainer: `${root}-prep`,
        commandContainer: `${root}-command`,
        workspaceVolume: `${root}-workspace`,
      },
    });
    expect(job.execution.compatibility).not.toBe("pending_runner_claim");
    expect(
      Date.parse(job.execution.runDeadlineAt!) -
        Date.parse(job.execution.claimedAt!),
    ).toBe(900_000);
    expect(
      Date.parse(job.execution.preparationDeadlineAt!) -
        Date.parse(job.execution.claimedAt!),
    ).toBe(120_000);
    expect(
      Date.parse(job.lease.expiresAt) - Date.parse(job.control.serverNow),
    ).toBeLessThanOrEqual(45_000);
    expect(job.control.decision).toBe("prepare");
    expect(job.control.authorizedForMs).toBeGreaterThan(0);
    expect(job.control.authorizedForMs).toBeLessThanOrEqual(45_000);
    const row = (
      await db.pool.query("SELECT * FROM session_leases WHERE id=$1", [
        job.lease.id,
      ])
    ).rows[0];
    expect(row).toMatchObject({
      runtime: "repository.v1",
      session_id: null,
      repository_execution_id: job.execution.id,
      token_hash: sha(c.input.leaseToken),
    });
    const log = await events(f);
    expect(JSON.stringify({ row, log, manifest: job.manifest })).not.toContain(
      c.input.leaseToken,
    );
    expect(JSON.stringify({ row, log, manifest: job.manifest })).not.toContain(
      f.credential,
    );
  });

  it("prevents repository claims when a stub lease already holds the runner", async () => {
    const f = await setup();
    await stubQueued(f);
    const stub = await stubClaim(f);
    expect(stub.job).not.toBeNull();
    await start(f);
    const result = await claim(f);
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual({ job: null });
    expect((await counts()).leases).toBe(1);
  });

  it("prevents stub claims when a repository lease already holds the same runner", async () => {
    const f = await setup();
    await start(f);
    await claimed(f);
    await stubQueued(f);
    expect((await stubClaim(f)).job).toBeNull();
    expect((await counts()).leases).toBe(1);
  });

  it("serializes concurrent claims across both runtimes into exactly one held reservation", async () => {
    const f = await setup();
    await start(f);
    await stubQueued(f);
    const [repository, stub] = await Promise.all([claim(f), stubClaim(f)]);
    expect(repository.statusCode).toBe(200);
    const repo = RepositoryExecutionClaimResponseSchema.parse(
      repository.json(),
    );
    expect(Number(repo.job !== null) + Number(stub.job !== null)).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS held FROM session_leases WHERE runner_id=$1 AND status IN ('active','uncertain')",
          [f.runnerId],
        )
      ).rows[0].held,
    ).toBe(1);

    // Two different runner identities can race one global claim UUID without
    // contending on a runner row. The losing insert must roll back owner state.
    const firstRunner = await runner(f.teamId, f.cookie, f.me.user.id);
    const secondRunner = await runner(f.teamId, f.cookie, f.me.user.id);
    const first = {
      ...f,
      runnerId: firstRunner.id,
      credential: firstRunner.credential,
    };
    const second = {
      ...f,
      runnerId: secondRunner.id,
      credential: secondRunner.credential,
      input: { ...f.input, id: randomUUID(), runnerId: secondRunner.id },
    };
    const queuedStub = await stubQueued(first);
    await start(second);
    const sharedId = randomUUID();
    const results = await Promise.all([
      post(
        "/api/runner/sessions/claim",
        { ...stubClaimInput(), claimId: sharedId },
        undefined,
        `Bearer ${first.credential}`,
      ),
      claim(second, { ...claimInput(), claimId: sharedId }),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 409,
    ]);
    const held = (
      await db.pool.query("SELECT runtime FROM session_leases WHERE id=$1", [
        sharedId,
      ])
    ).rows[0];
    expect(held).toBeDefined();
    if (held.runtime === "stub.v1")
      expect((await current(second)).state).toBe("queued");
    else
      expect(
        (
          await get(
            `/api/teams/${f.teamId}/sessions/${queuedStub.id}`,
            f.cookie,
          )
        ).json().session.state,
      ).toBe("queued");
    expect(
      (
        await db.pool.query(
          "SELECT count(*)::int AS held FROM session_leases WHERE runner_id=ANY($1::uuid[]) AND status IN ('active','uncertain')",
          [[first.runnerId, second.runnerId]],
        )
      ).rows[0].held,
    ).toBe(1);
  });

  it("cannot release repository ownership through stub stopped acknowledgement or reconciliation", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const stopped = await post(
      "/api/runner/sessions/advance",
      {
        eventId: randomUUID(),
        leaseId: c.job.lease.id,
        leaseToken: c.input.leaseToken,
        generation: 1,
        expectedRevision: c.job.execution.revision,
        kind: "stopped",
        confirmedStopped: true,
      },
      undefined,
      `Bearer ${f.credential}`,
    );
    expect([401, 404, 409]).toContain(stopped.statusCode);
    denied(
      await post(
        `/api/teams/${f.teamId}/sessions/${f.input.id}/reconcile`,
        { expectedRevision: c.job.execution.revision, confirmedStopped: true },
        f.cookie,
      ),
      404,
    );
    for (const action of ["completed", "stopped", "reconcile"])
      denied(
        await post(
          `${machine}/${action}`,
          {
            ...controlInput(c.job),
            leaseToken: c.input.leaseToken,
            confirmedStopped: true,
          },
          undefined,
          `Bearer ${f.credential}`,
        ),
        404,
      );
    expect(
      (
        await db.pool.query("SELECT status FROM session_leases WHERE id=$1", [
          c.job.lease.id,
        ])
      ).rows[0].status,
    ).toBe("active");
    await stubQueued(f);
    expect((await stubClaim(f)).job).toBeNull();
    const r = await runner(f.teamId, f.cookie, f.me.user.id);
    const stubRunner = { ...f, runnerId: r.id, credential: r.credential };
    await stubQueued(stubRunner);
    const stub = await stubClaim(stubRunner);
    expect(stub.job).not.toBeNull();
    denied(
      await control(stubRunner, {
        ...controlInput(c.job),
        leaseId: stub.job!.lease.id,
        leaseToken: stub.input.leaseToken,
        expectedControlSequence: 0,
      }),
      401,
      "LEASE_UNAUTHENTICATED",
    );
    denied(
      await claim(stubRunner, {
        ...claimInput(),
        claimId: stub.job!.lease.id,
        leaseToken: stub.input.leaseToken,
      }),
      409,
    );
  });

  it("renews preparation with an independent control sequence and bounded positive authority", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    const before = await events(f);
    const response = await control(f, input);
    expect(response.statusCode).toBe(200);
    const next = RepositoryExecutionJobSchema.parse(response.json());
    expect(next.lease.controlSequence).toBe(c.job.lease.controlSequence + 1);
    expect(next.execution.revision).toBe(c.job.execution.revision);
    expect(next.execution.preparationDeadlineAt).toBe(
      c.job.execution.preparationDeadlineAt,
    );
    expect(next.execution.runDeadlineAt).toBe(c.job.execution.runDeadlineAt);
    expect(next.manifest).toEqual(c.job.manifest);
    expect(next.control.decision).toBe("prepare");
    expect(next.control.authorizedForMs).toBeGreaterThan(0);
    expect(next.control.authorizedForMs).toBeLessThanOrEqual(45_000 - 250);
    expect(
      Date.parse(next.control.serverNow) + next.control.authorizedForMs,
    ).toBeLessThanOrEqual(Date.parse(next.lease.expiresAt) - 250);
    expect(Date.parse(next.lease.expiresAt)).toBeLessThanOrEqual(
      Date.parse(next.execution.preparationDeadlineAt!),
    );
    expect(await events(f)).toEqual(before);
    const receipt = (
      await db.pool.query(
        "SELECT * FROM repository_control_receipts WHERE lease_id=$1",
        [c.job.lease.id],
      )
    ).rows[0];
    const { leaseToken: _token, ...safe } = input;
    expect(receipt.request).toEqual(safe);
    expect(JSON.stringify(receipt)).not.toContain(c.input.leaseToken);
    expect(await counts()).toMatchObject({ receipts: 1, events: 2 });
  });

  it("replays a control without renewal and freshly stops it after a grant is withdrawn", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    const first = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    const replay = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    expect(replay.lease).toEqual(first.lease);
    expect((await counts()).receipts).toBe(1);
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1 AND user_id=$2",
      [f.runnerId, f.me.user.id],
    );
    const stopped = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    expect(stopped.control).toMatchObject({
      decision: "stop",
      reason: "permission_changed",
      authorizedForMs: 0,
    });
    expect(stopped.lease).toMatchObject({
      expiresAt: first.lease.expiresAt,
      controlSequence: first.lease.controlSequence,
      status: "uncertain",
    });
    expect(stopped.execution.state).toBe("blocked");
    const before = await counts();
    await control(f, input);
    expect(await counts()).toEqual(before);
    expect((await claim(f)).json()).toEqual({ job: null });
  });

  it("rejects forged execution/token/plan/generation, stale sequences and changed receipt identities", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    for (const forged of [
      { ...input, executionId: randomUUID() },
      { ...input, leaseId: randomUUID() },
      { ...input, leaseToken: secret() },
    ])
      denied(await control(f, forged), 401, "LEASE_UNAUTHENTICATED");
    denied(await control(f, { ...input, planDigest: "c".repeat(64) }), 409);
    denied(
      await post(
        `${machine}/control`,
        { ...input, generation: 2 },
        undefined,
        `Bearer ${f.credential}`,
      ),
      400,
    );
    for (const extra of [
      { confirmedStopped: true },
      { command: "replacement" },
      { deadline: "2099-01-01T00:00:00.000Z" },
      { outputs: {} },
    ])
      denied(
        await post(
          `${machine}/control`,
          { ...input, ...extra },
          undefined,
          `Bearer ${f.credential}`,
        ),
        400,
      );
    expect((await control(f, input)).statusCode).toBe(200);
    denied(await control(f, { ...input, expectedControlSequence: 1 }), 409);
    denied(await control(f, { ...input, controlId: randomUUID() }), 409);
    expect((await counts()).receipts).toBe(1);
  });

  it("freshly stops an exact receipt replay after lease expiry and never reactivates uncertain ownership", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    const first = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    const expired = (
      await db.pool.query<{ expires_at: Date }>(
        "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1 RETURNING expires_at",
        [c.job.lease.id],
      )
    ).rows[0]!.expires_at.toISOString();
    const replay = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    expect(replay.control).toMatchObject({
      decision: "stop",
      reason: "lease_expired",
      authorizedForMs: 0,
    });
    expect(replay.lease).toMatchObject({
      status: "uncertain",
      expiresAt: expired,
      controlSequence: first.lease.controlSequence,
    });
    const before = await counts();
    const next = RepositoryExecutionJobSchema.parse(
      (
        await control(f, {
          ...input,
          controlId: randomUUID(),
          expectedControlSequence: replay.lease.controlSequence,
        })
      ).json(),
    );
    expect(next.lease.status).toBe("uncertain");
    expect(next.control.decision).toBe("stop");
    expect((await counts()).events).toBe(before.events);
    await expect(
      db.pool.query("UPDATE session_leases SET status='active' WHERE id=$1", [
        c.job.lease.id,
      ]),
    ).rejects.toThrow("ARK_WORK_LEASE_CANNOT_REACTIVATE");
  });

  it("uses the fixed preparation cutoff on fresh control and exact replay with synthetic fixture clocks", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    const first = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    await shiftExecutionClocks(f.input.id, 121);
    const replay = RepositoryExecutionJobSchema.parse(
      (await control(f, input)).json(),
    );
    expect(replay.control).toMatchObject({
      decision: "stop",
      reason: "preparation_deadline",
      authorizedForMs: 0,
    });
    expect(replay.lease).toMatchObject({
      status: "uncertain",
      expiresAt: first.lease.expiresAt,
      controlSequence: first.lease.controlSequence,
    });
    expect(replay.execution.blockReason).toBe("preparation_deadline");
    expect((await counts()).receipts).toBe(1);
  });

  it("reserves the cleanup budget at the fixed run cutoff using synthetic fixture clocks", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    await shiftExecutionClocks(f.input.id, 871);
    const result = await control(f, {
      ...controlInput(c.job),
      leaseToken: c.input.leaseToken,
    });
    expect(result.statusCode).toBe(200);
    const stopped = RepositoryExecutionJobSchema.parse(result.json());
    expect(stopped.control).toMatchObject({
      decision: "stop",
      reason: "run_deadline",
      authorizedForMs: 0,
    });
    expect(Date.parse(stopped.execution.runDeadlineAt!)).toBeGreaterThan(
      Date.parse(stopped.control.serverNow),
    );
    expect(stopped.lease.status).toBe("uncertain");
    expect(stopped.execution.blockReason).toBe("run_deadline");
  });

  it("cancels queued work immediately and holds claimed work in cancelling with revision protection", async () => {
    const f = await setup();
    const queued = await start(f);
    const cancelled = await post(
      `${base(f.teamId)}/${queued.id}/cancel`,
      { expectedRevision: queued.revision },
      f.cookie,
    );
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().repositoryExecution.state).toBe("cancelled");
    expect((await counts()).leases).toBe(0);
    expect((await claim(f)).json()).toEqual({ job: null });
    const nextInput = { ...f.input, id: randomUUID() };
    const starter = await member(f, "developer", true);
    const held = await start(f, nextInput, starter.cookie);
    const c = await claimed(f);
    const receipt = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    const controlled = RepositoryExecutionJobSchema.parse(
      (await control(f, receipt)).json(),
    );
    const other = await member(f, "developer", true);
    denied(
      await post(
        `${base(f.teamId)}/${held.id}/cancel`,
        { expectedRevision: c.job.execution.revision },
        other.cookie,
      ),
      403,
    );
    denied(
      await post(
        `${base(f.teamId)}/${held.id}/cancel`,
        { expectedRevision: held.revision },
        f.cookie,
      ),
      409,
    );
    const cancelling = await post(
      `${base(f.teamId)}/${held.id}/cancel`,
      { expectedRevision: c.job.execution.revision },
      starter.cookie,
    );
    expect(cancelling.statusCode).toBe(200);
    expect(cancelling.json().repositoryExecution.state).toBe("cancelling");
    const stopped = RepositoryExecutionJobSchema.parse(
      (await control(f, receipt)).json(),
    );
    expect(stopped.control).toMatchObject({
      decision: "stop",
      reason: "cancelling",
      authorizedForMs: 0,
    });
    expect(stopped.lease.expiresAt).toBe(controlled.lease.expiresAt);
    expect(stopped.lease.status).toBe("active");
    expect((await claim(f)).json()).toEqual({ job: null });
  });

  it("expires only repository leases into uncertainty while preserving shared active-or-uncertain capacity", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    await db.pool.query(
      "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [c.job.lease.id],
    );
    expect(
      await new SessionService(
        db.pool,
        new IdentityService(db.pool, 43200),
      ).expireLeases(),
    ).toBe(0);
    expect((await current(f)).state).toBe("running");
    expect(await service().expireLeases()).toBe(1);
    expect(await service().expireLeases()).toBe(0);
    expect(await current(f)).toMatchObject({
      state: "blocked",
      blockReason: "lease_expired",
    });
    expect(
      (
        await db.pool.query("SELECT status FROM session_leases WHERE id=$1", [
          c.job.lease.id,
        ])
      ).rows[0].status,
    ).toBe("uncertain");
    await start(f, { ...f.input, id: randomUUID() });
    await stubQueued(f);
    expect((await claim(f)).json()).toEqual({ job: null });
    expect((await stubClaim(f)).job).toBeNull();
    expect((await counts()).leases).toBe(1);
  });

  it("rechecks starter identity, memberships, role, grant and runner approval on ordinary preparation control", async () => {
    const f = await setup();
    const failures = [
      "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1",
      "UPDATE organization_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
      "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE user_id=$1",
      "UPDATE team_memberships SET role='viewer' WHERE user_id=$1",
      "UPDATE runner_use_grants SET granted=false WHERE user_id=$1",
      "UPDATE runners SET dispatch_approved=false WHERE id=$1",
    ];
    for (const sql of failures) {
      const r = await runner(f.teamId, f.cookie, f.me.user.id);
      const target = {
        ...f,
        runnerId: r.id,
        credential: r.credential,
        input: { ...f.input, id: randomUUID(), runnerId: r.id },
      };
      const actor = await member(target, "developer", true);
      await start(target, target.input, actor.cookie);
      const c = await claimed(target);
      await db.pool.query(sql, [
        sql.includes("UPDATE runners") ? r.id : actor.id,
      ]);
      const stopped = RepositoryExecutionJobSchema.parse(
        (
          await control(target, {
            ...controlInput(c.job),
            leaseToken: c.input.leaseToken,
          })
        ).json(),
      );
      expect(stopped.control).toMatchObject({
        decision: "stop",
        reason: "permission_changed",
        authorizedForMs: 0,
      });
      expect(stopped.lease.status).toBe("uncertain");
      expect(stopped.execution.state).toBe("blocked");
    }
  });

  it("keeps durable starter authority after browser logout while enforcing later current permission changes", async () => {
    const f = await setup();
    const actor = await member(f, "developer", true);
    await start(f, f.input, actor.cookie);
    expect((await post("/api/auth/logout", {}, actor.cookie)).statusCode).toBe(
      204,
    );
    const c = await claimed(f);
    expect(c.job.control.decision).toBe("prepare");
    const prepared = await control(f, {
      ...controlInput(c.job),
      leaseToken: c.input.leaseToken,
    });
    expect(prepared.statusCode).toBe(200);
    expect(prepared.json().control.decision).toBe("prepare");
    denied(await get(`${base(f.teamId)}/${f.input.id}`, actor.cookie), 401);
    expect((await current(f)).state).toBe("running");
  });

  it("rolls back execution/events/audit when admission audit or concrete response validation fails", async () => {
    const f = await setup();
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT reject_repository_execution_audit CHECK(action <> 'repository_execution.created')",
    );
    denied(await post(base(f.teamId), f.input, f.cookie), 500);
    expect(await counts()).toMatchObject({
      executions: 0,
      events: 0,
      audits: 0,
    });
    await db.pool.query(
      "ALTER TABLE audit_events DROP CONSTRAINT reject_repository_execution_audit",
    );
    const parse = vi
      .spyOn(RepositoryExecutionResponseSchema, "parse")
      .mockImplementationOnce(() => {
        throw new Error("Forced repository execution response failure");
      });
    try {
      denied(await post(base(f.teamId), f.input, f.cookie), 500);
    } finally {
      parse.mockRestore();
    }
    expect(await counts()).toMatchObject({
      executions: 0,
      events: 0,
      audits: 0,
    });
    await start(f);
  });

  it("rolls back failed claim events and control receipts without partial ownership or renewal", async () => {
    const f = await setup();
    await start(f);
    await db.pool.query(
      "ALTER TABLE repository_execution_events ADD CONSTRAINT reject_claim_event CHECK(kind <> 'claimed')",
    );
    denied(await claim(f), 500);
    expect(await counts()).toMatchObject({ leases: 0, events: 1 });
    expect((await current(f)).state).toBe("queued");
    await db.pool.query(
      "ALTER TABLE repository_execution_events DROP CONSTRAINT reject_claim_event",
    );
    const c = await claimed(f);
    const input = { ...controlInput(c.job), leaseToken: c.input.leaseToken };
    await db.pool.query(
      "ALTER TABLE repository_control_receipts ADD CONSTRAINT reject_control_receipt CHECK(false)",
    );
    denied(await control(f, input), 500);
    const lease = (
      await db.pool.query(
        "SELECT control_sequence,expires_at FROM session_leases WHERE id=$1",
        [c.job.lease.id],
      )
    ).rows[0];
    expect(lease.control_sequence).toBe(c.job.lease.controlSequence);
    expect(lease.expires_at.toISOString()).toBe(c.job.lease.expiresAt);
    expect((await counts()).receipts).toBe(0);
    await db.pool.query(
      "ALTER TABLE repository_control_receipts DROP CONSTRAINT reject_control_receipt",
    );
    expect((await control(f, input)).statusCode).toBe(200);
    expect((await counts()).receipts).toBe(1);
  });

  it("works through restricted runtime grants while protecting admission, fixed clocks, lease context and append-only records", async () => {
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
        `GRANT UPDATE ON "${db.schema}".users,"${db.schema}".organization_memberships,"${db.schema}".team_memberships,"${db.schema}".teams,"${db.schema}".auth_sessions,"${db.schema}".resources,"${db.schema}".runners TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT,UPDATE ON "${db.schema}".repository_executions,"${db.schema}".session_leases TO "${role}"`,
      );
      await db.admin.query(
        `GRANT INSERT ON "${db.schema}".repository_execution_events,"${db.schema}".repository_control_receipts,"${db.schema}".audit_events TO "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime });
      await start(f);
      const c = await claimed(f);
      expect(
        (
          await control(f, {
            ...controlInput(c.job),
            leaseToken: c.input.leaseToken,
          })
        ).statusCode,
      ).toBe(200);
      for (const sql of [
        "DELETE FROM repository_executions",
        "DELETE FROM session_leases",
        "UPDATE repository_execution_events SET state='blocked'",
        "DELETE FROM repository_execution_events",
        "UPDATE repository_control_receipts SET request='{}'::jsonb",
        "DELETE FROM repository_control_receipts",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      for (const sql of [
        "UPDATE repository_executions SET workspace_name='tampered'",
        "UPDATE repository_executions SET claimed_at=claimed_at-interval '1 second'",
        "UPDATE session_leases SET token_hash=repeat('a',64)",
        "UPDATE session_leases SET control_sequence=0",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "P0001",
        });
      await expect(
        db.pool.query(
          "UPDATE repository_execution_events SET state='cancelled'",
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      await expect(
        db.pool.query(
          "UPDATE repository_control_receipts SET request='{}'::jsonb",
        ),
      ).rejects.toMatchObject({ code: "P0001" });
      const row = (
        await db.pool.query("SELECT * FROM repository_executions WHERE id=$1", [
          f.input.id,
        ])
      ).rows[0];
      const id = randomUUID();
      const digest = "c".repeat(64);
      const request = { ...f.input, id, expectedPlanDigest: digest };
      await expect(
        db.pool.query(
          "INSERT INTO repository_executions(id,organization_id,team_id,started_by,runner_id,repository_plan_id,plan_digest,workspace_id,workspace_version_id,workspace_name,request,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'queued')",
          [
            id,
            row.organization_id,
            row.team_id,
            row.started_by,
            row.runner_id,
            row.repository_plan_id,
            digest,
            row.workspace_id,
            row.workspace_version_id,
            row.workspace_name,
            JSON.stringify(request),
          ],
        ),
      ).rejects.toMatchObject({ code: "23503" });
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });

  it("rechecks database lease expiry after a control waits for the runner lock", async () => {
    const f = await setup();
    await start(f);
    const c = await claimed(f);
    await db.pool.query(
      "UPDATE session_leases SET expires_at=clock_timestamp()+interval '2 seconds' WHERE id=$1",
      [c.job.lease.id],
    );
    const locker = await db.pool.connect();
    let pending: ReturnType<typeof control> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query("SELECT 1 FROM runners WHERE id=$1 FOR UPDATE", [
        f.runnerId,
      ]);
      pending = control(f, {
        ...controlInput(c.job),
        leaseToken: c.input.leaseToken,
      });
      await blockedBy(pid);
      await waitForLeaseDeadline(locker, c.job.lease.id);
      await locker.query("COMMIT");
      const result = await pending;
      expect(result.statusCode).toBe(200);
      const stopped = RepositoryExecutionJobSchema.parse(result.json());
      expect(stopped.control).toMatchObject({
        decision: "stop",
        reason: "lease_expired",
        authorizedForMs: 0,
      });
      expect(stopped.lease.status).toBe("uncertain");
      expect(Date.parse(stopped.lease.expiresAt)).toBeLessThanOrEqual(
        Date.parse(stopped.control.serverNow),
      );
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });
});
