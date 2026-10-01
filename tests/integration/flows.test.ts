import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentResponseSchema,
  FlowDefinitionSchema,
  FlowListResponseSchema,
  FlowResponseSchema,
  ResourceVersionResponseSchema,
  WorkspaceResponseSchema,
  type FlowDefinition,
  type MeResponse,
  type ResourceVersionReference,
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
  ownerName: "Flow Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Flow Tests",
  teamName: "Alpha",
};
const workspaceDefinition = {
  name: "Project workspace",
  description: "Fixture repository configuration.",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "node:24",
  workingDirectory: ".",
  actions: { install: "", test: "pnpm test", lint: "", build: "" },
};
const agentDefinition = {
  name: "Planning agent",
  description: "Fixture configuration only.",
  instructions: "  Prepare a structured plan.\nPreserve instructions. 🚀  ",
  runtime: "stub",
  modelPreference: null,
  capabilities: ["read_files"],
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
const listPath = (teamId: string) => `/api/teams/${teamId}/flows`;
const detailPath = (teamId: string, id: string) => `${listPath(teamId)}/${id}`;
const versionPath = (
  teamId: string,
  kind: "workspaces" | "agents",
  reference: ResourceVersionReference,
) =>
  `/api/teams/${teamId}/${kind}/${reference.resourceId}/versions/${reference.versionId}`;
const create = (
  teamId: string,
  cookie: string,
  definition: FlowDefinition,
  id: string = randomUUID(),
) =>
  mutate(
    "POST",
    listPath(teamId),
    { id, schemaVersion: 1, definition },
    cookie,
  );
const update = (
  teamId: string,
  id: string,
  cookie: string,
  definition: FlowDefinition,
  revision = 1,
) =>
  mutate(
    "PUT",
    detailPath(teamId, id),
    { revision, schemaVersion: 1, definition },
    cookie,
  );
const pin = (resource: {
  id: string;
  versionId: string;
}): ResourceVersionReference => ({
  resourceId: resource.id,
  versionId: resource.versionId,
});

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
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Flow Member',$3)",
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

async function dependencies(teamId: string, cookie: string) {
  const workspaceResponse = await mutate(
    "POST",
    `/api/teams/${teamId}/workspaces`,
    { id: randomUUID(), schemaVersion: 1, definition: workspaceDefinition },
    cookie,
  );
  expect(workspaceResponse.statusCode).toBe(201);
  const agentResponse = await mutate(
    "POST",
    `/api/teams/${teamId}/agents`,
    { id: randomUUID(), schemaVersion: 1, definition: agentDefinition },
    cookie,
  );
  expect(agentResponse.statusCode).toBe(201);
  return {
    workspace: WorkspaceResponseSchema.parse(workspaceResponse.json())
      .workspace,
    agent: AgentResponseSchema.parse(agentResponse.json()).agent,
  };
}

function flow(
  workspace: ResourceVersionReference,
  agent: ResourceVersionReference,
): FlowDefinition {
  const planId = randomUUID();
  const reviewId = randomUUID();
  return {
    name: "Plan and review",
    description:
      "  Preserve this ordered configuration.\nUnicode 🚀 and whitespace.  ",
    workspace,
    inputs: [
      { name: "task", type: "text" },
      { name: "context", type: "json" },
    ],
    stages: [
      {
        id: planId,
        name: "Plan",
        agent,
        inputs: [
          {
            name: "request",
            type: "text",
            source: { kind: "flow_input", port: "task" },
          },
          {
            name: "details",
            type: "json",
            source: { kind: "flow_input", port: "context" },
          },
        ],
        outputs: [
          { name: "plan", type: "json" },
          { name: "explanation", type: "text" },
        ],
      },
      {
        id: reviewId,
        name: "Review",
        agent,
        inputs: [
          {
            name: "proposal",
            type: "json",
            source: { kind: "stage_output", stageId: planId, port: "plan" },
          },
        ],
        outputs: [{ name: "report", type: "text" }],
      },
    ],
    outputs: [
      {
        name: "result",
        type: "text",
        source: { kind: "stage_output", stageId: reviewId, port: "report" },
      },
    ],
  };
}

async function fixture() {
  const identity = await bootstrap();
  const records = await dependencies(identity.teamId, identity.cookie);
  return {
    ...identity,
    ...records,
    definition: flow(pin(records.workspace), pin(records.agent)),
  };
}

async function flowCounts() {
  return (
    await db.pool.query(`SELECT
    (SELECT count(*)::int FROM resources WHERE kind='flow') AS resources,
    (SELECT count(*)::int FROM resource_versions v JOIN resources r ON r.id=v.resource_id WHERE r.kind='flow') AS versions,
    (SELECT count(*)::int FROM audit_events WHERE action LIKE 'flow.%') AS audits`)
  ).rows[0];
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("V0.2 ordered flows with real PostgreSQL", () => {
  it("rejects anonymous requests, malformed graphs, and route/envelope fields without flow writes", async () => {
    const { teamId, cookie, definition } = await fixture();
    const id = randomUUID();
    for (const response of [
      await get(listPath(teamId)),
      await get(detailPath(teamId, id)),
      await mutate("POST", listPath(teamId), {
        id,
        schemaVersion: 1,
        definition,
      }),
      await mutate("PUT", detailPath(teamId, id), {
        revision: 1,
        schemaVersion: 1,
        definition,
      }),
    ])
      expect(response.statusCode).toBe(401);
    const invalids: unknown[] = [
      { ...definition, stages: [] },
      { ...definition, stages: [...definition.stages].reverse() },
      { ...definition, inputs: [] },
      { ...definition, outputs: [{ ...definition.outputs[0], type: "json" }] },
      { ...definition, description: "bad\u0000text" },
      {
        ...definition,
        inputs: [{ name: "task", type: "text", value: "not configuration" }],
      },
      { ...definition, workspace: { ...definition.workspace, revision: 1 } },
    ];
    for (const invalid of invalids) {
      const response = await mutate(
        "POST",
        listPath(teamId),
        { id, schemaVersion: 1, definition: invalid },
        cookie,
      );
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
    for (const payload of [
      { id, schemaVersion: 2, definition },
      { id, schemaVersion: 1, definition, organizationId: randomUUID() },
    ])
      expect(
        (await mutate("POST", listPath(teamId), payload, cookie)).statusCode,
      ).toBe(400);
    expect((await get(detailPath(teamId, "bad"), cookie)).statusCode).toBe(400);
    expect(
      (await get(`${listPath(teamId)}?cursor=bad`, cookie)).statusCode,
    ).toBe(400);
    expect(
      (await get(`${listPath(teamId)}?limit=1000`, cookie)).statusCode,
    ).toBe(400);
    expect(await flowCounts()).toEqual({
      resources: 0,
      versions: 0,
      audits: 0,
    });
  });

  it("round-trips every field and preserves old pins as dependency heads advance", async () => {
    const { teamId, cookie, workspace, agent, definition } = await fixture();
    const created = await create(teamId, cookie, definition);
    expect(created.statusCode).toBe(201);
    const original = FlowResponseSchema.parse(created.json()).flow;
    expect(original).toMatchObject({
      teamId,
      revision: 1,
      schemaVersion: 1,
      definition,
    });
    await app.close();
    app = await buildApp({ pool: db.pool });
    expect((await get(detailPath(teamId, original.id), cookie)).json()).toEqual(
      created.json(),
    );
    const newWorkspace = await mutate(
      "PUT",
      `/api/teams/${teamId}/workspaces/${workspace.id}`,
      {
        revision: 1,
        schemaVersion: 1,
        definition: {
          ...workspaceDefinition,
          name: "Renamed workspace",
          sourceRef: "next",
        },
      },
      cookie,
    );
    expect(newWorkspace.statusCode).toBe(200);
    const newAgent = await mutate(
      "PUT",
      `/api/teams/${teamId}/agents/${agent.id}`,
      {
        revision: 1,
        schemaVersion: 1,
        definition: {
          ...agentDefinition,
          name: "Renamed agent",
          instructions: "A changed instruction.",
        },
      },
      cookie,
    );
    expect(newAgent.statusCode).toBe(200);
    const changed = structuredClone(definition);
    changed.name = "Reviewed flow";
    changed.description = "\nChanged notes.  ";
    // One flow deliberately pins two different immutable revisions of one agent.
    changed.stages[1]!.agent = pin(
      AgentResponseSchema.parse(newAgent.json()).agent,
    );
    changed.stages[0]!.name = "Prepare";
    changed.stages[0]!.inputs[0]!.name = "requested_task";
    const saved = await update(teamId, original.id, cookie, changed);
    expect(saved.statusCode).toBe(200);
    const current = FlowResponseSchema.parse(saved.json()).flow;
    expect(current).toMatchObject({
      id: original.id,
      revision: 2,
      definition: changed,
      createdAt: original.createdAt,
    });
    expect(current.versionId).not.toBe(original.versionId);
    expect((await get(detailPath(teamId, original.id), cookie)).json()).toEqual(
      saved.json(),
    );
    const versions = await db.pool.query(
      "SELECT revision,definition FROM resource_versions WHERE resource_id=$1 ORDER BY revision",
      [original.id],
    );
    expect(versions.rows).toEqual([
      { revision: 1, definition },
      { revision: 2, definition: changed },
    ]);
    const events = await db.pool.query(
      "SELECT action,metadata FROM audit_events WHERE target_id=$1 ORDER BY action",
      [original.id],
    );
    expect(events.rows).toEqual([
      { action: "flow.created", metadata: { revision: 1 } },
      { action: "flow.updated", metadata: { revision: 2 } },
    ]);
  });

  it("reads historical snapshots with exact resource/kind boundaries and current authorization", async () => {
    const { teamId, cookie, me, workspace, agent } = await fixture();
    await mutate(
      "PUT",
      `/api/teams/${teamId}/agents/${agent.id}`,
      {
        revision: 1,
        schemaVersion: 1,
        definition: { ...agentDefinition, name: "New name" },
      },
      cookie,
    );
    for (const [kind, resource, expected] of [
      ["workspaces", workspace, workspaceDefinition],
      ["agents", agent, agentDefinition],
    ] as const) {
      const url = versionPath(teamId, kind, pin(resource));
      expect((await get(url)).statusCode).toBe(401);
      const response = await get(url, cookie);
      expect(response.statusCode).toBe(200);
      const version = ResourceVersionResponseSchema.parse(
        response.json(),
      ).version;
      expect(version).toMatchObject({
        resourceId: resource.id,
        versionId: resource.versionId,
        teamId,
        revision: 1,
        schemaVersion: 1,
        definition: expected,
      });
      expect(version).not.toHaveProperty("name");
      expect(
        (
          await get(
            versionPath(teamId, kind, {
              resourceId: resource.id,
              versionId: randomUUID(),
            }),
            cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await get(
            versionPath(teamId, kind, {
              resourceId: randomUUID(),
              versionId: resource.versionId,
            }),
            cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await get(
            versionPath(teamId, kind, {
              resourceId: resource.id,
              versionId: "bad",
            }),
            cookie,
          )
        ).statusCode,
      ).toBe(400);
    }
    expect(
      (await get(versionPath(teamId, "workspaces", pin(agent)), cookie))
        .statusCode,
    ).toBe(404);
    expect(
      (await get(versionPath(teamId, "agents", pin(workspace)), cookie))
        .statusCode,
    ).toBe(404);
    const reader = await member(me.organization.id, teamId, "viewer");
    expect(
      (await get(versionPath(teamId, "agents", pin(agent)), reader.cookie))
        .statusCode,
    ).toBe(200);
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
      [reader.id],
    );
    expect(
      (await get(versionPath(teamId, "agents", pin(agent)), reader.cookie))
        .statusCode,
    ).toBe(404);
    const futureDefinition = {
      ...workspaceDefinition,
      future: { preserve: true },
    };
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2,definition=$2 WHERE id=$1",
      [workspace.versionId, futureDefinition],
    );
    const future = await get(
      versionPath(teamId, "workspaces", pin(workspace)),
      cookie,
    );
    expect(future.statusCode).toBe(200);
    expect(
      ResourceVersionResponseSchema.parse(future.json()).version,
    ).toMatchObject({ schemaVersion: 2, definition: futureDefinition });
  });

  it("rejects missing, wrong-kind, and forged resource/version pairs atomically on create and edit", async () => {
    const { teamId, cookie, definition, workspace, agent } = await fixture();
    const original = await create(teamId, cookie, definition);
    const id = original.json().flow.id;
    for (const reference of [
      { resourceId: randomUUID(), versionId: workspace.versionId },
      { resourceId: workspace.id, versionId: randomUUID() },
      { resourceId: workspace.id, versionId: agent.versionId },
      pin(agent),
    ]) {
      const invalid = { ...definition, workspace: reference };
      for (const response of [
        await create(teamId, cookie, {
          ...invalid,
          name: "Invalid workspace reference",
        }),
        await update(teamId, id, cookie, invalid),
      ]) {
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("INVALID_DEPENDENCY");
      }
    }
    const invalid = structuredClone(definition);
    invalid.stages[1]!.agent = pin(workspace);
    const rejected = await update(teamId, id, cookie, invalid);
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("INVALID_DEPENDENCY");
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      original.json(),
    );
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 1,
      audits: 1,
    });
  });

  it("rejects dependencies outside the flow team even when the actor belongs to both teams", async () => {
    const { teamId, cookie, me, definition } = await fixture();
    for (const foreignOrganization of [false, true]) {
      const organizationId = foreignOrganization
        ? randomUUID()
        : me.organization.id;
      if (foreignOrganization) {
        // The deployed schema intentionally permits one organization only.
        // Relax that unique constraint solely inside this disposable ark_test
        // schema to prove the query's defensive organization boundary too.
        await db.pool.query(
          "ALTER TABLE organizations DROP CONSTRAINT organizations_singleton_key",
        );
        await db.pool.query(
          "INSERT INTO organizations(id,name) VALUES($1,'Other organization')",
          [organizationId],
        );
      }
      const foreignTeam = randomUUID();
      await db.pool.query(
        "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Other team')",
        [foreignTeam, organizationId],
      );
      const actor = await member(organizationId, foreignTeam);
      const records = await dependencies(foreignTeam, actor.cookie);
      // Explicit membership in both same-organization teams still does not make
      // dependencies cross-team: sharing/grants have not been implemented.
      if (!foreignOrganization) {
        await db.pool.query(
          "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
          [foreignTeam, me.user.id, organizationId],
        );
        expect(
          (
            await get(
              versionPath(foreignTeam, "agents", pin(records.agent)),
              cookie,
            )
          ).statusCode,
        ).toBe(200);
      } else {
        expect(
          (
            await get(
              versionPath(foreignTeam, "agents", pin(records.agent)),
              cookie,
            )
          ).statusCode,
        ).toBe(404);
      }
      expect(
        (await get(versionPath(teamId, "agents", pin(records.agent)), cookie))
          .statusCode,
      ).toBe(404);
      const forbiddenWorkspace = {
        ...definition,
        workspace: pin(records.workspace),
      };
      const forbiddenAgent = structuredClone(definition);
      forbiddenAgent.stages[0]!.agent = pin(records.agent);
      for (const value of [forbiddenWorkspace, forbiddenAgent]) {
        const response = await create(teamId, cookie, value);
        expect(response.statusCode).toBe(400);
        expect(response.json().error.code).toBe("INVALID_DEPENDENCY");
        expect(response.json()).not.toHaveProperty("flow");
      }
    }
    expect(await flowCounts()).toEqual({
      resources: 0,
      versions: 0,
      audits: 0,
    });
  });

  it("validates the pinned schema rather than the current dependency head and rechecks creation replay", async () => {
    const { teamId, cookie, definition, workspace, agent } = await fixture();
    const created = await create(teamId, cookie, definition);
    const id = created.json().flow.id;
    for (const [resource, validDefinition] of [
      [workspace, workspaceDefinition],
      [agent, agentDefinition],
    ] as const) {
      for (const schemaVersion of [1, 2]) {
        await db.pool.query(
          "UPDATE resource_versions SET schema_version=$2,definition=$3 WHERE id=$1",
          [resource.versionId, schemaVersion, { incompatible: true }],
        );
        for (const response of [
          await create(teamId, cookie, {
            ...definition,
            name: "Unsupported pin",
          }),
          await create(teamId, cookie, definition, id),
          await update(teamId, id, cookie, definition),
        ]) {
          expect(response.statusCode).toBe(400);
          expect(response.json().error.code).toBe("UNSUPPORTED_DEPENDENCY");
        }
        await db.pool.query(
          "UPDATE resource_versions SET schema_version=1,definition=$2 WHERE id=$1",
          [resource.versionId, validDefinition],
        );
      }
    }
    const head = await mutate(
      "PUT",
      `/api/teams/${teamId}/agents/${agent.id}`,
      {
        revision: 1,
        schemaVersion: 1,
        definition: { ...agentDefinition, instructions: "Latest instructions" },
      },
      cookie,
    );
    expect(head.statusCode).toBe(200);
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2,definition=$2 WHERE id=$1",
      [head.json().agent.versionId, { future: true }],
    );
    expect((await update(teamId, id, cookie, definition)).statusCode).toBe(200);
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 2,
      audits: 2,
    });
  });

  it("normalizes uppercase pins and serializes identical creation retries without extra versions", async () => {
    const { teamId, cookie, definition } = await fixture();
    const id = randomUUID();
    const uppercase = structuredClone(definition);
    uppercase.workspace.resourceId =
      uppercase.workspace.resourceId.toUpperCase();
    uppercase.workspace.versionId = uppercase.workspace.versionId.toUpperCase();
    for (const stage of uppercase.stages) {
      stage.id = stage.id.toUpperCase();
      stage.agent.resourceId = stage.agent.resourceId.toUpperCase();
      stage.agent.versionId = stage.agent.versionId.toUpperCase();
      for (const input of stage.inputs)
        if (input.source.kind === "stage_output")
          input.source.stageId = input.source.stageId.toUpperCase();
    }
    for (const output of uppercase.outputs)
      output.source.stageId = output.source.stageId.toUpperCase();
    const results = await Promise.all([
      create(teamId, cookie, uppercase, id),
      create(teamId, cookie, definition, id),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 201,
    ]);
    expect(results[0]!.json()).toEqual(results[1]!.json());
    expect(results[0]!.json().flow.definition).toEqual(definition);
    const conflict = await create(
      teamId,
      cookie,
      { ...definition, description: "Changed" },
      id,
    );
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("ID_CONFLICT");
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 1,
      audits: 1,
    });
  });

  it("isolates catalog kinds and names while rejecting stale concurrent edits", async () => {
    const { teamId, cookie, definition, workspace, agent } = await fixture();
    const original = await create(teamId, cookie, {
      ...definition,
      name: workspace.name,
    });
    expect(original.statusCode).toBe(201);
    const id = original.json().flow.id;
    for (const resource of [workspace, agent]) {
      expect(
        (await get(detailPath(teamId, resource.id), cookie)).statusCode,
      ).toBe(404);
      expect(
        (await update(teamId, resource.id, cookie, definition)).statusCode,
      ).toBe(404);
      const collision = await create(teamId, cookie, definition, resource.id);
      expect(collision.statusCode).toBe(409);
      expect(collision.json().error.code).toBe("ID_CONFLICT");
    }
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
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(
      results.find((response) => response.statusCode === 409)!.json().error
        .code,
    ).toBe("REVISION_CONFLICT");
    const winner = results.find((response) => response.statusCode === 200)!;
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      winner.json(),
    );
    const duplicateName = await create(teamId, cookie, {
      ...definition,
      name: definition.name.toUpperCase(),
    });
    expect(duplicateName.statusCode).toBe(409);
    expect(duplicateName.json().error.code).toBe("NAME_CONFLICT");
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 2,
      audits: 2,
    });
  });

  it("allows read-only roles to inspect but not create or edit and immediately applies revoked membership", async () => {
    const { teamId, cookie, me, definition } = await fixture();
    const original = await create(teamId, cookie, definition);
    const id = original.json().flow.id;
    for (const role of ["reviewer", "viewer"]) {
      const reader = await member(me.organization.id, teamId, role);
      expect((await get(listPath(teamId), reader.cookie)).statusCode).toBe(200);
      expect((await get(detailPath(teamId, id), reader.cookie)).json()).toEqual(
        original.json(),
      );
      expect((await create(teamId, reader.cookie, definition)).statusCode).toBe(
        403,
      );
      expect(
        (await update(teamId, id, reader.cookie, definition)).statusCode,
      ).toBe(403);
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
        [reader.id],
      );
      expect(
        (await get(detailPath(teamId, id), reader.cookie)).statusCode,
      ).toBe(404);
    }
    const otherTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Private team')",
      [otherTeam, me.organization.id],
    );
    expect((await get(listPath(otherTeam), cookie)).statusCode).toBe(404);
    expect((await create(otherTeam, cookie, definition)).statusCode).toBe(404);
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 1,
      audits: 1,
    });
  });

  it("waits for a pending revocation and refuses the blocked flow write", async () => {
    const { teamId, me, definition } = await fixture();
    const developer = await member(me.organization.id, teamId);
    const blocker = await db.pool.connect();
    let committed = false;
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
      pending = create(teamId, developer.cookie, definition);
      await expect
        .poll(
          async () =>
            (
              await db.pool.query<{ blocked: boolean }>(
                `SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND state='active' AND wait_event_type='Lock'
        AND $1::integer=ANY(pg_blocking_pids(pid))
        AND query LIKE '%team_memberships%'
      ) AS blocked`,
                [blockerPid],
              )
            ).rows[0]!.blocked,
          { timeout: 5000, interval: 20 },
        )
        .toBe(true);
      await blocker.query("COMMIT");
      committed = true;
      expect((await pending).statusCode).toBe(404);
      expect(await flowCounts()).toEqual({
        resources: 0,
        versions: 0,
        audits: 0,
      });
    } finally {
      try {
        if (!committed) await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
      if (pending) await pending;
    }
  });

  it("rechecks dependency ownership after waiting on a concurrent transfer and rolls back the flow", async () => {
    const { teamId, cookie, me, definition, workspace } = await fixture();
    const otherTeam = randomUUID();
    await db.pool.query(
      "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Transferred dependency')",
      [otherTeam, me.organization.id],
    );
    const blocker = await db.pool.connect();
    let committed = false;
    let pending: Promise<Awaited<ReturnType<typeof create>>> | undefined;
    try {
      await blocker.query("BEGIN");
      const blockerPid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      // Administrative fixture only: there is no transfer endpoint in this
      // increment. A pending ownership change must not leave a save authorized
      // by the old statement snapshot after its dependency lock is released.
      await blocker.query("UPDATE resources SET team_id=$1 WHERE id=$2", [
        otherTeam,
        workspace.id,
      ]);
      pending = create(teamId, cookie, definition);
      await expect
        .poll(
          async () =>
            (
              await db.pool.query<{ blocked: boolean }>(
                `SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
        AND state='active' AND wait_event_type='Lock'
        AND $1::integer=ANY(pg_blocking_pids(pid))
        AND query LIKE '%resources%' AND query LIKE '%FOR SHARE%'
      ) AS blocked`,
                [blockerPid],
              )
            ).rows[0]!.blocked,
          { timeout: 5000, interval: 20 },
        )
        .toBe(true);
      await blocker.query("COMMIT");
      committed = true;
      const response = await pending;
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe("INVALID_DEPENDENCY");
      expect(await flowCounts()).toEqual({
        resources: 0,
        versions: 0,
        audits: 0,
      });
      expect(
        (await get(versionPath(teamId, "workspaces", pin(workspace)), cookie))
          .statusCode,
      ).toBe(404);
    } finally {
      try {
        if (!committed) await blocker.query("ROLLBACK");
      } finally {
        blocker.release();
      }
      if (pending) await pending;
    }
  });

  it("fits maximal valid escaped configuration within 128 KiB and rejects oversized bodies and non-JSON mutations", async () => {
    const { teamId, cookie, definition } = await fixture();
    const ports = Array.from({ length: 8 }, (_, index) => ({
      name: `p${index}${"x".repeat(38)}`,
      type: "text" as const,
    }));
    const stageIds = Array.from({ length: 20 }, () => randomUUID());
    const stages = Array.from({ length: 20 }, (_, index) => ({
      id: stageIds[index]!,
      name: `s${index}${"\u0001".repeat(80 - `s${index}`.length)}`,
      agent: definition.stages[0]!.agent,
      inputs: ports.map((port) => ({
        ...port,
        source:
          index === 0
            ? { kind: "flow_input" as const, port: port.name }
            : {
                kind: "stage_output" as const,
                stageId: stageIds[index - 1]!,
                port: port.name,
              },
      })),
      outputs: ports,
    }));
    const maximal: FlowDefinition = {
      ...definition,
      name: `f${"\u0001".repeat(79)}`,
      description: "\u0002".repeat(2000),
      inputs: ports,
      stages,
      outputs: ports.map((port) => ({
        ...port,
        source: {
          kind: "stage_output",
          stageId: stages[19]!.id,
          port: port.name,
        },
      })),
    };
    expect(FlowDefinitionSchema.parse(maximal)).toEqual(maximal);
    const bytes = Buffer.byteLength(
      JSON.stringify({
        id: randomUUID(),
        schemaVersion: 1,
        definition: maximal,
      }),
    );
    expect(bytes).toBeGreaterThan(65_536);
    expect(bytes).toBeLessThan(131_072);
    const created = await create(teamId, cookie, maximal);
    expect(created.statusCode).toBe(201);
    const id = created.json().flow.id;
    expect(
      (await get(detailPath(teamId, id), cookie)).json().flow.definition,
    ).toEqual(maximal);
    const oversized = { ...definition, description: "x".repeat(131_073) };
    expect((await create(teamId, cookie, oversized)).statusCode).toBe(413);
    expect((await update(teamId, id, cookie, oversized)).statusCode).toBe(413);
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
            payload: { revision: 1, schemaVersion: 1, definition },
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
          payload: JSON.stringify({
            revision: 1,
            schemaVersion: 1,
            definition,
          }),
        })
      ).statusCode,
    ).toBe(415);
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 1,
      audits: 1,
    });
  });

  it("rolls back resources, immutable snapshots, and edits when auditing fails", async () => {
    const { teamId, cookie, definition } = await fixture();
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT force_flow_failure CHECK(action <> 'flow.created')",
    );
    expect((await create(teamId, cookie, definition)).statusCode).toBe(500);
    expect(await flowCounts()).toEqual({
      resources: 0,
      versions: 0,
      audits: 0,
    });
    await db.pool.query(
      "ALTER TABLE audit_events DROP CONSTRAINT force_flow_failure",
    );
    const original = await create(teamId, cookie, definition);
    const id = original.json().flow.id;
    await db.pool.query(
      "ALTER TABLE audit_events ADD CONSTRAINT force_flow_failure CHECK(action <> 'flow.updated')",
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
      original.json(),
    );
    expect(await flowCounts()).toEqual({
      resources: 1,
      versions: 1,
      audits: 1,
    });
  });

  it("reads unknown stored flow schemas intact and refuses to overwrite them", async () => {
    const { teamId, cookie, definition } = await fixture();
    const created = await create(teamId, cookie, definition);
    const id = created.json().flow.id;
    const future = { ...definition, futureTransitions: { preserve: true } };
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2,definition=$2 WHERE resource_id=$1",
      [id, future],
    );
    const read = await get(detailPath(teamId, id), cookie);
    expect(read.statusCode).toBe(200);
    expect(FlowResponseSchema.parse(read.json()).flow).toMatchObject({
      schemaVersion: 2,
      definition: future,
    });
    const denied = await update(teamId, id, cookie, definition);
    expect(denied.statusCode).toBe(409);
    expect(denied.json().error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
    expect((await get(detailPath(teamId, id), cookie)).json()).toEqual(
      read.json(),
    );
  });

  it("paginates fifty flow summaries without definitions or duplicate IDs", async () => {
    const { teamId, cookie, me, definition } = await fixture();
    const ids = Array.from({ length: 51 }, () => randomUUID()).sort();
    await withTransaction(db.pool, async (client) => {
      for (const [index, id] of ids.entries()) {
        const value = { ...definition, name: `Flow ${index + 1}` };
        await client.query(
          "INSERT INTO resources(id,organization_id,team_id,kind,name,revision) VALUES($1,$2,$3,'flow',$4,1)",
          [id, me.organization.id, teamId, value.name],
        );
        await client.query(
          "INSERT INTO resource_versions(resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,1,1,$2,$3)",
          [id, value, me.user.id],
        );
      }
    });
    const first = FlowListResponseSchema.parse(
      (await get(listPath(teamId), cookie)).json(),
    );
    expect(first.flows.map((item) => item.id)).toEqual(ids.slice(0, 50));
    expect(first.nextCursor).toBe(ids[49]);
    expect(first.flows[0]).not.toHaveProperty("definition");
    const second = FlowListResponseSchema.parse(
      (
        await get(`${listPath(teamId)}?cursor=${first.nextCursor}`, cookie)
      ).json(),
    );
    expect(second.flows.map((item) => item.id)).toEqual(ids.slice(50));
    expect(second.nextCursor).toBeNull();
  });

  it("resolves pins and writes through restricted runtime grants without allowing immutable data tampering", async () => {
    const { teamId, cookie, definition, agent } = await fixture();
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
      expect(
        (await get(versionPath(teamId, "agents", pin(agent)), cookie))
          .statusCode,
      ).toBe(200);
      const created = await create(teamId, cookie, definition);
      expect(created.statusCode).toBe(201);
      expect(
        (
          await update(teamId, created.json().flow.id, cookie, {
            ...definition,
            description: "Runtime edit",
          })
        ).statusCode,
      ).toBe(200);
      for (const sql of [
        "UPDATE resource_versions SET definition='{}'::jsonb",
        "DELETE FROM resource_versions",
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
