import { createHash, randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RepositoryExecutionClaimResponseSchema,
  RepositoryPlanResponseSchema,
  RepositoryPreparationReceiptReadResponseSchema,
  RepositoryPreparationReceiptResponseSchema,
  SessionClaimResponseSchema,
  WorkspaceResponseSchema,
  serializeRepositoryPreparationReceiptPayload,
  type MeResponse,
  type RepositoryExecutionJob,
  type RepositoryPreparationEvidence,
  type RepositoryPreparationReceiptRequest,
  type WorkspaceDefinition,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
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
const machine = "/api/runner/repository-executions";
const uploadPath = `${machine}/preparation-receipts`;
const executionsPath = (teamId: string) =>
  `/api/teams/${teamId}/repository-executions`;
const readPath = (teamId: string, executionId: string) =>
  `${executionsPath(teamId)}/${executionId}/preparation-receipt`;
const secret = () => randomBytes(32).toString("hex");
const digest = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const definition: WorkspaceDefinition = {
  name: "Receipt fixture",
  description: "Structured observations only; no repository command runs.",
  repositoryUrl: "https://github.com/example/receipt-fixture.git",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "node:24",
  workingDirectory: ".",
  actions: {
    install: "",
    test: "never execute this saved command",
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

async function enroll(teamId: string, cookie: string, userId: string) {
  const id = randomUUID();
  const enrollmentToken = `ark_enroll_${id}_${secret()}`;
  const credential = `ark_runner_${id}_${secret()}`;
  expect(
    (
      await post(
        `/api/teams/${teamId}/runner-enrollments`,
        { id, name: "Receipt runner", enrollmentToken },
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
  for (const [path, payload] of [
    ["dispatch-approval", { expectedLifecycleRevision: 2, approved: true }],
    [`grants/${userId}`, { expectedLifecycleRevision: 3, granted: true }],
  ] as const)
    expect(
      (
        await post(
          `/api/teams/${teamId}/runners/${id}/${path}`,
          payload,
          cookie,
        )
      ).statusCode,
    ).toBe(200);
  return { id, credential };
}

async function setup() {
  const boot = await post("/api/bootstrap", {
    ownerName: "Receipt Owner",
    email: "owner@example.test",
    password: "test-only-long-password",
    organizationName: "Receipt Tests",
    teamName: "Alpha",
  });
  expect(boot.statusCode).toBe(201);
  const me = boot.json<MeResponse>();
  const teamId = me.teams[0]!.id;
  const cookie = String(boot.headers["set-cookie"]).split(";")[0]!;
  const savedWorkspace = await post(
    `/api/teams/${teamId}/workspaces`,
    { id: randomUUID(), schemaVersion: 1, definition },
    cookie,
  );
  expect(savedWorkspace.statusCode).toBe(201);
  const workspace = WorkspaceResponseSchema.parse(
    savedWorkspace.json(),
  ).workspace;
  const savedPlan = await post(
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
  expect(savedPlan.statusCode).toBe(201);
  const repositoryPlan = RepositoryPlanResponseSchema.parse(
    savedPlan.json(),
  ).repositoryPlan;
  const runner = await enroll(teamId, cookie, me.user.id);
  return { me, teamId, cookie, workspace, repositoryPlan, runner };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function startAndClaim(f: Fixture, runner = f.runner) {
  const executionId = randomUUID();
  const started = await post(
    executionsPath(f.teamId),
    {
      id: executionId,
      repositoryPlanId: f.repositoryPlan.id,
      expectedPlanDigest: f.repositoryPlan.planDigest,
      runnerId: runner.id,
    },
    f.cookie,
  );
  expect(started.statusCode).toBe(201);
  const claim = {
    claimId: randomUUID(),
    leaseToken: secret(),
    runtime: "repository.v1" as const,
    policy: "docker-linux-offline.v1" as const,
  };
  const result = await post(
    `${machine}/claim`,
    claim,
    undefined,
    `Bearer ${runner.credential}`,
  );
  expect(result.statusCode).toBe(200);
  const job = RepositoryExecutionClaimResponseSchema.parse(result.json()).job;
  expect(job).not.toBeNull();
  return { job: job!, leaseToken: claim.leaseToken, runner };
}
type Claimed = Awaited<ReturnType<typeof startAndClaim>>;

async function claimStub(f: Fixture) {
  const agentResult = await post(
    `/api/teams/${f.teamId}/agents`,
    {
      id: randomUUID(),
      schemaVersion: 1,
      definition: {
        name: "Receipt stub",
        description: "",
        instructions: "Inert fixture",
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
        name: "Receipt stub Flow",
        description: "",
        workspace: {
          resourceId: f.workspace.id,
          versionId: f.workspace.versionId,
        },
        inputs: [{ name: "task", type: "text" }],
        stages: [
          {
            id: stageId,
            name: "Stub",
            agent: { resourceId: agent.id, versionId: agent.versionId },
            inputs: [
              {
                name: "task",
                type: "text",
                source: { kind: "flow_input", port: "task" },
              },
            ],
            outputs: [{ name: "result", type: "text" }],
          },
        ],
        outputs: [
          {
            name: "result",
            type: "text",
            source: { kind: "stage_output", stageId, port: "result" },
          },
        ],
      },
    },
    f.cookie,
  );
  expect(flowResult.statusCode).toBe(201);
  const flow = flowResult.json().flow as { id: string; versionId: string };
  const executionId = randomUUID();
  expect(
    (
      await post(
        `/api/teams/${f.teamId}/sessions`,
        {
          id: executionId,
          flow: { resourceId: flow.id, versionId: flow.versionId },
          runnerId: f.runner.id,
          inputValues: { task: { type: "text", value: "Pure stub fixture" } },
        },
        f.cookie,
      )
    ).statusCode,
  ).toBe(201);
  const claim = {
    claimId: randomUUID(),
    leaseToken: secret(),
    runtime: "stub.v1",
  };
  const result = await post(
    "/api/runner/sessions/claim",
    claim,
    undefined,
    `Bearer ${f.runner.credential}`,
  );
  expect(result.statusCode).toBe(200);
  const job = SessionClaimResponseSchema.parse(result.json()).job;
  expect(job).not.toBeNull();
  return { executionId, claim, job: job! };
}

function preparedEvidence(
  job: RepositoryExecutionJob,
): Extract<RepositoryPreparationEvidence, { outcome: "prepared" }> {
  const ownership = {
    executionId: job.execution.id,
    leaseId: job.lease.id,
    generation: 1 as const,
    planDigest: job.execution.planDigest,
  };
  return {
    version: 1,
    outcome: "prepared",
    elapsedMs: 101,
    sourceCommitOid: job.execution.plan.source.commitOid,
    commandImage: {
      repositoryDigest: job.execution.plan.image.pinned,
      imageId: `sha256:${"c".repeat(64)}`,
      os: "linux",
    },
    resolvedWorkingDirectory: "/workspace/repository",
    resources: {
      preparationContainer: {
        name: job.manifest.resources.preparationContainer,
        id: "d".repeat(64),
        status: "exited",
        exitCode: 0,
        ownership,
      },
      workspaceVolume: {
        name: job.manifest.resources.workspaceVolume,
        status: "present",
        ownership,
      },
      commandContainer: {
        name: job.manifest.resources.commandContainer,
        status: "absent",
      },
    },
  };
}
function receiptInput(c: Claimed): RepositoryPreparationReceiptRequest {
  return {
    id: randomUUID(),
    executionId: c.job.execution.id,
    leaseId: c.job.lease.id,
    leaseToken: c.leaseToken,
    generation: 1,
    planDigest: c.job.execution.planDigest,
    evidence: preparedEvidence(c.job),
  };
}
const upload = (c: Claimed, input: unknown = receiptInput(c)) =>
  post(uploadPath, input, undefined, `Bearer ${c.runner.credential}`);
const saved = (result: Awaited<ReturnType<typeof post>>) =>
  RepositoryPreparationReceiptResponseSchema.parse(result.json())
    .preparationReceipt;
async function read(f: Fixture, executionId: string, cookie = f.cookie) {
  const result = await get(readPath(f.teamId, executionId), cookie);
  expect(result.statusCode).toBe(200);
  return RepositoryPreparationReceiptReadResponseSchema.parse(result.json())
    .preparationReceipt;
}
async function member(
  f: Fixture,
  role: "admin" | "developer" | "reviewer" | "viewer",
  scope = { teamId: f.teamId, organizationId: f.me.organization.id },
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) SELECT $1,$2,'Receipt Member',password_hash FROM users WHERE id=$3",
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
  return { id, cookie: `ark_session=${token}` };
}
async function controlState() {
  return (
    await db.pool.query(
      `SELECT
       (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY id),'[]'::jsonb) FROM repository_executions e) AS executions,
       (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id),'[]'::jsonb) FROM session_leases l) AS leases,
       (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY execution_id,sequence),'[]'::jsonb) FROM repository_execution_events e) AS events,
       (SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY lease_id,sequence),'[]'::jsonb) FROM repository_control_receipts c) AS controls,
       (SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY id),'[]'::jsonb) FROM execution_sessions s) AS stub_sessions,
       (SELECT coalesce(jsonb_agg(to_jsonb(e) ORDER BY session_id,sequence),'[]'::jsonb) FROM execution_events e) AS stub_events,
       (SELECT count(*)::int FROM session_leases WHERE status IN ('active','uncertain')) AS held`,
    )
  ).rows[0];
}
async function receiptCounts() {
  return (
    await db.pool.query<{ receipts: number; audits: number }>(
      "SELECT (SELECT count(*)::int FROM repository_preparation_receipts) AS receipts,(SELECT count(*)::int FROM audit_events WHERE action='repository_preparation.received') AS audits",
    )
  ).rows[0]!;
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    );
  return value;
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

describe("Immutable runner-reported preparation receipts with PostgreSQL", () => {
  it("returns null only for an accessible execution without a receipt", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const before = await controlState();
    expect(await read(f, c.job.execution.id)).toBeNull();
    denied(await get(readPath(f.teamId, randomUUID()), f.cookie), 404);
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
  });

  it("atomically stores a bound prepared report and safe provenance without granting work or retaining a token", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const before = await controlState();
    const result = await upload(c, input);
    expect(result.statusCode).toBe(201);
    const record = saved(result);
    const { leaseToken: _token, ...payload } = input;
    expect(record).toMatchObject({
      id: input.id,
      executionId: c.job.execution.id,
      leaseId: c.job.lease.id,
      generation: 1,
      planDigest: f.repositoryPlan.planDigest,
      organizationId: f.me.organization.id,
      teamId: f.teamId,
      reportedByRunnerId: f.runner.id,
      workspace: c.job.execution.workspace,
      evidenceStatus: "runner_reported_unverified",
      manifest: c.job.manifest,
      evidence: input.evidence,
      reportDigest: digest(
        serializeRepositoryPreparationReceiptPayload(payload),
      ),
    });
    expect(Number.isFinite(Date.parse(record.receivedAt))).toBe(true);
    expect(await read(f, c.job.execution.id)).toEqual(record);
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
    expect(await controlState()).toEqual(before);
    const row = (
      await db.pool.query(
        "SELECT * FROM repository_preparation_receipts WHERE id=$1",
        [input.id],
      )
    ).rows[0]!;
    expect(row.request).toEqual(payload);
    expect(JSON.stringify(row)).not.toContain(input.leaseToken);
    expect(JSON.stringify(record)).not.toContain(input.leaseToken);
    const audit = (
      await db.pool.query(
        "SELECT metadata FROM audit_events WHERE action='repository_preparation.received'",
      )
    ).rows[0]!.metadata;
    expect(JSON.stringify(audit)).not.toContain(input.leaseToken);
    expect(JSON.stringify(audit)).not.toContain("sourceCommitOid");
    expect(JSON.stringify(audit)).not.toContain("resources");
    expect(result.json()).not.toHaveProperty("job");
    expect(result.json()).not.toHaveProperty("control");
  });

  it("preserves bounded failure observations that mismatch source/image and exceed the preparation budget", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    input.evidence = {
      version: 1,
      outcome: "failed",
      elapsedMs: 130_000,
      reason: "source_mismatch",
      sourceCommitOid: "e".repeat(40),
      commandImage: {
        repositoryDigest: `other@sha256:${"f".repeat(64)}`,
        imageId: `sha256:${"d".repeat(64)}`,
        os: "linux",
      },
      resolvedWorkingDirectory: "/workspace/repository/other",
    };
    const before = await controlState();
    const result = await upload(c, input);
    expect(result.statusCode).toBe(201);
    expect(saved(result).evidence).toEqual(input.evidence);
    expect(await controlState()).toEqual(before);
  });

  it("replays canonical content with reordered nested keys and persists across API restart", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const first = await upload(c, input);
    expect(first.statusCode).toBe(201);
    const record = saved(first);
    await app.close();
    app = await buildApp({ pool: db.pool });
    const before = await controlState();
    const repeated = await upload(c, reverseKeys(input));
    expect(repeated.statusCode).toBe(200);
    expect(saved(repeated)).toEqual(record);
    expect(await read(f, c.job.execution.id)).toEqual(record);
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
    expect(await controlState()).toEqual(before);
  });

  it("conflicts on altered receipt payload or a different final receipt identity for the same lease", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    expect((await upload(c, input)).statusCode).toBe(201);
    const before = await controlState();
    for (const altered of [
      { ...input, evidence: { ...input.evidence, elapsedMs: 102 } },
      { ...input, id: randomUUID() },
    ])
      denied(await upload(c, altered), 409, "ID_CONFLICT");
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
    expect(await controlState()).toEqual(before);
  });

  it("serializes concurrent identical uploads into one receipt and one audit", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const before = await controlState();
    const responses = await Promise.all([upload(c, input), upload(c, input)]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 201]);
    expect(saved(responses[0]!)).toEqual(saved(responses[1]!));
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
    expect(await controlState()).toEqual(before);
  });

  it("reserves receipt UUIDs globally across simultaneous uploads from different owned runners", async () => {
    const f = await setup();
    const first = await startAndClaim(f);
    const secondRunner = await enroll(f.teamId, f.cookie, f.me.user.id);
    const second = await startAndClaim(f, secondRunner);
    const id = randomUUID();
    const before = await controlState();
    const locker = await db.pool.connect();
    const pending: ReturnType<typeof upload>[] = [];
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      // Hold the first insert before commit so the other runner must wait at
      // the global receipt-ID constraint, exercising defensive replay handling.
      await locker.query("LOCK TABLE audit_events IN SHARE MODE");
      pending.push(upload(first, { ...receiptInput(first), id }));
      await blockedBy(pid);
      pending.push(upload(second, { ...receiptInput(second), id }));
      await expect
        .poll(
          async () =>
            (
              await db.pool.query<{ blocked: boolean }>(
                "SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%INSERT INTO repository_preparation_receipts%') AS blocked",
              )
            ).rows[0]!.blocked,
          { timeout: 5000, interval: 15 },
        )
        .toBe(true);
      await locker.query("COMMIT");
      const responses = await Promise.all(pending);
      expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409]);
      const winner = responses.find((r) => r.statusCode === 201)!;
      const loser = responses.find((r) => r.statusCode === 409)!;
      expect(loser.json().error.code).toBe("ID_CONFLICT");
      expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
      expect(await controlState()).toEqual(before);
      expect(saved(winner).executionId).toBe(first.job.execution.id);
      expect(await read(f, second.job.execution.id)).toBeNull();
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      await Promise.all(pending);
    }
  });

  it("rejects missing machine authority, forged ownership tokens, and unrelated runner credentials", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    // A failure report has no nested successful-ownership claim, so forged
    // envelope identities reach machine authorization rather than failing the
    // prepared-evidence binding schema before authentication.
    input.evidence = {
      version: 1,
      outcome: "failed",
      elapsedMs: 0,
      reason: "unknown",
      sourceCommitOid: null,
      commandImage: null,
      resolvedWorkingDirectory: null,
    };
    const before = await controlState();
    denied(await post(uploadPath, input, f.cookie), 401);
    for (const altered of [
      { ...input, executionId: randomUUID() },
      { ...input, leaseId: randomUUID() },
      { ...input, leaseToken: secret() },
    ])
      denied(await upload(c, altered), 401, "LEASE_UNAUTHENTICATED");
    denied(await upload(c, { ...input, planDigest: "e".repeat(64) }), 401);
    denied(await upload(c, { ...input, generation: 2 }), 400);
    const other = await enroll(f.teamId, f.cookie, f.me.user.id);
    denied(
      await post(uploadPath, input, undefined, `Bearer ${other.credential}`),
      401,
    );
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
  });

  it("rejects a stub lease even when the stub session and repository execution share a UUID", async () => {
    const f = await setup();
    const stub = await claimStub(f);
    const execution = await post(
      executionsPath(f.teamId),
      {
        id: stub.executionId,
        repositoryPlanId: f.repositoryPlan.id,
        expectedPlanDigest: f.repositoryPlan.planDigest,
        runnerId: f.runner.id,
      },
      f.cookie,
    );
    expect(execution.statusCode).toBe(201);
    const input: RepositoryPreparationReceiptRequest = {
      id: randomUUID(),
      executionId: stub.executionId,
      leaseId: stub.job.lease.id,
      leaseToken: stub.claim.leaseToken,
      generation: 1,
      planDigest: f.repositoryPlan.planDigest,
      evidence: {
        version: 1,
        outcome: "failed",
        elapsedMs: 0,
        reason: "unknown",
        sourceCommitOid: null,
        commandImage: null,
        resolvedWorkingDirectory: null,
      },
    };
    const before = await controlState();
    denied(
      await post(uploadPath, input, undefined, `Bearer ${f.runner.credential}`),
      401,
      "LEASE_UNAUTHENTICATED",
    );
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
  });

  it("allows current members of every role to read without a runner grant and denies anonymous reads", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const result = await upload(c);
    expect(result.statusCode).toBe(201);
    const record = saved(result);
    const before = await controlState();
    for (const role of ["admin", "developer", "reviewer", "viewer"] as const) {
      const actor = await member(f, role);
      expect(await read(f, c.job.execution.id, actor.cookie)).toEqual(record);
    }
    denied(await get(readPath(f.teamId, c.job.execution.id)), 401);
    expect(await controlState()).toEqual(before);
  });

  it("isolates human reads and machine ownership across teams and organizations", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    expect((await upload(c)).statusCode).toBe(201);
    const beta = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Beta')",
      [beta, f.me.organization.id],
    );
    const teammate = await member(f, "viewer", {
      teamId: beta,
      organizationId: f.me.organization.id,
    });
    denied(
      await get(readPath(f.teamId, c.job.execution.id), teammate.cookie),
      404,
    );
    denied(await get(readPath(beta, c.job.execution.id), teammate.cookie), 404);
    await db.pool.query(
      "ALTER TABLE organizations DROP CONSTRAINT organizations_singleton_key",
    );
    const organizationId = randomUUID();
    const teamId = randomUUID();
    await db.pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Foreign receipt')",
      [organizationId],
    );
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Foreign')",
      [teamId, organizationId],
    );
    const foreign = await member(f, "admin", { teamId, organizationId });
    denied(
      await get(readPath(f.teamId, c.job.execution.id), foreign.cookie),
      404,
    );
    denied(
      await get(readPath(teamId, c.job.execution.id), foreign.cookie),
      404,
    );
    const foreignRunner = await enroll(teamId, foreign.cookie, foreign.id);
    denied(
      await post(
        uploadPath,
        receiptInput(c),
        undefined,
        `Bearer ${foreignRunner.credential}`,
      ),
      401,
    );
  });

  it("reauthorizes receipt reads after session, user, organization, or team access is revoked", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    expect((await upload(c)).statusCode).toBe(201);
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
      const actor = await member(f, "viewer");
      await db.pool.query(item.sql, [actor.id]);
      denied(
        await get(readPath(f.teamId, c.job.execution.id), actor.cookie),
        item.status,
      );
    }
  });

  it("rechecks browser-session expiry after a receipt read blocks on identity locks", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    expect((await upload(c)).statusCode).toBe(201);
    const actor = await member(f, "viewer");
    await db.pool.query(
      "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1",
      [actor.id],
    );
    const locker = await db.pool.connect();
    let pending: ReturnType<typeof get> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query("SELECT 1 FROM users WHERE id=$1 FOR UPDATE", [
        actor.id,
      ]);
      pending = get(readPath(f.teamId, c.job.execution.id), actor.cookie);
      await blockedBy(pid);
      await locker.query(
        "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM auth_sessions WHERE user_id=$1",
        [actor.id],
      );
      await locker.query("COMMIT");
      denied(await pending, 401);
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });

  it("accepts late history after cancellation, expiry, approval removal, and starter/grant loss without changing control state", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const cancelled = await post(
      `${executionsPath(f.teamId)}/${c.job.execution.id}/cancel`,
      { expectedRevision: c.job.execution.revision },
      f.cookie,
    );
    expect(cancelled.statusCode).toBe(200);
    await db.pool.query(
      "UPDATE session_leases SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [c.job.lease.id],
    );
    await db.pool.query(
      "UPDATE runners SET dispatch_approved=false WHERE id=$1",
      [f.runner.id],
    );
    await db.pool.query(
      "UPDATE runner_use_grants SET granted=false WHERE runner_id=$1",
      [f.runner.id],
    );
    // Keep a valid organization owner while testing a disabled starter; the
    // last-owner guard remains enabled throughout the fixture.
    const remainingOwner = await member(f, "admin");
    await db.pool.query(
      "UPDATE organization_memberships SET role='owner' WHERE organization_id=$1 AND user_id=$2",
      [f.me.organization.id, remainingOwner.id],
    );
    await db.pool.query(
      "UPDATE users SET disabled_at=clock_timestamp() WHERE id=$1",
      [f.me.user.id],
    );
    const before = await controlState();
    const first = await upload(c, input);
    expect(first.statusCode).toBe(201);
    expect((await upload(c, input)).statusCode).toBe(200);
    expect(await controlState()).toEqual(before);
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
    expect(
      (
        await post(
          `${machine}/claim`,
          {
            claimId: randomUUID(),
            leaseToken: secret(),
            runtime: "repository.v1",
            policy: "docker-linux-offline.v1",
          },
          undefined,
          `Bearer ${f.runner.credential}`,
        )
      ).json(),
    ).toEqual({ job: null });
    expect(await controlState()).toEqual(before);
  });

  it("records a late failure on already uncertain ownership without reactivation or release", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    await db.pool.query(
      "UPDATE session_leases SET status='uncertain' WHERE id=$1",
      [c.job.lease.id],
    );
    const input = receiptInput(c);
    input.evidence = {
      version: 1,
      outcome: "failed",
      elapsedMs: 0,
      reason: "unknown",
      sourceCommitOid: null,
      commandImage: null,
      resolvedWorkingDirectory: null,
    };
    const before = await controlState();
    expect((await upload(c, input)).statusCode).toBe(201);
    expect((await upload(c, input)).statusCode).toBe(200);
    expect(await controlState()).toEqual(before);
    expect((await controlState()).held).toBe(1);
  });

  it("rejects a revoked machine credential even for exact replay", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    expect((await upload(c, input)).statusCode).toBe(201);
    const result = await post(
      `/api/teams/${f.teamId}/runners/${f.runner.id}/revoke`,
      { expectedLifecycleRevision: 4 },
      f.cookie,
    );
    expect(result.statusCode).toBe(200);
    const before = await controlState();
    denied(await upload(c, input), 401, "RUNNER_UNAUTHENTICATED");
    expect(await controlState()).toEqual(before);
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
  });

  it("rejects unknown fields, malformed queries, excessive bodies, and invented verification/cleanup flags", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const evidence = preparedEvidence(c.job);
    const before = await controlState();
    for (const extra of [
      { confirmedStopped: true },
      { adapter: "trusted" },
      { deadline: "2099-01-01T00:00:00.000Z" },
      { command: "replacement" },
    ])
      denied(await upload(c, { ...input, ...extra }), 400);
    for (const extra of [
      { stdout: "private" },
      { quality: "passed" },
      { verified: true },
      { diagnostic: "free text" },
    ])
      denied(
        await upload(c, { ...input, evidence: { ...evidence, ...extra } }),
        400,
      );
    denied(
      await post(
        `${uploadPath}?unexpected=1`,
        input,
        undefined,
        `Bearer ${f.runner.credential}`,
      ),
      400,
    );
    denied(
      await get(
        `${readPath(f.teamId, c.job.execution.id)}?unexpected=1`,
        f.cookie,
      ),
      400,
    );
    denied(await upload(c, { ...input, stdout: "x".repeat(17_000) }), 413);
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
  });

  it("rejects prepared observations that violate exact plan, resource, ownership, path, or budget bindings", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const evidence = preparedEvidence(c.job);
    const before = await controlState();
    for (const changed of [
      { ...evidence, elapsedMs: 120_001 },
      { ...evidence, sourceCommitOid: "e".repeat(40) },
      {
        ...evidence,
        commandImage: {
          ...evidence.commandImage,
          repositoryDigest: `other@sha256:${"e".repeat(64)}`,
        },
      },
      {
        ...evidence,
        resources: {
          ...evidence.resources,
          preparationContainer: {
            ...evidence.resources.preparationContainer,
            name: "foreign-container",
          },
        },
      },
      {
        ...evidence,
        resources: {
          ...evidence.resources,
          workspaceVolume: {
            ...evidence.resources.workspaceVolume,
            ownership: {
              ...evidence.resources.workspaceVolume.ownership,
              executionId: randomUUID(),
            },
          },
        },
      },
      ...[
        "/workspace/repository-escape",
        "/workspace/repository/../escape",
        "/workspace/repository//nested",
        "C:\\private",
        "/workspace/repository/./nested",
      ].map((resolvedWorkingDirectory) => ({
        ...evidence,
        resolvedWorkingDirectory,
      })),
    ])
      denied(await upload(c, { ...input, evidence: changed }), 400);
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
    const contained = {
      ...evidence,
      resolvedWorkingDirectory: "/workspace/repository/apps/actual-target",
    };
    expect(
      (await upload(c, { ...input, evidence: contained })).statusCode,
    ).toBe(201);
  });

  it("rolls back receipt and audit together when audit insertion or response validation fails", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    const before = await controlState();
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT reject_preparation_audit CHECK(action <> 'repository_preparation.received')",
    );
    denied(await upload(c, input), 500);
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    await db.pool.query(
      "ALTER TABLE audit_events DROP CONSTRAINT reject_preparation_audit",
    );
    const parse = vi
      .spyOn(RepositoryPreparationReceiptResponseSchema, "parse")
      .mockImplementationOnce(() => {
        throw new Error("Forced preparation response failure");
      });
    try {
      denied(await upload(c, input), 500);
    } finally {
      parse.mockRestore();
    }
    expect(await receiptCounts()).toEqual({ receipts: 0, audits: 0 });
    expect(await controlState()).toEqual(before);
    expect((await upload(c, input)).statusCode).toBe(201);
  });

  it("keeps saved receipts append-only and rejects a forged lease-context insert", async () => {
    const f = await setup();
    const c = await startAndClaim(f);
    const input = receiptInput(c);
    expect((await upload(c, input)).statusCode).toBe(201);
    await expect(
      db.pool.query(
        "UPDATE repository_preparation_receipts SET report_digest=$2 WHERE id=$1",
        [input.id, "e".repeat(64)],
      ),
    ).rejects.toThrow("ARK_IMMUTABLE_PREPARATION_RECEIPT");
    await expect(
      db.pool.query("DELETE FROM repository_preparation_receipts WHERE id=$1", [
        input.id,
      ]),
    ).rejects.toThrow("ARK_IMMUTABLE_PREPARATION_RECEIPT");
    const other = await startAndClaim(
      f,
      await enroll(f.teamId, f.cookie, f.me.user.id),
    );
    await expect(
      db.pool.query(
        `INSERT INTO repository_preparation_receipts(id,execution_id,lease_id,generation,runtime,organization_id,team_id,reported_by_runner_id,workspace_id,workspace_version_id,plan_digest,request,report_digest)
       SELECT $2::uuid,execution_id,$3::uuid,generation,runtime,organization_id,team_id,reported_by_runner_id,workspace_id,workspace_version_id,plan_digest,
         jsonb_set(jsonb_set(request,'{id}',to_jsonb(($2::uuid)::text)),'{leaseId}',to_jsonb(($3::uuid)::text)),report_digest
       FROM repository_preparation_receipts WHERE id=$1`,
        [input.id, randomUUID(), other.job.lease.id],
      ),
    ).rejects.toMatchObject({ code: "23503" });
    expect(await receiptCounts()).toEqual({ receipts: 1, audits: 1 });
  });
});
