import { createHash, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RepositoryPlanListResponseSchema,
  RepositoryPlanPreviewResponseSchema,
  RepositoryPlanResponseSchema,
  WorkspaceResponseSchema,
  compileRepositoryCommandPlan,
  serializeRepositoryCommandPlan,
  type MeResponse,
  type RepositoryPlanPreviewRequest,
  type SaveRepositoryPlanRequest,
  type WorkspaceDefinition,
} from "@ark/contracts";
import { createPool } from "@ark/db";
import type { PoolClient } from "pg";
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
const selection = {
  action: "test" as const,
  commitOid: "a".repeat(40),
  imageDigest: `ghcr.io/example/dev@sha256:${"b".repeat(64)}`,
};
const definition: WorkspaceDefinition = {
  name: "Planning workspace",
  description: "Saved intent; never execute this fixture.",
  repositoryUrl: "https://github.com/example/planning-fixture.git",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "ghcr.io/example/dev:24",
  workingDirectory: "apps/web",
  actions: {
    install: "this install action must never run",
    test: "  printf 'inert plan'\npnpm test --reporter=junit  ",
    lint: "",
    build: "this build action must never run",
  },
};
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
let fixtureActive = false;
const base = (teamId: string) => `/api/teams/${teamId}/repository-plans`;
const previewPath = (teamId: string) =>
  `/api/teams/${teamId}/repository-plan-previews`;
const post = (url: string, payload: unknown, cookie?: string) =>
  app.inject({
    method: "POST",
    url,
    headers: { ...headers, ...(cookie ? { cookie } : {}) },
    payload: payload as object,
  });
const get = (url: string, cookie?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: { host: headers.host, ...(cookie ? { cookie } : {}) },
  });

async function workspace(teamId: string, cookie: string, value = definition) {
  const result = await post(
    `/api/teams/${teamId}/workspaces`,
    { id: randomUUID(), schemaVersion: 1, definition: value },
    cookie,
  );
  expect(result.statusCode).toBe(201);
  return WorkspaceResponseSchema.parse(result.json()).workspace;
}
async function setup() {
  const result = await post("/api/bootstrap", {
    ownerName: "Plan Owner",
    email: "owner@example.test",
    password: "test-only-long-password",
    organizationName: "Plan Tests",
    teamName: "Alpha",
  });
  expect(result.statusCode).toBe(201);
  const me = result.json<MeResponse>();
  const cookie = String(result.headers["set-cookie"]).split(";")[0]!;
  const teamId = me.teams[0]!.id;
  const savedWorkspace = await workspace(teamId, cookie);
  const input: RepositoryPlanPreviewRequest = {
    workspace: {
      resourceId: savedWorkspace.id,
      versionId: savedWorkspace.versionId,
    },
    selection,
  };
  return { me, teamId, cookie, workspace: savedWorkspace, input };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function member(
  f: Fixture,
  role: "admin" | "developer" | "reviewer" | "viewer",
  scope = { teamId: f.teamId, organizationId: f.me.organization.id },
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) SELECT $1,$2,'Plan Member',password_hash FROM users WHERE id=$3",
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
async function team(
  f: Fixture,
  name: string,
  organizationId = f.me.organization.id,
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,$3)",
    [id, organizationId, name],
  );
  return id;
}
async function save(
  f: Fixture,
  input: SaveRepositoryPlanRequest = { ...f.input, id: randomUUID() },
  cookie = f.cookie,
) {
  const result = await post(base(f.teamId), input, cookie);
  expect(result.statusCode).toBe(201);
  return {
    input,
    repositoryPlan: RepositoryPlanResponseSchema.parse(result.json())
      .repositoryPlan,
  };
}
async function edit(
  f: Fixture,
  value = {
    ...definition,
    name: "Changed planning workspace",
    actions: { ...definition.actions, test: "different saved command" },
  },
) {
  const result = await app.inject({
    method: "PUT",
    url: `/api/teams/${f.teamId}/workspaces/${f.workspace.id}`,
    headers: { ...headers, cookie: f.cookie },
    payload: {
      revision: f.workspace.revision,
      lifecycleRevision: f.workspace.lifecycleRevision,
      schemaVersion: 1,
      definition: value,
    },
  });
  expect(result.statusCode).toBe(200);
  return WorkspaceResponseSchema.parse(result.json()).workspace;
}
async function archive(
  f: Fixture,
  revision = f.workspace.revision,
  lifecycleRevision = f.workspace.lifecycleRevision,
) {
  const result = await post(
    `/api/teams/${f.teamId}/workspaces/${f.workspace.id}/archive`,
    { revision, lifecycleRevision },
    f.cookie,
  );
  expect(result.statusCode).toBe(200);
}
async function counts() {
  return (
    await db.pool.query(
      "SELECT (SELECT count(*)::int FROM repository_plans) AS plans,(SELECT count(*)::int FROM audit_events WHERE action='repository_plan.create') AS audits,(SELECT count(*)::int FROM audit_events) AS all_audits,(SELECT count(*)::int FROM resources) AS resources,(SELECT count(*)::int FROM resource_versions) AS versions,(SELECT count(*)::int FROM runners) AS runners,(SELECT count(*)::int FROM runner_use_grants) AS grants,(SELECT count(*)::int FROM execution_sessions) AS sessions,(SELECT count(*)::int FROM session_leases) AS leases,(SELECT count(*)::int FROM execution_events) AS events",
    )
  ).rows[0] as Record<string, number>;
}
function denied(
  result: Awaited<ReturnType<typeof post>>,
  status: number,
  code?: string,
) {
  expect(result.statusCode).toBe(status);
  if (code) expect(result.json().error.code).toBe(code);
}
async function blockedBy(pid: number, minimum = 1) {
  await expect
    .poll(
      async () =>
        (
          await db.pool.query<{ blocked: number }>(
            "SELECT count(*)::int AS blocked FROM pg_stat_activity WHERE datname=current_database() AND $1=ANY(pg_blocking_pids(pid))",
            [pid],
          )
        ).rows[0]!.blocked,
      { timeout: 5000, interval: 15 },
    )
    .toBeGreaterThanOrEqual(minimum);
}
async function expireAfterWait(actorId: string, locker: PoolClient) {
  await locker.query(
    "SELECT pg_sleep(GREATEST(0,extract(epoch FROM expires_at-clock_timestamp())+0.05)) FROM auth_sessions WHERE user_id=$1",
    [actorId],
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
      // Observe only this fixture's exact generated schema after its own safe
      // cleanup. This connection still targets the validated local ark_test DB.
      const observer = createPool(db.connection);
      try {
        await db.close();
        const result = await observer.query<{ present: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname=$1) AS present",
          [db.schema],
        );
        expect(result.rows[0]!.present).toBe(false);
      } finally {
        await observer.end();
      }
    }
  }
});

describe("V0.5 saved repository plans with real PostgreSQL", () => {
  it("previews copied declared intent without plans, audits, runners, leases or execution side effects", async () => {
    const f = await setup();
    const before = await counts();
    const result = await post(previewPath(f.teamId), f.input, f.cookie);
    expect(result.statusCode).toBe(200);
    const preview = RepositoryPlanPreviewResponseSchema.parse(result.json());
    expect(preview.plan).toEqual(
      compileRepositoryCommandPlan(
        { ...f.input.workspace, definition },
        selection,
      ),
    );
    expect(preview.plan.action).toEqual({
      kind: "test",
      command: definition.actions.test,
    });
    expect(preview.plan.status).toBe("planned_unverified");
    expect(preview.plan).not.toHaveProperty("quality");
    expect(preview.planDigest).toBe(
      createHash("sha256")
        .update(serializeRepositoryCommandPlan(preview.plan), "utf8")
        .digest("hex"),
    );
    expect(await counts()).toEqual(before);
    const stored = await save(f);
    expect(stored.repositoryPlan.plan).toEqual(preview.plan);
    expect(await counts()).toEqual({
      ...before,
      plans: 1,
      audits: 1,
      all_audits: before.all_audits! + 1,
    });
  });

  it("allows every current team role to preview, list metadata and read complete saved plans", async () => {
    const f = await setup();
    const saved = await save(f);
    for (const role of ["admin", "developer", "reviewer", "viewer"] as const) {
      const actor = await member(f, role);
      expect(
        (await post(previewPath(f.teamId), f.input, actor.cookie)).statusCode,
      ).toBe(200);
      const listing = await get(base(f.teamId), actor.cookie);
      expect(listing.statusCode).toBe(200);
      expect(
        RepositoryPlanListResponseSchema.parse(listing.json())
          .repositoryPlans[0]!.id,
      ).toBe(saved.input.id);
      const detail = await get(
        `${base(f.teamId)}/${saved.input.id}`,
        actor.cookie,
      );
      expect(detail.statusCode).toBe(200);
      expect(
        RepositoryPlanResponseSchema.parse(detail.json()).repositoryPlan,
      ).toEqual(saved.repositoryPlan);
    }
    expect((await counts()).audits).toBe(1);
  });

  it("requires an admin/developer Save role but no runner enrollment, approval or grant", async () => {
    const f = await setup();
    for (const role of ["admin", "developer", "reviewer", "viewer"] as const) {
      const actor = await member(f, role);
      const result = await post(
        base(f.teamId),
        { ...f.input, id: randomUUID() },
        actor.cookie,
      );
      if (role === "admin" || role === "developer") {
        expect(result.statusCode).toBe(201);
        expect(
          RepositoryPlanResponseSchema.parse(result.json()).repositoryPlan
            .createdBy,
        ).toBe(actor.id);
      } else denied(result, 403, "FORBIDDEN");
    }
    expect(await counts()).toMatchObject({
      plans: 2,
      audits: 2,
      runners: 0,
      grants: 0,
      sessions: 0,
      leases: 0,
      events: 0,
    });
  });

  it("rechecks disabled, revoked, expired and missing human identities on preview, Save and reads", async () => {
    const f = await setup();
    const saved = await save(f);
    const failures = [
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
      {
        sql: "UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE user_id=$1",
        status: 401,
      },
    ];
    for (const failure of failures) {
      const actor = await member(f, "developer");
      await db.pool.query(failure.sql, [actor.id]);
      denied(
        await post(previewPath(f.teamId), f.input, actor.cookie),
        failure.status,
      );
      denied(
        await post(
          base(f.teamId),
          { ...f.input, id: randomUUID() },
          actor.cookie,
        ),
        failure.status,
      );
      denied(await get(base(f.teamId), actor.cookie), failure.status);
      denied(
        await get(`${base(f.teamId)}/${saved.input.id}`, actor.cookie),
        failure.status,
      );
    }
    denied(await post(previewPath(f.teamId), f.input), 401);
    denied(await post(base(f.teamId), { ...f.input, id: randomUUID() }), 401);
    denied(await get(base(f.teamId)), 401);
    denied(await get(`${base(f.teamId)}/${saved.input.id}`), 401);
    expect((await counts()).plans).toBe(1);
  });

  it("isolates teams and organizations and gives owners no implicit membership", async () => {
    const f = await setup();
    const saved = await save(f);
    const beta = await team(f, "Beta");
    denied(await get(base(beta), f.cookie), 404);
    const betaActor = await member(f, "admin", {
      teamId: beta,
      organizationId: f.me.organization.id,
    });
    denied(await get(`${base(beta)}/${saved.input.id}`, betaActor.cookie), 404);
    denied(await get(base(f.teamId), betaActor.cookie), 404);
    denied(
      await post(previewPath(beta), f.input, betaActor.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    await db.pool.query(
      "ALTER TABLE organizations DROP CONSTRAINT organizations_singleton_key",
    );
    const foreignOrganization = randomUUID();
    await db.pool.query(
      "INSERT INTO organizations(id,name) VALUES($1,'Foreign plan organization')",
      [foreignOrganization],
    );
    const foreignTeam = await team(f, "Foreign", foreignOrganization);
    const foreign = await member(f, "admin", {
      teamId: foreignTeam,
      organizationId: foreignOrganization,
    });
    denied(await get(base(f.teamId), foreign.cookie), 404);
    denied(
      await get(`${base(foreignTeam)}/${saved.input.id}`, foreign.cookie),
      404,
    );
    denied(
      await post(previewPath(foreignTeam), f.input, foreign.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    denied(
      await post(
        base(foreignTeam),
        { ...f.input, id: randomUUID() },
        foreign.cookie,
      ),
      400,
      "INVALID_DEPENDENCY",
    );
    expect((await counts()).plans).toBe(1);
  });

  it("compiles an explicitly selected historical Workspace version while its resource remains active", async () => {
    const f = await setup();
    const current = await edit(f);
    const historical = await post(previewPath(f.teamId), f.input, f.cookie);
    expect(historical.statusCode).toBe(200);
    expect(historical.json().plan.action.command).toBe(definition.actions.test);
    const currentResult = await post(
      previewPath(f.teamId),
      {
        ...f.input,
        workspace: { resourceId: f.workspace.id, versionId: current.versionId },
      },
      f.cookie,
    );
    expect(currentResult.statusCode).toBe(200);
    expect(currentResult.json().plan.action.command).toBe(
      "different saved command",
    );
    const saved = await save(f);
    expect(saved.repositoryPlan.workspaceName).toBe(definition.name);
    expect(saved.repositoryPlan.plan.workspace).toEqual(f.input.workspace);
  });

  it("rejects missing, mismatched, wrong-kind and cross-team version pairs with the same dependency response", async () => {
    const f = await setup();
    const other = await workspace(f.teamId, f.cookie, {
      ...definition,
      name: "Other workspace",
    });
    const agentResult = await post(
      `/api/teams/${f.teamId}/agents`,
      {
        id: randomUUID(),
        schemaVersion: 1,
        definition: {
          name: "Wrong kind",
          description: "",
          instructions: "Inert",
          runtime: "stub",
          modelPreference: null,
          capabilities: [],
        },
      },
      f.cookie,
    );
    expect(agentResult.statusCode).toBe(201);
    const agent = agentResult.json().agent as { id: string; versionId: string };
    const beta = await team(f, "Beta");
    const betaActor = await member(f, "admin", {
      teamId: beta,
      organizationId: f.me.organization.id,
    });
    const foreign = await workspace(beta, betaActor.cookie, {
      ...definition,
      name: "Foreign workspace",
    });
    let expected: unknown;
    for (const pin of [
      { resourceId: randomUUID(), versionId: randomUUID() },
      { resourceId: f.workspace.id, versionId: other.versionId },
      { resourceId: agent.id, versionId: agent.versionId },
      { resourceId: foreign.id, versionId: foreign.versionId },
    ]) {
      const result = await post(
        previewPath(f.teamId),
        { ...f.input, workspace: pin },
        f.cookie,
      );
      denied(result, 400, "INVALID_DEPENDENCY");
      expected ??= result.json();
      expect(result.json()).toEqual(expected);
    }
    expect((await counts()).plans).toBe(0);
  });

  it("rejects unsupported definitions and incompatible declared commands/source/image without saving", async () => {
    const f = await setup();
    for (const schemaVersion of [2, 1]) {
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=$2,definition=$3::jsonb WHERE id=$1",
        [
          f.workspace.versionId,
          schemaVersion,
          JSON.stringify(
            schemaVersion === 2 ? definition : { ...definition, future: true },
          ),
        ],
      );
      denied(
        await post(previewPath(f.teamId), f.input, f.cookie),
        400,
        "INVALID_DEPENDENCY",
      );
    }
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=1,definition=$2::jsonb WHERE id=$1",
      [f.workspace.versionId, JSON.stringify(definition)],
    );
    for (const selected of [
      { ...selection, action: "lint" },
      { ...selection, imageDigest: `other/image@sha256:${"b".repeat(64)}` },
    ])
      denied(
        await post(
          previewPath(f.teamId),
          { ...f.input, selection: selected },
          f.cookie,
        ),
        400,
        "INVALID_REPOSITORY_PLAN",
      );
    const exact = await workspace(f.teamId, f.cookie, {
      ...definition,
      name: "Exact commit",
      sourceRef: "c".repeat(40),
    });
    denied(
      await post(
        previewPath(f.teamId),
        {
          ...f.input,
          workspace: { resourceId: exact.id, versionId: exact.versionId },
        },
        f.cookie,
      ),
      400,
      "INVALID_REPOSITORY_PLAN",
    );
    expect((await counts()).plans).toBe(0);
  });

  it("rejects archived dependencies for new preview/Save but preserves authorized saved reads and replay", async () => {
    const f = await setup();
    const saved = await save(f);
    await archive(f);
    denied(
      await post(previewPath(f.teamId), f.input, f.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    denied(
      await post(base(f.teamId), { ...f.input, id: randomUUID() }, f.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    const replay = await post(base(f.teamId), saved.input, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().repositoryPlan).toEqual(saved.repositoryPlan);
    const reader = await member(f, "viewer");
    expect(
      (await get(`${base(f.teamId)}/${saved.input.id}`, reader.cookie)).json()
        .repositoryPlan,
    ).toEqual(saved.repositoryPlan);
    expect((await counts()).audits).toBe(1);
  });

  it("rejects caller command, definition, policy, limits, execution and nested selection overrides", async () => {
    const f = await setup();
    const invalid = [
      { ...f.input, definition },
      { ...f.input, command: "replacement" },
      { ...f.input, plan: {} },
      { ...f.input, limits: { commandSeconds: 999999 } },
      { ...f.input, policy: "privileged" },
      { ...f.input, runnerId: randomUUID() },
      { ...f.input, execute: true },
      { ...f.input, workspace: { ...f.input.workspace, definition } },
      { ...f.input, selection: { ...selection, command: "replacement" } },
      { ...f.input, selection: { ...selection, commitOid: "main" } },
      { ...f.input, selection: { ...selection, imageDigest: "node:24" } },
      { ...f.input, selection: { ...selection, action: "everything" } },
    ];
    for (const input of invalid) {
      denied(
        await post(previewPath(f.teamId), input, f.cookie),
        400,
        "VALIDATION_ERROR",
      );
      denied(
        await post(base(f.teamId), { ...input, id: randomUUID() }, f.cookie),
        400,
        "VALIDATION_ERROR",
      );
    }
    expect((await counts()).plans).toBe(0);
  });

  it("retains Host/Origin/JSON boundaries and strict route/query schemas", async () => {
    const f = await setup();
    for (const path of [previewPath(f.teamId), base(f.teamId)]) {
      const payload =
        path === base(f.teamId) ? { ...f.input, id: randomUUID() } : f.input;
      for (const override of [
        { host: "attacker.test" },
        { origin: "http://attacker.test" },
      ])
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: { ...headers, cookie: f.cookie, ...override },
              payload,
            })
          ).statusCode,
        ).toBe(403);
      expect(
        (
          await app.inject({
            method: "POST",
            url: path,
            headers: {
              ...headers,
              cookie: f.cookie,
              "content-type": "text/plain",
            },
            payload: JSON.stringify(payload),
          })
        ).statusCode,
      ).toBe(415);
      denied(await post(`${path}?execute=true`, payload, f.cookie), 400);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: previewPath(f.teamId),
          headers: { ...headers, cookie: f.cookie },
          payload: JSON.stringify({
            ...f.input,
            oversized: "x".repeat(2 * 1024 * 1024),
          }),
        })
      ).statusCode,
    ).toBe(413);
    for (const path of [
      `${base(f.teamId)}?limit=500`,
      `${base(f.teamId)}?cursor=invalid`,
      `${base(f.teamId)}/invalid`,
      `${base(f.teamId)}/${randomUUID()}?extra=true`,
      "/api/teams/invalid/repository-plans",
    ])
      denied(await get(path, f.cookie), 400);
    expect((await counts()).plans).toBe(0);
  });

  it("canonicalizes nested key order and UUID/OID case for digest and identical replay", async () => {
    const f = await setup();
    const first = RepositoryPlanPreviewResponseSchema.parse(
      (await post(previewPath(f.teamId), f.input, f.cookie)).json(),
    );
    const reordered = {
      selection: {
        imageDigest: selection.imageDigest,
        commitOid: selection.commitOid.toUpperCase(),
        action: selection.action,
      },
      workspace: {
        versionId: f.workspace.versionId.toUpperCase(),
        resourceId: f.workspace.id.toUpperCase(),
      },
    };
    const second = RepositoryPlanPreviewResponseSchema.parse(
      (await post(previewPath(f.teamId), reordered, f.cookie)).json(),
    );
    expect(second).toEqual(first);
    const saved = await save(f);
    const replay = await post(
      base(f.teamId.toUpperCase()),
      { ...reordered, id: saved.input.id.toUpperCase() },
      f.cookie,
    );
    expect(replay.statusCode).toBe(200);
    const record = RepositoryPlanResponseSchema.parse(
      replay.json(),
    ).repositoryPlan;
    expect(record.planDigest).toBe(
      createHash("sha256")
        .update(serializeRepositoryCommandPlan(record.plan), "utf8")
        .digest("hex"),
    );
    expect(record.planDigest).toBe(first.planDigest);
    expect((await counts()).audits).toBe(1);
  });

  it("keeps the selected configuration immutable after catalog edits, archival and creator role changes", async () => {
    const f = await setup();
    const creator = await member(f, "developer");
    const saved = await save(
      f,
      { ...f.input, id: randomUUID() },
      creator.cookie,
    );
    const edited = await edit(f);
    await archive(f, edited.revision, edited.lifecycleRevision);
    await db.pool.query(
      "UPDATE team_memberships SET role='viewer' WHERE team_id=$1 AND user_id=$2",
      [f.teamId, creator.id],
    );
    for (const cookie of [f.cookie, creator.cookie]) {
      const result = await get(`${base(f.teamId)}/${saved.input.id}`, cookie);
      expect(result.statusCode).toBe(200);
      expect(
        RepositoryPlanResponseSchema.parse(result.json()).repositoryPlan,
      ).toEqual(saved.repositoryPlan);
    }
    expect(saved.repositoryPlan.plan.action.command).toBe(
      definition.actions.test,
    );
    expect(saved.repositoryPlan.workspaceName).toBe(definition.name);
    denied(await post(base(f.teamId), saved.input, creator.cookie), 403);
    expect((await counts()).audits).toBe(1);
  });

  it("replays one saved identity and rejects changed request, creator or tenant with generic ID_CONFLICT", async () => {
    const f = await setup();
    const saved = await save(f);
    const replay = await post(base(f.teamId), saved.input, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().repositoryPlan).toEqual(saved.repositoryPlan);
    const actor = await member(f, "developer");
    const changed = await post(
      base(f.teamId),
      {
        ...saved.input,
        selection: { ...selection, commitOid: "d".repeat(40) },
      },
      f.cookie,
    );
    const creator = await post(base(f.teamId), saved.input, actor.cookie);
    const beta = await team(f, "Beta");
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [beta, f.me.user.id, f.me.organization.id],
    );
    const tenant = await post(base(beta), saved.input, f.cookie);
    for (const result of [changed, creator, tenant]) {
      denied(result, 409, "ID_CONFLICT");
      expect(result.json()).toEqual(changed.json());
    }
    expect((await counts()).audits).toBe(1);
  });

  it("serializes concurrent identical first Saves into one creation and one exact replay", async () => {
    const f = await setup();
    const input = { ...f.input, id: randomUUID() };
    const results = await Promise.all([
      post(base(f.teamId), input, f.cookie),
      post(base(f.teamId), structuredClone(input), f.cookie),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      200, 201,
    ]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect(await counts()).toMatchObject({
      plans: 1,
      audits: 1,
      sessions: 0,
      leases: 0,
      events: 0,
    });
  });

  it("gives concurrent conflicting first Saves one winner without duplicate plans or audits", async () => {
    const f = await setup();
    const input = { ...f.input, id: randomUUID() };
    const results = await Promise.all([
      post(base(f.teamId), input, f.cookie),
      post(
        base(f.teamId),
        { ...input, selection: { ...selection, commitOid: "d".repeat(40) } },
        f.cookie,
      ),
    ]);
    expect(results.map((result) => result.statusCode).sort()).toEqual([
      201, 409,
    ]);
    expect(
      results.find((result) => result.statusCode === 409)!.json().error.code,
    ).toBe("ID_CONFLICT");
    const detail = await get(`${base(f.teamId)}/${input.id}`, f.cookie);
    expect(detail.json()).toEqual(
      results.find((result) => result.statusCode === 201)!.json(),
    );
    expect(await counts()).toMatchObject({ plans: 1, audits: 1 });
  });

  it("reads and identically replays saved plans after API recreation under current authorization", async () => {
    const f = await setup();
    const saved = await save(f);
    await app.close();
    app = await buildApp({ pool: db.pool });
    expect(
      (await get(`${base(f.teamId)}/${saved.input.id}`, f.cookie)).json()
        .repositoryPlan,
    ).toEqual(saved.repositoryPlan);
    const replay = await post(base(f.teamId), saved.input, f.cookie);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().repositoryPlan).toEqual(saved.repositoryPlan);
    await post("/api/auth/logout", {}, f.cookie);
    denied(await get(`${base(f.teamId)}/${saved.input.id}`, f.cookie), 401);
    expect((await counts()).audits).toBe(1);
  });

  it("rejects preview and Save when browser sessions expire while waiting for the Workspace lock", async () => {
    const f = await setup();
    const actor = await member(f, "developer");
    await db.pool.query(
      "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1",
      [actor.id],
    );
    const locker = await db.pool.connect();
    let pending: Promise<Awaited<ReturnType<typeof post>>[]> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query("SELECT 1 FROM resources WHERE id=$1 FOR UPDATE", [
        f.workspace.id,
      ]);
      pending = Promise.all([
        post(previewPath(f.teamId), f.input, actor.cookie),
        post(base(f.teamId), { ...f.input, id: randomUUID() }, actor.cookie),
      ]);
      await blockedBy(pid, 2);
      await expireAfterWait(actor.id, locker);
      await locker.query("COMMIT");
      for (const result of await pending) denied(result, 401);
      expect(await counts()).toMatchObject({ plans: 0, audits: 0 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });

  it("rechecks browser expiry after advisory and rolled-back unique-insert identity waits", async () => {
    const f = await setup();
    for (const wait of ["advisory", "unique-insert"] as const) {
      const actor = await member(f, "developer");
      await db.pool.query(
        "UPDATE auth_sessions SET expires_at=clock_timestamp()+interval '2 seconds' WHERE user_id=$1",
        [actor.id],
      );
      const input = { ...f.input, id: randomUUID() };
      const locker = await db.pool.connect();
      let pending: ReturnType<typeof post> | undefined;
      try {
        await locker.query("BEGIN");
        const pid = (await locker.query("SELECT pg_backend_pid() AS pid"))
          .rows[0].pid as number;
        if (wait === "advisory") {
          await locker.query(
            "SELECT pg_advisory_xact_lock(hashtext('ark:repository-plan'),hashtext($1::text))",
            [input.id],
          );
        } else {
          // An administrative fixture bypasses the application's advisory lock
          // to force a real unique-index wait. Its rollback makes the expired
          // request the would-be inserter, which must still be rejected.
          const plan = compileRepositoryCommandPlan(
            { ...f.input.workspace, definition },
            selection,
          );
          const serialized = serializeRepositoryCommandPlan(plan);
          await locker.query(
            "INSERT INTO repository_plans(id,organization_id,team_id,created_by,workspace_resource_id,workspace_version_id,workspace_name,request,plan,plan_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)",
            [
              input.id,
              f.me.organization.id,
              f.teamId,
              actor.id,
              f.workspace.id,
              f.workspace.versionId,
              definition.name,
              JSON.stringify(input),
              serialized,
              createHash("sha256").update(serialized, "utf8").digest("hex"),
            ],
          );
        }
        pending = post(base(f.teamId), input, actor.cookie);
        await blockedBy(pid);
        await expireAfterWait(actor.id, locker);
        await locker.query(wait === "advisory" ? "COMMIT" : "ROLLBACK");
        denied(await pending, 401);
        expect(await counts()).toMatchObject({ plans: 0, audits: 0 });
      } finally {
        await locker.query("ROLLBACK");
        locker.release();
        if (pending) await pending;
      }
    }
  });

  it("rechecks a pending explicit team revocation before a blocked Save can write", async () => {
    const f = await setup();
    const actor = await member(f, "developer");
    const locker = await db.pool.connect();
    let pending: ReturnType<typeof post> | undefined;
    try {
      await locker.query("BEGIN");
      const pid = (await locker.query("SELECT pg_backend_pid() AS pid")).rows[0]
        .pid as number;
      await locker.query(
        "UPDATE team_memberships SET revoked_at=clock_timestamp() WHERE team_id=$1 AND user_id=$2",
        [f.teamId, actor.id],
      );
      pending = post(
        base(f.teamId),
        { ...f.input, id: randomUUID() },
        actor.cookie,
      );
      await blockedBy(pid);
      await locker.query("COMMIT");
      denied(await pending, 404);
      expect(await counts()).toMatchObject({ plans: 0, audits: 0 });
    } finally {
      await locker.query("ROLLBACK");
      locker.release();
      if (pending) await pending;
    }
  });

  it("rolls back the immutable plan when its safe creation audit fails", async () => {
    const f = await setup();
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT reject_plan_audit CHECK(action <> 'repository_plan.create')",
    );
    denied(
      await post(base(f.teamId), { ...f.input, id: randomUUID() }, f.cookie),
      500,
    );
    expect(await counts()).toMatchObject({ plans: 0, audits: 0 });
    await db.pool.query(
      "ALTER TABLE audit_events DROP CONSTRAINT reject_plan_audit",
    );
    const saved = await save(f);
    const audit = (
      await db.pool.query(
        "SELECT target_id,metadata FROM audit_events WHERE action='repository_plan.create'",
      )
    ).rows[0];
    expect(audit).toEqual({
      target_id: saved.input.id,
      metadata: {
        teamId: f.teamId,
        workspaceResourceId: f.workspace.id,
        workspaceVersionId: f.workspace.versionId,
      },
    });
    expect(JSON.stringify(audit)).not.toContain(definition.actions.test);
    expect(JSON.stringify(audit)).not.toContain(selection.commitOid);
  });

  it("rolls back both plan and audit if concrete response validation fails before commit", async () => {
    const f = await setup();
    const parse = vi
      .spyOn(RepositoryPlanResponseSchema, "parse")
      .mockImplementationOnce(() => {
        throw new Error("Forced response validation failure");
      });
    const input = { ...f.input, id: randomUUID() };
    try {
      denied(await post(base(f.teamId), input, f.cookie), 500);
    } finally {
      parse.mockRestore();
    }
    expect(await counts()).toMatchObject({ plans: 0, audits: 0 });
    await save(f, input);
    expect(await counts()).toMatchObject({ plans: 1, audits: 1 });
  });

  it("paginates at fifty metadata-only rows with stable UUID cursors and no duplicates", async () => {
    const f = await setup();
    const ids = Array.from({ length: 51 }, () => randomUUID()).sort();
    for (const id of ids) await save(f, { ...f.input, id });
    const first = RepositoryPlanListResponseSchema.parse(
      (await get(base(f.teamId), f.cookie)).json(),
    );
    expect(first.repositoryPlans.map((item) => item.id)).toEqual(
      ids.slice(0, 50),
    );
    expect(first.nextCursor).toBe(ids[49]);
    expect(first.repositoryPlans[0]).toMatchObject({
      workspace: f.input.workspace,
      action: "test",
      status: "planned_unverified",
    });
    for (const item of first.repositoryPlans)
      for (const field of [
        "plan",
        "request",
        "command",
        "selection",
        "definition",
      ])
        expect(item).not.toHaveProperty(field);
    const last = RepositoryPlanListResponseSchema.parse(
      (
        await get(`${base(f.teamId)}?cursor=${first.nextCursor}`, f.cookie)
      ).json(),
    );
    expect(last.repositoryPlans.map((item) => item.id)).toEqual(ids.slice(50));
    expect(last.nextCursor).toBeNull();
    expect(
      (await get(`${base(f.teamId)}?cursor=${ids[50]}`, f.cookie)).json(),
    ).toEqual({ repositoryPlans: [], nextCursor: null });
  });

  it("enforces SELECT/INSERT-only runtime access, immutable rows and tenant/kind/version foreign keys", async () => {
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
        `GRANT INSERT ON "${db.schema}".repository_plans,"${db.schema}".audit_events TO "${role}"`,
      );
      await db.admin.query(
        `GRANT UPDATE ON "${db.schema}".users,"${db.schema}".organization_memberships,"${db.schema}".teams,"${db.schema}".team_memberships,"${db.schema}".auth_sessions,"${db.schema}".resources TO "${role}"`,
      );
      const url = new URL(db.connection);
      url.searchParams.set(
        "options",
        `-csearch_path=${db.schema} -crole=${role}`,
      );
      runtime = createPool(url.toString());
      await app.close();
      app = await buildApp({ pool: runtime });
      const saved = await save(f);
      expect(
        (await get(`${base(f.teamId)}/${saved.input.id}`, f.cookie)).statusCode,
      ).toBe(200);
      expect(
        (
          await runtime.query(
            "SELECT has_table_privilege(current_user,'repository_plans','SELECT') AS can_read,has_table_privilege(current_user,'repository_plans','INSERT') AS can_insert,has_table_privilege(current_user,'repository_plans','UPDATE') AS can_update,has_table_privilege(current_user,'repository_plans','DELETE') AS can_delete",
          )
        ).rows[0],
      ).toEqual({
        can_read: true,
        can_insert: true,
        can_update: false,
        can_delete: false,
      });
      for (const sql of [
        "UPDATE repository_plans SET workspace_name='tampered'",
        "DELETE FROM repository_plans",
        "TRUNCATE repository_plans",
        "UPDATE audit_events SET metadata='{}'::jsonb",
      ])
        await expect(runtime.query(sql)).rejects.toMatchObject({
          code: "42501",
        });
      for (const sql of [
        "UPDATE repository_plans SET workspace_name='tampered'",
        "DELETE FROM repository_plans",
      ])
        await expect(db.pool.query(sql)).rejects.toMatchObject({
          code: "P0001",
          message: "ARK_IMMUTABLE_REPOSITORY_PLAN",
        });

      const source = (
        await db.pool.query("SELECT * FROM repository_plans WHERE id=$1", [
          saved.input.id,
        ])
      ).rows[0];
      // Additional catalog fixtures use the administrator-backed application;
      // the runtime pool remains alive solely for the permission assertions.
      await app.close();
      app = await buildApp({ pool: db.pool });
      const other = await workspace(f.teamId, f.cookie, {
        ...definition,
        name: "Other FK workspace",
      });
      const beta = await team(f, "FK Beta");
      await db.pool.query(
        "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
        [beta, f.me.user.id, f.me.organization.id],
      );
      const agentResult = await post(
        `/api/teams/${f.teamId}/agents`,
        {
          id: randomUUID(),
          schemaVersion: 1,
          definition: {
            name: "FK agent",
            description: "",
            instructions: "Inert",
            runtime: "stub",
            modelPreference: null,
            capabilities: [],
          },
        },
        f.cookie,
      );
      expect(agentResult.statusCode).toBe(201);
      const agent = agentResult.json().agent as {
        id: string;
        versionId: string;
      };
      for (const override of [
        {
          workspace_resource_id: randomUUID(),
          workspace_version_id: randomUUID(),
        },
        {
          workspace_resource_id: f.workspace.id,
          workspace_version_id: other.versionId,
        },
        {
          workspace_resource_id: agent.id,
          workspace_version_id: agent.versionId,
        },
        { team_id: beta },
        { created_by: randomUUID() },
      ]) {
        const row = { ...source, ...override, id: randomUUID() };
        const pin = {
          resourceId: row.workspace_resource_id,
          versionId: row.workspace_version_id,
        };
        const request = { ...row.request, id: row.id, workspace: pin };
        const plan = { ...row.plan, workspace: pin };
        await expect(
          db.pool.query(
            "INSERT INTO repository_plans(id,organization_id,team_id,created_by,workspace_resource_id,workspace_version_id,workspace_name,request,plan,plan_digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)",
            [
              row.id,
              row.organization_id,
              row.team_id,
              row.created_by,
              row.workspace_resource_id,
              row.workspace_version_id,
              row.workspace_name,
              JSON.stringify(request),
              JSON.stringify(plan),
              row.plan_digest,
            ],
          ),
        ).rejects.toMatchObject({ code: "23503" });
      }
      expect(await counts()).toMatchObject({
        plans: 1,
        audits: 1,
        runners: 0,
        sessions: 0,
        leases: 0,
        events: 0,
      });
    } finally {
      await app.close();
      if (runtime) await runtime.end();
      await db.admin.query(`DROP OWNED BY "${role}"`);
      await db.admin.query(`DROP ROLE "${role}"`);
    }
  });
});
