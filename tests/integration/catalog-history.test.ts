import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentResponseSchema,
  FlowResponseSchema,
  ResourceVersionListResponseSchema,
  ResourceVersionResponseSchema,
  WorkspaceResponseSchema,
  type FlowDefinition,
  type MeResponse,
} from "@ark/contracts";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/credentials.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const setup = {
  ownerName: "History Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "History Tests",
  teamName: "Alpha",
};
const workspaceDefinition = {
  name: "History workspace",
  description: "  Preserve historical configuration. 🚀  ",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "node:24",
  workingDirectory: ".",
  actions: {
    install: "  pnpm install  ",
    test: "pnpm test\npnpm test:unit",
    lint: "",
    build: "",
  },
};
const agentDefinition = {
  name: "History agent",
  description: "Historical inert configuration.",
  instructions: "  Inspect the complete change.\nPreserve instructions. 🚀  ",
  runtime: "stub" as const,
  modelPreference: "example/model-v1",
  capabilities: ["read_files" as const],
};
type Kind = "workspace" | "agent" | "flow";
type Record = ReturnType<typeof WorkspaceResponseSchema.parse>["workspace"];
const kinds: Kind[] = ["workspace", "agent", "flow"];
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;

const collection = (teamId: string, kind: Kind) =>
  `/api/teams/${teamId}/${kind}s`;
const detail = (teamId: string, kind: Kind, id: string) =>
  `${collection(teamId, kind)}/${id}`;
const history = (teamId: string, kind: Kind, id: string) =>
  `${detail(teamId, kind, id)}/versions`;
const get = (url: string, cookie?: string) =>
  app.inject({
    method: "GET",
    url,
    headers: { host: headers.host, ...(cookie ? { cookie } : {}) },
  });
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
    payload: payload as object,
  });
function record(kind: Kind, response: unknown): Record {
  if (kind === "workspace")
    return WorkspaceResponseSchema.parse(response).workspace;
  if (kind === "agent") return AgentResponseSchema.parse(response).agent;
  return FlowResponseSchema.parse(response).flow;
}
const pin = (value: Record) => ({
  resourceId: value.id,
  versionId: value.versionId,
});
const restore = (
  teamId: string,
  kind: Kind,
  current: Record,
  sourceId: string,
  cookie?: string,
) =>
  mutate(
    "POST",
    `${detail(teamId, kind, current.id)}/restore`,
    {
      revision: current.revision,
      versionId: sourceId,
    },
    cookie,
  );
const update = (
  teamId: string,
  kind: Kind,
  current: Record,
  definition: unknown,
  cookie: string,
) =>
  mutate(
    "PUT",
    detail(teamId, kind, current.id),
    {
      revision: current.revision,
      schemaVersion: 1,
      definition,
    },
    cookie,
  );

async function create(
  teamId: string,
  kind: Kind,
  definition: unknown,
  cookie: string,
) {
  const response = await mutate(
    "POST",
    collection(teamId, kind),
    {
      id: randomUUID(),
      schemaVersion: 1,
      definition,
    },
    cookie,
  );
  expect(response.statusCode).toBe(201);
  return record(kind, response.json());
}
async function fixture() {
  const bootstrap = await mutate("POST", "/api/bootstrap", setup);
  expect(bootstrap.statusCode).toBe(201);
  const me = bootstrap.json<MeResponse>();
  const cookie = String(bootstrap.headers["set-cookie"]).split(";")[0]!;
  const teamId = me.teams[0]!.id;
  const workspace = await create(
    teamId,
    "workspace",
    workspaceDefinition,
    cookie,
  );
  const agent = await create(teamId, "agent", agentDefinition, cookie);
  const stageId = randomUUID();
  const flowDefinition: FlowDefinition = {
    name: "History flow",
    description: "Restore the exact dependency pins.",
    workspace: pin(workspace),
    inputs: [{ name: "task", type: "text" }],
    stages: [
      {
        id: stageId,
        name: "Plan",
        agent: pin(agent),
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
  };
  const flow = await create(teamId, "flow", flowDefinition, cookie);
  return {
    me,
    cookie,
    teamId,
    records: { workspace, agent, flow },
    definitions: {
      workspace: workspaceDefinition,
      agent: agentDefinition,
      flow: flowDefinition,
    },
  };
}
async function member(
  organizationId: string,
  teamId: string,
  role: "developer" | "reviewer" | "viewer",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'History Member',$3)",
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
async function counts(resourceId: string) {
  return (
    await db.pool.query<{ versions: number; restores: number }>(
      `SELECT (SELECT count(*)::int FROM resource_versions WHERE resource_id=$1) AS versions,
      (SELECT count(*)::int FROM audit_events WHERE target_id=$1 AND action LIKE '%.restored') AS restores`,
      [resourceId],
    )
  ).rows[0]!;
}
async function otherTeam(organizationId: string, userId?: string) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,$3)",
    [id, organizationId, `History team ${id}`],
  );
  if (userId)
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [id, userId, organizationId],
    );
  return id;
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("catalog history and immutable restore with real PostgreSQL", () => {
  it.each(kinds)(
    "restores exact %s snapshots as new revisions and rejects stale or concurrent replay",
    async (kind) => {
      const f = await fixture();
      const original = f.records[kind];
      const changed = {
        ...f.definitions[kind],
        name: `Renamed ${kind}`,
        description: "Current definition",
      };
      const edited = record(
        kind,
        (await update(f.teamId, kind, original, changed, f.cookie)).json(),
      );
      const originalRead = ResourceVersionResponseSchema.parse(
        (
          await get(
            `${history(f.teamId, kind, original.id)}/${original.versionId}`,
            f.cookie,
          )
        ).json(),
      );
      expect(originalRead.version.definition).toEqual(f.definitions[kind]);
      expect(originalRead.version.revision).toBe(1);
      const restoredResponse = await restore(
        f.teamId,
        kind,
        edited,
        original.versionId,
        f.cookie,
      );
      expect(restoredResponse.statusCode).toBe(200);
      const restored = record(kind, restoredResponse.json());
      expect(restored).toMatchObject({
        id: original.id,
        revision: 3,
        name: f.definitions[kind].name,
        definition: f.definitions[kind],
      });
      expect(restored.versionId).not.toBe(original.versionId);
      expect(restored.versionId).not.toBe(edited.versionId);
      expect(restored.createdAt).toBe(original.createdAt);
      expect(
        (
          await get(
            `${history(f.teamId, kind, original.id)}/${original.versionId}`,
            f.cookie,
          )
        ).json(),
      ).toEqual(originalRead);
      expect(
        ResourceVersionResponseSchema.parse(
          (
            await get(
              `${history(f.teamId, kind, original.id)}/${edited.versionId}`,
              f.cookie,
            )
          ).json(),
        ).version.definition,
      ).toEqual(changed);
      const audit = await db.pool.query(
        "SELECT action,metadata FROM audit_events WHERE target_id=$1 AND action=$2",
        [original.id, `${kind}.restored`],
      );
      expect(audit.rows).toEqual([
        {
          action: `${kind}.restored`,
          metadata: {
            revision: 3,
            sourceVersionId: original.versionId,
            sourceRevision: 1,
          },
        },
      ]);
      const stale = await restore(
        f.teamId,
        kind,
        edited,
        original.versionId,
        f.cookie,
      );
      expect(stale.statusCode).toBe(409);
      expect(stale.json().error.code).toBe("REVISION_CONFLICT");
      const simultaneous = await Promise.all([
        restore(f.teamId, kind, restored, original.versionId, f.cookie),
        restore(f.teamId, kind, restored, original.versionId, f.cookie),
      ]);
      expect(
        simultaneous.map((response) => response.statusCode).sort(),
      ).toEqual([200, 409]);
      expect(
        simultaneous.find((response) => response.statusCode === 409)!.json()
          .error.code,
      ).toBe("REVISION_CONFLICT");
      expect(await counts(original.id)).toEqual({ versions: 4, restores: 2 });
      const current = record(
        kind,
        simultaneous.find((response) => response.statusCode === 200)!.json(),
      );
      const repeatedContent = await restore(
        f.teamId,
        kind,
        current,
        current.versionId,
        f.cookie,
      );
      expect(repeatedContent.statusCode).toBe(200);
      expect(record(kind, repeatedContent.json())).toMatchObject({
        revision: 5,
        definition: f.definitions[kind],
      });
      await app.close();
      app = await buildApp({ pool: db.pool });
      expect(
        (await get(detail(f.teamId, kind, original.id), f.cookie)).json(),
      ).toEqual(repeatedContent.json());
    },
  );

  it.each(kinds)(
    "pages %s history by descending revision without definition contents or new-head duplicates",
    async (kind) => {
      const f = await fixture();
      const original = f.records[kind];
      // Generated fixture snapshots exercise the existing resource/revision index
      // without making 52 unrelated HTTP writes.
      await db.pool.query(
        `INSERT INTO resource_versions(resource_id,revision,schema_version,definition,created_by_user_id)
      SELECT v.resource_id,g,1,v.definition,v.created_by_user_id
      FROM resource_versions v CROSS JOIN generate_series(2,53) g WHERE v.id=$1`,
        [original.versionId],
      );
      await db.pool.query("UPDATE resources SET revision=53 WHERE id=$1", [
        original.id,
      ]);
      const first = ResourceVersionListResponseSchema.parse(
        (await get(history(f.teamId, kind, original.id), f.cookie)).json(),
      );
      expect(first.versions.map((version) => version.revision)).toEqual(
        Array.from({ length: 50 }, (_, index) => 53 - index),
      );
      expect(first.nextCursor).toBe(4);
      for (const version of first.versions) {
        expect(version).toMatchObject({
          resourceId: original.id,
          teamId: f.teamId,
          schemaVersion: 1,
        });
        expect(version).not.toHaveProperty("definition");
        expect(version).not.toHaveProperty("name");
      }
      const current = record(
        kind,
        (await get(detail(f.teamId, kind, original.id), f.cookie)).json(),
      );
      expect(
        (await update(f.teamId, kind, current, f.definitions[kind], f.cookie))
          .statusCode,
      ).toBe(200);
      const second = ResourceVersionListResponseSchema.parse(
        (
          await get(
            `${history(f.teamId, kind, original.id)}?cursor=${first.nextCursor}`,
            f.cookie,
          )
        ).json(),
      );
      expect(second.versions.map((version) => version.revision)).toEqual([
        3, 2, 1,
      ]);
      expect(second.nextCursor).toBeNull();
      expect(
        ResourceVersionListResponseSchema.parse(
          (await get(history(f.teamId, kind, original.id), f.cookie)).json(),
        ).versions[0]!.revision,
      ).toBe(54);
      expect(
        (
          await get(
            `${history(f.teamId, kind, original.id)}?cursor=1`,
            f.cookie,
          )
        ).json(),
      ).toEqual({ versions: [], nextCursor: null });
      expect(
        (await get(history(f.teamId, kind, randomUUID()), f.cookie)).statusCode,
      ).toBe(404);
    },
  );

  it("rejects anonymous and malformed history/restore requests without adding snapshots", async () => {
    const f = await fixture();
    for (const kind of kinds) {
      const current = f.records[kind];
      expect((await get(history(f.teamId, kind, current.id))).statusCode).toBe(
        401,
      );
      expect(
        (
          await get(
            `${history(f.teamId, kind, current.id)}/${current.versionId}`,
          )
        ).statusCode,
      ).toBe(401);
      expect(
        (await restore(f.teamId, kind, current, current.versionId)).statusCode,
      ).toBe(401);
      for (const query of [
        "cursor=0",
        "cursor=-1",
        "cursor=1.5",
        "cursor=2147483648",
        "cursor=bad",
        "limit=500",
      ])
        expect(
          (
            await get(
              `${history(f.teamId, kind, current.id)}?${query}`,
              f.cookie,
            )
          ).statusCode,
        ).toBe(400);
      for (const body of [
        { revision: 0, versionId: current.versionId },
        { revision: 2_147_483_647, versionId: current.versionId },
        { revision: 1, versionId: "invalid" },
        {
          revision: 1,
          versionId: current.versionId,
          definition: f.definitions[kind],
        },
      ])
        expect(
          (
            await mutate(
              "POST",
              `${detail(f.teamId, kind, current.id)}/restore`,
              body,
              f.cookie,
            )
          ).statusCode,
        ).toBe(400);
      expect(await counts(current.id)).toEqual({ versions: 1, restores: 0 });
    }
  });

  it("keeps resource/version pairs, kinds, and explicit teams isolated", async () => {
    const f = await fixture();
    const accessibleTeam = await otherTeam(f.me.organization.id, f.me.user.id);
    const privateTeam = await otherTeam(f.me.organization.id);
    for (const kind of kinds) {
      const current = f.records[kind];
      const sibling = await create(
        f.teamId,
        kind,
        { ...f.definitions[kind], name: `Sibling ${kind}` },
        f.cookie,
      );
      for (const sourceId of [
        sibling.versionId,
        randomUUID(),
        f.records[kind === "workspace" ? "agent" : "workspace"].versionId,
      ]) {
        expect(
          (
            await get(
              `${history(f.teamId, kind, current.id)}/${sourceId}`,
              f.cookie,
            )
          ).statusCode,
        ).toBe(404);
        expect(
          (await restore(f.teamId, kind, current, sourceId, f.cookie))
            .statusCode,
        ).toBe(404);
      }
      for (const otherKind of kinds.filter((candidate) => candidate !== kind)) {
        expect(
          (await get(history(f.teamId, otherKind, current.id), f.cookie))
            .statusCode,
        ).toBe(404);
        expect(
          (
            await restore(
              f.teamId,
              otherKind,
              current,
              current.versionId,
              f.cookie,
            )
          ).statusCode,
        ).toBe(404);
      }
      for (const teamId of [accessibleTeam, privateTeam]) {
        expect(
          (await get(history(teamId, kind, current.id), f.cookie)).statusCode,
        ).toBe(404);
        expect(
          (await restore(teamId, kind, current, current.versionId, f.cookie))
            .statusCode,
        ).toBe(404);
      }
      expect(await counts(current.id)).toEqual({ versions: 1, restores: 0 });
    }
  });

  it("allows readers to browse history, authorizes developer restore, and reapplies revocation", async () => {
    const f = await fixture();
    for (const role of ["reviewer", "viewer"] as const) {
      const reader = await member(f.me.organization.id, f.teamId, role);
      for (const kind of kinds) {
        const current = f.records[kind];
        expect(
          (await get(history(f.teamId, kind, current.id), reader.cookie))
            .statusCode,
        ).toBe(200);
        expect(
          (
            await get(
              `${history(f.teamId, kind, current.id)}/${current.versionId}`,
              reader.cookie,
            )
          ).statusCode,
        ).toBe(200);
        expect(
          (
            await restore(
              f.teamId,
              kind,
              current,
              current.versionId,
              reader.cookie,
            )
          ).statusCode,
        ).toBe(403);
      }
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
        [reader.id],
      );
      expect(
        (
          await get(
            history(f.teamId, "workspace", f.records.workspace.id),
            reader.cookie,
          )
        ).statusCode,
      ).toBe(404);
    }
    const developer = await member(f.me.organization.id, f.teamId, "developer");
    for (const kind of kinds) {
      const restored = await restore(
        f.teamId,
        kind,
        f.records[kind],
        f.records[kind].versionId,
        developer.cookie,
      );
      expect(restored.statusCode).toBe(200);
    }
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
      [developer.id],
    );
    for (const kind of kinds)
      expect(
        (
          await restore(
            f.teamId,
            kind,
            f.records[kind],
            f.records[kind].versionId,
            developer.cookie,
          )
        ).statusCode,
      ).toBe(404);
  });

  it.each(kinds)(
    "keeps unknown %s schemas readable and rejects unsupported or invalid restore sources atomically",
    async (kind) => {
      const f = await fixture();
      const original = f.records[kind];
      const changed = {
        ...f.definitions[kind],
        description: "New current content",
      };
      const current = record(
        kind,
        (await update(f.teamId, kind, original, changed, f.cookie)).json(),
      );
      const unknownDefinition = { futurePolicy: { preserve: true } };
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=2,definition=$1::jsonb WHERE id=$2",
        [JSON.stringify(unknownDefinition), original.versionId],
      );
      expect(
        ResourceVersionResponseSchema.parse(
          (
            await get(
              `${history(f.teamId, kind, original.id)}/${original.versionId}`,
              f.cookie,
            )
          ).json(),
        ).version.definition,
      ).toEqual(unknownDefinition);
      let denied = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(denied.statusCode).toBe(409);
      expect(denied.json().error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
      expect(denied.json().error.fieldErrors.versionId).toEqual([
        "Choose a version with a supported schema.",
      ]);
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=1 WHERE id=$1",
        [original.versionId],
      );
      denied = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(denied.statusCode).toBe(409);
      expect(denied.json().error.code).toBe("INVALID_STORED_DEFINITION");
      expect(denied.json().error.fieldErrors.versionId).toEqual([
        "Choose a version with a supported, valid definition.",
      ]);
      await db.pool.query(
        "UPDATE resource_versions SET definition=$1::jsonb WHERE id=$2",
        [JSON.stringify(f.definitions[kind]), original.versionId],
      );
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=2 WHERE id=$1",
        [current.versionId],
      );
      denied = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(denied.statusCode).toBe(409);
      expect(denied.json().error.code).toBe("UNSUPPORTED_SCHEMA_VERSION");
      expect(denied.json().error).not.toHaveProperty("fieldErrors.versionId");
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=1,definition=$1::jsonb WHERE id=$2",
        [JSON.stringify(unknownDefinition), current.versionId],
      );
      denied = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(denied.statusCode).toBe(409);
      expect(denied.json().error.code).toBe("INVALID_STORED_DEFINITION");
      expect(denied.json().error).not.toHaveProperty("fieldErrors.versionId");
      expect(await counts(original.id)).toEqual({ versions: 2, restores: 0 });
      expect(
        (
          await db.pool.query("SELECT revision FROM resources WHERE id=$1", [
            original.id,
          ])
        ).rows[0].revision,
      ).toBe(2);
    },
  );

  it("rolls back historical names that now conflict and restore writes whose audit fails", async () => {
    const f = await fixture();
    for (const kind of kinds) {
      const original = f.records[kind];
      const current = record(
        kind,
        (
          await update(
            f.teamId,
            kind,
            original,
            { ...f.definitions[kind], name: `Renamed ${kind}` },
            f.cookie,
          )
        ).json(),
      );
      const sibling = await create(
        f.teamId,
        kind,
        f.definitions[kind],
        f.cookie,
      );
      const conflicting = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(conflicting.statusCode).toBe(409);
      expect(conflicting.json().error.code).toBe("NAME_CONFLICT");
      expect(await counts(original.id)).toEqual({ versions: 2, restores: 0 });
      await update(
        f.teamId,
        kind,
        sibling,
        { ...f.definitions[kind], name: `Freed historical name ${kind}` },
        f.cookie,
      );
      await db.pool.query(
        "ALTER TABLE audit_events ADD CONSTRAINT reject_history_restore CHECK(action NOT LIKE '%.restored')",
      );
      const failed = await restore(
        f.teamId,
        kind,
        current,
        original.versionId,
        f.cookie,
      );
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.code).toBe("INTERNAL_ERROR");
      expect(await counts(original.id)).toEqual({ versions: 2, restores: 0 });
      expect(
        (await get(detail(f.teamId, kind, original.id), f.cookie)).json(),
      ).toEqual({ [kind]: current });
      await db.pool.query(
        "ALTER TABLE audit_events DROP CONSTRAINT reject_history_restore",
      );
    }
  });

  it("retains historical Flow pins and freshly validates the selected dependency snapshots and ownership", async () => {
    const f = await fixture();
    const workspace2 = record(
      "workspace",
      (
        await update(
          f.teamId,
          "workspace",
          f.records.workspace,
          { ...workspaceDefinition, description: "Workspace revision 2" },
          f.cookie,
        )
      ).json(),
    );
    const agent2 = record(
      "agent",
      (
        await update(
          f.teamId,
          "agent",
          f.records.agent,
          { ...agentDefinition, instructions: "Changed instructions" },
          f.cookie,
        )
      ).json(),
    );
    const newerFlow = {
      ...f.definitions.flow,
      workspace: pin(workspace2),
      stages: f.definitions.flow.stages.map((stage) => ({
        ...stage,
        agent: pin(agent2),
      })),
    };
    let current = record(
      "flow",
      (
        await update(f.teamId, "flow", f.records.flow, newerFlow, f.cookie)
      ).json(),
    );
    // An unsupported dependency head must not invalidate a supported old pin.
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2 WHERE id=ANY($1::uuid[])",
      [[workspace2.versionId, agent2.versionId]],
    );
    const restored = await restore(
      f.teamId,
      "flow",
      current,
      f.records.flow.versionId,
      f.cookie,
    );
    expect(restored.statusCode).toBe(200);
    current = record("flow", restored.json());
    expect(current).toMatchObject({
      revision: 3,
      definition: f.definitions.flow,
    });
    for (const dependency of [f.records.workspace, f.records.agent]) {
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=2 WHERE id=$1",
        [dependency.versionId],
      );
      const rejected = await restore(
        f.teamId,
        "flow",
        current,
        f.records.flow.versionId,
        f.cookie,
      );
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error.code).toBe("UNSUPPORTED_DEPENDENCY");
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=1 WHERE id=$1",
        [dependency.versionId],
      );
    }
    const transferredTeam = await otherTeam(f.me.organization.id);
    await db.pool.query("UPDATE resources SET team_id=$1 WHERE id=$2", [
      transferredTeam,
      f.records.workspace.id,
    ]);
    const unavailable = await restore(
      f.teamId,
      "flow",
      current,
      f.records.flow.versionId,
      f.cookie,
    );
    expect(unavailable.statusCode).toBe(400);
    expect(unavailable.json().error.code).toBe("INVALID_DEPENDENCY");
    expect(unavailable.json()).not.toHaveProperty("flow");
    expect(await counts(current.id)).toEqual({ versions: 3, restores: 1 });
    expect(
      (await get(detail(f.teamId, "flow", current.id), f.cookie)).json(),
    ).toEqual({ flow: current });
  });

  it("rolls back restore when persisted response validation fails before commit", async () => {
    const f = await fixture();
    // SQL permits a tab-only resource name; the public response schema rejects
    // it. This disposable trigger verifies that response parsing is atomic.
    await db.pool
      .query(`CREATE FUNCTION invalid_history_response() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN UPDATE resources SET name=chr(9) WHERE id=NEW.resource_id; RETURN NEW; END $$;
      CREATE TRIGGER invalid_history_response AFTER INSERT ON resource_versions FOR EACH ROW
      EXECUTE FUNCTION invalid_history_response()`);
    for (const kind of kinds) {
      const current = f.records[kind];
      const failed = await restore(
        f.teamId,
        kind,
        current,
        current.versionId,
        f.cookie,
      );
      expect(failed.statusCode).toBe(500);
      expect(failed.json().error.code).toBe("INTERNAL_ERROR");
      expect(await counts(current.id)).toEqual({ versions: 1, restores: 0 });
      expect(
        (await get(detail(f.teamId, kind, current.id), f.cookie)).json(),
      ).toEqual({ [kind]: current });
    }
  });

  it("waits for revocation before restore and rejects a freshly unauthorized write", async () => {
    const f = await fixture();
    const developer = await member(f.me.organization.id, f.teamId, "developer");
    const blocker = await db.pool.connect();
    let committed = false;
    let pending: ReturnType<typeof restore> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await blocker.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2",
        [f.teamId, developer.id],
      );
      pending = restore(
        f.teamId,
        "workspace",
        f.records.workspace,
        f.records.workspace.versionId,
        developer.cookie,
      );
      await expect
        .poll(
          async () =>
            (
              await db.pool.query<{ blocked: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND state='active' AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))
          AND query LIKE '%team_memberships%') AS blocked`,
                [pid],
              )
            ).rows[0]!.blocked,
          { timeout: 5000, interval: 20 },
        )
        .toBe(true);
      await blocker.query("COMMIT");
      committed = true;
      expect((await pending).statusCode).toBe(404);
      expect(await counts(f.records.workspace.id)).toEqual({
        versions: 1,
        restores: 0,
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

  it("rechecks Flow dependency ownership after a concurrent transfer releases its lock", async () => {
    const f = await fixture();
    const transferredTeam = await otherTeam(f.me.organization.id);
    const blocker = await db.pool.connect();
    let committed = false;
    let pending: ReturnType<typeof restore> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await blocker.query("UPDATE resources SET team_id=$1 WHERE id=$2", [
        transferredTeam,
        f.records.agent.id,
      ]);
      pending = restore(
        f.teamId,
        "flow",
        f.records.flow,
        f.records.flow.versionId,
        f.cookie,
      );
      await expect
        .poll(
          async () =>
            (
              await db.pool.query<{ blocked: boolean }>(
                `SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND state='active' AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid))
          AND query LIKE '%resources%' AND query LIKE '%FOR SHARE%') AS blocked`,
                [pid],
              )
            ).rows[0]!.blocked,
          { timeout: 5000, interval: 20 },
        )
        .toBe(true);
      await blocker.query("COMMIT");
      committed = true;
      const denied = await pending;
      expect(denied.statusCode).toBe(400);
      expect(denied.json().error.code).toBe("INVALID_DEPENDENCY");
      expect(await counts(f.records.flow.id)).toEqual({
        versions: 1,
        restores: 0,
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
});
