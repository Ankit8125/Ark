import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentListResponseSchema,
  AgentResponseSchema,
  FlowListResponseSchema,
  FlowResponseSchema,
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
  type FlowDefinition,
  type MeResponse,
} from "@ark/contracts";
import { createPool, migrate, withTransaction } from "@ark/db";
import { buildApp } from "../../apps/api/src/app.js";
import { hashPassword } from "../../apps/api/src/credentials.js";
import { databaseFixture } from "../helpers/database.js";

const headers = {
  host: "127.0.0.1:3001",
  origin: "http://127.0.0.1:5173",
  "content-type": "application/json",
};
const setup = {
  ownerName: "Archive Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Archive Tests",
  teamName: "Alpha",
};
const workspaceDefinition = {
  name: "Archive workspace",
  description: "Preserve this configuration.",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "node:24",
  workingDirectory: ".",
  actions: { install: "", test: "pnpm test", lint: "", build: "" },
};
const agentDefinition = {
  name: "Archive agent",
  description: "Configuration only.",
  instructions: "  Preserve instructions.\nInspect changes. 🚀  ",
  runtime: "stub" as const,
  modelPreference: null,
  capabilities: ["read_files" as const],
};
type Kind = "workspace" | "agent" | "flow";
type CatalogRecord = ReturnType<
  typeof WorkspaceResponseSchema.parse
>["workspace"];
const kinds: Kind[] = ["workspace", "agent", "flow"];
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const collection = (teamId: string, kind: Kind) =>
  `/api/teams/${teamId}/${kind}s`;
const detail = (teamId: string, kind: Kind, id: string) =>
  `${collection(teamId, kind)}/${id}`;
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
function record(kind: Kind, response: unknown): CatalogRecord {
  if (kind === "workspace")
    return WorkspaceResponseSchema.parse(response).workspace;
  if (kind === "agent") return AgentResponseSchema.parse(response).agent;
  return FlowResponseSchema.parse(response).flow;
}
function list(kind: Kind, response: unknown) {
  if (kind === "workspace") {
    const value = WorkspaceListResponseSchema.parse(response);
    return { records: value.workspaces, nextCursor: value.nextCursor };
  }
  if (kind === "agent") {
    const value = AgentListResponseSchema.parse(response);
    return { records: value.agents, nextCursor: value.nextCursor };
  }
  const value = FlowListResponseSchema.parse(response);
  return { records: value.flows, nextCursor: value.nextCursor };
}
const expected = (current: CatalogRecord) => ({
  revision: current.revision,
  lifecycleRevision: current.lifecycleRevision,
});
const lifecycle = (
  teamId: string,
  kind: Kind,
  current: CatalogRecord,
  action: "archive" | "unarchive",
  cookie?: string,
) =>
  mutate(
    "POST",
    `${detail(teamId, kind, current.id)}/${action}`,
    expected(current),
    cookie,
  );
const update = (
  teamId: string,
  kind: Kind,
  current: CatalogRecord,
  definition: unknown,
  cookie: string,
) =>
  mutate(
    "PUT",
    detail(teamId, kind, current.id),
    { ...expected(current), schemaVersion: 1, definition },
    cookie,
  );
const restore = (
  teamId: string,
  kind: Kind,
  current: CatalogRecord,
  versionId: string,
  cookie: string,
) =>
  mutate(
    "POST",
    `${detail(teamId, kind, current.id)}/restore`,
    { ...expected(current), versionId },
    cookie,
  );
const pin = (current: CatalogRecord) => ({
  resourceId: current.id,
  versionId: current.versionId,
});
async function create(
  teamId: string,
  kind: Kind,
  definition: unknown,
  cookie: string,
  id = randomUUID(),
) {
  const response = await mutate(
    "POST",
    collection(teamId, kind),
    { id, schemaVersion: 1, definition },
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
    name: "Archive flow",
    description: "Retain exact pins.",
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
async function transition(
  f: Awaited<ReturnType<typeof fixture>>,
  kind: Kind,
  current: CatalogRecord,
  action: "archive" | "unarchive",
) {
  const response = await lifecycle(f.teamId, kind, current, action, f.cookie);
  expect(response.statusCode).toBe(200);
  return record(kind, response.json());
}
async function snapshots(id: string) {
  return (
    await db.pool.query(
      "SELECT * FROM resource_versions WHERE resource_id=$1 ORDER BY revision",
      [id],
    )
  ).rows;
}
async function audits(id: string) {
  return (
    await db.pool.query(
      "SELECT action,metadata FROM audit_events WHERE target_id=$1 ORDER BY created_at,action",
      [id],
    )
  ).rows;
}
async function member(
  organizationId: string,
  teamId: string,
  role: "developer" | "reviewer" | "viewer",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Archive Member',$3)",
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
async function otherTeam(
  f: Awaited<ReturnType<typeof fixture>>,
  accessible: boolean,
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,$3)",
    [id, f.me.organization.id, `Team ${id}`],
  );
  if (accessible)
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [id, f.me.user.id, f.me.organization.id],
    );
  return id;
}
function denied(
  response: Awaited<ReturnType<typeof mutate>>,
  status: number,
  code: string,
) {
  expect(response.statusCode).toBe(status);
  expect(response.json().error.code).toBe(code);
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("catalog archive with real PostgreSQL", () => {
  it.each(kinds)(
    "archives and unarchives %s metadata while preserving every immutable snapshot and exact pins",
    async (kind) => {
      const f = await fixture();
      if (kind !== "flow")
        await transition(f, "flow", f.records.flow, "archive");
      const original = f.records[kind];
      const edited = record(
        kind,
        (
          await update(
            f.teamId,
            kind,
            original,
            { ...f.definitions[kind], description: "Edited before archive" },
            f.cookie,
          )
        ).json(),
      );
      expect(edited).toMatchObject({
        revision: 2,
        lifecycleRevision: 1,
        archivedAt: null,
      });
      const before = await snapshots(original.id);
      const archived = await transition(f, kind, edited, "archive");
      expect(archived).toMatchObject({
        id: edited.id,
        versionId: edited.versionId,
        revision: 2,
        lifecycleRevision: 2,
        definition: edited.definition,
        createdAt: edited.createdAt,
      });
      expect(archived.archivedAt).toEqual(expect.any(String));
      expect(
        list(kind, (await get(collection(f.teamId, kind), f.cookie)).json())
          .records,
      ).toEqual([]);
      expect(
        list(
          kind,
          (
            await get(`${collection(f.teamId, kind)}?status=archived`, f.cookie)
          ).json(),
        ).records.map((value) => value.id),
      ).toEqual([original.id]);
      expect(
        (await get(detail(f.teamId, kind, original.id), f.cookie)).json(),
      ).toEqual({ [kind]: archived });
      const history = await get(
        `${detail(f.teamId, kind, original.id)}/versions`,
        f.cookie,
      );
      expect(history.statusCode).toBe(200);
      expect(
        history
          .json()
          .versions.map((value: { revision: number }) => value.revision),
      ).toEqual([2, 1]);
      const source = await get(
        `${detail(f.teamId, kind, original.id)}/versions/${original.versionId}`,
        f.cookie,
      );
      expect(source.statusCode).toBe(200);
      expect(source.json().version.definition).toEqual(f.definitions[kind]);
      denied(
        await update(f.teamId, kind, archived, f.definitions[kind], f.cookie),
        409,
        "RESOURCE_ARCHIVED",
      );
      denied(
        await restore(f.teamId, kind, archived, original.versionId, f.cookie),
        409,
        "RESOURCE_ARCHIVED",
      );
      denied(
        await lifecycle(f.teamId, kind, archived, "archive", f.cookie),
        409,
        "LIFECYCLE_CONFLICT",
      );
      const active = await transition(f, kind, archived, "unarchive");
      expect(active).toMatchObject({
        id: original.id,
        versionId: edited.versionId,
        revision: 2,
        lifecycleRevision: 3,
        archivedAt: null,
        definition: edited.definition,
      });
      expect(await snapshots(original.id)).toEqual(before);
      expect(
        (await audits(original.id)).filter((value) =>
          value.action.endsWith("archived"),
        ),
      ).toEqual([
        {
          action: `${kind}.archived`,
          metadata: { revision: 2, lifecycleRevision: 2 },
        },
        {
          action: `${kind}.unarchived`,
          metadata: { revision: 2, lifecycleRevision: 3 },
        },
      ]);
      expect(
        list(
          kind,
          (
            await get(`${collection(f.teamId, kind)}?status=archived`, f.cookie)
          ).json(),
        ).records,
      ).toEqual([]);
      const restored = record(
        kind,
        (
          await restore(f.teamId, kind, active, original.versionId, f.cookie)
        ).json(),
      );
      expect(restored).toMatchObject({
        revision: 3,
        lifecycleRevision: 3,
        archivedAt: null,
        definition: f.definitions[kind],
      });
      const updated = record(
        kind,
        (
          await update(
            f.teamId,
            kind,
            restored,
            { ...f.definitions[kind], description: "Edited after unarchive" },
            f.cookie,
          )
        ).json(),
      );
      expect(updated).toMatchObject({
        revision: 4,
        lifecycleRevision: 3,
        archivedAt: null,
      });
      expect((await snapshots(original.id)).slice(0, 2)).toEqual(before);
    },
  );

  it.each(kinds)(
    "rejects stale %s content/lifecycle counters, including an archive/unarchive ABA cycle",
    async (kind) => {
      const f = await fixture();
      if (kind !== "flow")
        await transition(f, "flow", f.records.flow, "archive");
      const original = f.records[kind];
      denied(
        await lifecycle(f.teamId, kind, original, "unarchive", f.cookie),
        409,
        "LIFECYCLE_CONFLICT",
      );
      const archived = await transition(f, kind, original, "archive");
      denied(
        await lifecycle(f.teamId, kind, original, "unarchive", f.cookie),
        409,
        "REVISION_CONFLICT",
      );
      const active = await transition(f, kind, archived, "unarchive");
      for (const stale of [
        original,
        { ...active, revision: active.revision + 1 },
      ]) {
        denied(
          await update(f.teamId, kind, stale, f.definitions[kind], f.cookie),
          409,
          "REVISION_CONFLICT",
        );
        denied(
          await restore(f.teamId, kind, stale, original.versionId, f.cookie),
          409,
          "REVISION_CONFLICT",
        );
        denied(
          await lifecycle(f.teamId, kind, stale, "archive", f.cookie),
          409,
          "REVISION_CONFLICT",
        );
      }
      const results = await Promise.all([
        lifecycle(f.teamId, kind, active, "archive", f.cookie),
        lifecycle(f.teamId, kind, active, "archive", f.cookie),
      ]);
      expect(results.map((value) => value.statusCode).sort()).toEqual([
        200, 409,
      ]);
      denied(
        results.find((value) => value.statusCode === 409)!,
        409,
        "REVISION_CONFLICT",
      );
      expect(await snapshots(original.id)).toHaveLength(1);
      expect(await audits(original.id)).toHaveLength(4);
    },
  );

  it.each(kinds)(
    "reserves archived %s names and refuses creation replay after any lifecycle transition",
    async (kind) => {
      const f = await fixture();
      if (kind !== "flow")
        await transition(f, "flow", f.records.flow, "archive");
      const original = f.records[kind];
      const creation = {
        id: original.id,
        schemaVersion: 1,
        definition: f.definitions[kind],
      };
      expect(
        (await mutate("POST", collection(f.teamId, kind), creation, f.cookie))
          .statusCode,
      ).toBe(200);
      const archived = await transition(f, kind, original, "archive");
      denied(
        await mutate("POST", collection(f.teamId, kind), creation, f.cookie),
        409,
        "ID_CONFLICT",
      );
      denied(
        await mutate(
          "POST",
          collection(f.teamId, kind),
          {
            ...creation,
            id: randomUUID(),
            definition: {
              ...f.definitions[kind],
              name: original.name.toUpperCase(),
            },
          },
          f.cookie,
        ),
        409,
        "NAME_CONFLICT",
      );
      await transition(f, kind, archived, "unarchive");
      denied(
        await mutate("POST", collection(f.teamId, kind), creation, f.cookie),
        409,
        "ID_CONFLICT",
      );
      expect(await snapshots(original.id)).toHaveLength(1);
    },
  );

  it.each(kinds)(
    "filters %s status before bounded cursor pagination",
    async (kind) => {
      const f = await fixture();
      const original = f.records[kind];
      // Bulk insertion only creates fixture rows; the API assertions exercise actual filtering and cursors.
      const ids = Array.from(
        { length: 105 },
        (_, index) =>
          `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      );
      await withTransaction(db.pool, async (client) => {
        for (const [index, id] of ids.entries()) {
          const name = `Page ${kind} ${index}`;
          await client.query(
            "INSERT INTO resources(id,organization_id,team_id,kind,name,revision,archived_at,lifecycle_revision) VALUES($1,$2,$3,$4,$5,1,CASE WHEN $6 THEN now() ELSE NULL END,CASE WHEN $6 THEN 2 ELSE 1 END)",
            [id, f.me.organization.id, f.teamId, kind, name, index % 2 === 0],
          );
          await client.query(
            "INSERT INTO resource_versions(resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,1,1,$2::jsonb,$3)",
            [
              id,
              JSON.stringify({ ...f.definitions[kind], name }),
              f.me.user.id,
            ],
          );
        }
      });
      for (const status of ["active", "archived"] as const) {
        const wanted = ids.filter(
          (_, index) => (index % 2 === 0) === (status === "archived"),
        );
        if (status === "active") wanted.push(original.id);
        wanted.sort();
        const first = list(
          kind,
          (
            await get(
              `${collection(f.teamId, kind)}?status=${status}`,
              f.cookie,
            )
          ).json(),
        );
        expect(first.records.map((value) => value.id)).toEqual(
          wanted.slice(0, 50),
        );
        expect(first.nextCursor).toBe(wanted[49]);
        expect(
          first.records.every(
            (value) => (value.archivedAt !== null) === (status === "archived"),
          ),
        ).toBe(true);
        const second = list(
          kind,
          (
            await get(
              `${collection(f.teamId, kind)}?status=${status}&cursor=${first.nextCursor}`,
              f.cookie,
            )
          ).json(),
        );
        expect(second.records.map((value) => value.id)).toEqual(
          wanted.slice(50),
        );
        expect(second.nextCursor).toBeNull();
        if (status === "active")
          expect(
            (await get(collection(f.teamId, kind), f.cookie)).json(),
          ).toEqual(
            (
              await get(`${collection(f.teamId, kind)}?status=active`, f.cookie)
            ).json(),
          );
      }
      for (const query of [
        "status=all",
        "status=",
        "status=active&status=archived",
        "status=archived&limit=100",
        "cursor=bad",
      ])
        expect(
          (await get(`${collection(f.teamId, kind)}?${query}`, f.cookie))
            .statusCode,
        ).toBe(400);
    },
  );

  it("requires strict lifecycle requests, JSON, valid origins, and authenticated resource ownership", async () => {
    const f = await fixture();
    await transition(f, "flow", f.records.flow, "archive");
    const accessibleTeam = await otherTeam(f, true);
    const privateTeam = await otherTeam(f, false);
    for (const kind of kinds) {
      const current = f.records[kind];
      for (const action of ["archive", "unarchive"] as const) {
        const path = `${detail(f.teamId, kind, current.id)}/${action}`;
        expect((await mutate("POST", path, expected(current))).statusCode).toBe(
          401,
        );
        for (const body of [
          { revision: 1 },
          { lifecycleRevision: 1 },
          { revision: 0, lifecycleRevision: 1 },
          { revision: 1, lifecycleRevision: 0 },
          { revision: 1, lifecycleRevision: 2_147_483_647 },
          { ...expected(current), archivedAt: null },
          { ...expected(current), definition: f.definitions[kind] },
        ])
          expect((await mutate("POST", path, body, f.cookie)).statusCode).toBe(
            400,
          );
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: {
                host: headers.host,
                origin: headers.origin,
                cookie: f.cookie,
                "content-type": "text/plain",
              },
              payload: JSON.stringify(expected(current)),
            })
          ).statusCode,
        ).toBe(415);
        expect(
          (
            await app.inject({
              method: "POST",
              url: path,
              headers: {
                ...headers,
                origin: "https://example.test",
                cookie: f.cookie,
              },
              payload: expected(current),
            })
          ).statusCode,
        ).toBe(403);
        expect(
          (
            await mutate(
              "POST",
              path,
              { ...expected(current), extra: "x".repeat(2048) },
              f.cookie,
            )
          ).statusCode,
        ).toBe(413);
        for (const teamId of [accessibleTeam, privateTeam])
          denied(
            await lifecycle(teamId, kind, current, action, f.cookie),
            404,
            "NOT_FOUND",
          );
        for (const otherKind of kinds.filter((value) => value !== kind))
          denied(
            await lifecycle(f.teamId, otherKind, current, action, f.cookie),
            404,
            "NOT_FOUND",
          );
        denied(
          await lifecycle(
            f.teamId,
            kind,
            { ...current, id: randomUUID() },
            action,
            f.cookie,
          ),
          404,
          "NOT_FOUND",
        );
      }
    }
  });

  it("allows authorized readers to inspect archives, restricts lifecycle writes, and applies revocation", async () => {
    const f = await fixture();
    const archivedFlow = await transition(f, "flow", f.records.flow, "archive");
    for (const role of ["reviewer", "viewer"] as const) {
      const reader = await member(f.me.organization.id, f.teamId, role);
      for (const kind of kinds) {
        const current = kind === "flow" ? archivedFlow : f.records[kind];
        expect(
          (
            await get(
              `${collection(f.teamId, kind)}?status=archived`,
              reader.cookie,
            )
          ).statusCode,
        ).toBe(200);
        expect(
          (await get(detail(f.teamId, kind, current.id), reader.cookie))
            .statusCode,
        ).toBe(200);
        expect(
          (
            await get(
              `${detail(f.teamId, kind, current.id)}/versions/${current.versionId}`,
              reader.cookie,
            )
          ).statusCode,
        ).toBe(200);
        for (const action of ["archive", "unarchive"] as const)
          denied(
            await lifecycle(f.teamId, kind, current, action, reader.cookie),
            403,
            "FORBIDDEN",
          );
      }
      await db.pool.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
        [reader.id],
      );
      expect(
        (
          await get(
            `${collection(f.teamId, "flow")}?status=archived`,
            reader.cookie,
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await get(
            `${detail(f.teamId, "flow", archivedFlow.id)}/versions/${archivedFlow.versionId}`,
            reader.cookie,
          )
        ).statusCode,
      ).toBe(404);
    }
    const developer = await member(f.me.organization.id, f.teamId, "developer");
    for (const kind of ["workspace", "agent"] as const) {
      const archived = record(
        kind,
        (
          await lifecycle(
            f.teamId,
            kind,
            f.records[kind],
            "archive",
            developer.cookie,
          )
        ).json(),
      );
      expect(
        (
          await lifecycle(
            f.teamId,
            kind,
            archived,
            "unarchive",
            developer.cookie,
          )
        ).statusCode,
      ).toBe(200);
    }
    expect(
      (
        await lifecycle(
          f.teamId,
          "flow",
          archivedFlow,
          "unarchive",
          developer.cookie,
        )
      ).statusCode,
    ).toBe(200);
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
      [developer.id],
    );
    expect(
      (
        await lifecycle(
          f.teamId,
          "flow",
          archivedFlow,
          "archive",
          developer.cookie,
        )
      ).statusCode,
    ).toBe(404);
  });

  it.each(kinds)(
    "keeps unsupported and invalid current %s definitions fully read-only",
    async (kind) => {
      const f = await fixture();
      if (kind !== "flow")
        await transition(f, "flow", f.records.flow, "archive");
      const original = f.records[kind];
      for (const invalid of [
        {
          schema: 2,
          definition: { future: true },
          code: "UNSUPPORTED_SCHEMA_VERSION",
        },
        {
          schema: 1,
          definition: { invalid: true },
          code: "INVALID_STORED_DEFINITION",
        },
      ]) {
        await db.pool.query(
          "UPDATE resource_versions SET schema_version=$1,definition=$2::jsonb WHERE id=$3",
          [
            invalid.schema,
            JSON.stringify(invalid.definition),
            original.versionId,
          ],
        );
        const before = await audits(original.id);
        denied(
          await lifecycle(f.teamId, kind, original, "archive", f.cookie),
          409,
          invalid.code,
        );
        denied(
          await update(f.teamId, kind, original, f.definitions[kind], f.cookie),
          409,
          invalid.code,
        );
        denied(
          await restore(f.teamId, kind, original, original.versionId, f.cookie),
          409,
          invalid.code,
        );
        await db.pool.query(
          "UPDATE resources SET archived_at=now(),lifecycle_revision=2 WHERE id=$1",
          [original.id],
        );
        const archived = record(
          kind,
          (await get(detail(f.teamId, kind, original.id), f.cookie)).json(),
        );
        expect(archived.definition).toEqual(invalid.definition);
        denied(
          await lifecycle(f.teamId, kind, archived, "unarchive", f.cookie),
          409,
          invalid.code,
        );
        expect(await audits(original.id)).toEqual(before);
        expect(await snapshots(original.id)).toHaveLength(1);
        await db.pool.query(
          "UPDATE resources SET archived_at=NULL,lifecycle_revision=1 WHERE id=$1",
          [original.id],
        );
      }
    },
  );

  it("blocks current active Flow references, but ignores historical and archived Flow references", async () => {
    const f = await fixture();
    for (const kind of ["workspace", "agent"] as const)
      denied(
        await lifecycle(f.teamId, kind, f.records[kind], "archive", f.cookie),
        409,
        "RESOURCE_IN_USE",
      );
    const workspace = await create(
      f.teamId,
      "workspace",
      { ...workspaceDefinition, name: "Replacement workspace" },
      f.cookie,
    );
    const agent = await create(
      f.teamId,
      "agent",
      { ...agentDefinition, name: "Replacement agent" },
      f.cookie,
    );
    const newFlow = {
      ...f.definitions.flow,
      workspace: pin(workspace),
      stages: f.definitions.flow.stages.map((stage) => ({
        ...stage,
        agent: pin(agent),
      })),
    };
    const current = record(
      "flow",
      (
        await update(f.teamId, "flow", f.records.flow, newFlow, f.cookie)
      ).json(),
    );
    for (const kind of ["workspace", "agent"] as const)
      await transition(f, kind, f.records[kind], "archive");
    denied(
      await restore(
        f.teamId,
        "flow",
        current,
        f.records.flow.versionId,
        f.cookie,
      ),
      400,
      "INVALID_DEPENDENCY",
    );
    const archivedFlow = await transition(f, "flow", current, "archive");
    const archivedWorkspace = await transition(
      f,
      "workspace",
      workspace,
      "archive",
    );
    const archivedAgent = await transition(f, "agent", agent, "archive");
    denied(
      await lifecycle(f.teamId, "flow", archivedFlow, "unarchive", f.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    await transition(f, "workspace", archivedWorkspace, "unarchive");
    denied(
      await lifecycle(f.teamId, "flow", archivedFlow, "unarchive", f.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    await transition(f, "agent", archivedAgent, "unarchive");
    const active = await transition(f, "flow", archivedFlow, "unarchive");
    expect(active).toMatchObject({
      definition: newFlow,
      revision: current.revision,
      versionId: current.versionId,
    });
    expect(await snapshots(active.id)).toHaveLength(2);
  });

  it("fails closed on unknown or invalid active Flow definitions while keeping team isolation", async () => {
    const f = await fixture();
    const workspace = await create(
      f.teamId,
      "workspace",
      { ...workspaceDefinition, name: "Unused workspace" },
      f.cookie,
    );
    const agent = await create(
      f.teamId,
      "agent",
      { ...agentDefinition, name: "Unused agent" },
      f.cookie,
    );
    const other = await otherTeam(f, true);
    const foreign = await create(
      other,
      "workspace",
      { ...workspaceDefinition, name: "Other team workspace" },
      f.cookie,
    );
    for (const schemaVersion of [2, 1]) {
      await db.pool.query(
        "UPDATE resource_versions SET schema_version=$1,definition=$2::jsonb WHERE id=$3",
        [
          schemaVersion,
          JSON.stringify({ unsupported: true }),
          f.records.flow.versionId,
        ],
      );
      denied(
        await lifecycle(f.teamId, "workspace", workspace, "archive", f.cookie),
        409,
        "UNVERIFIABLE_DEPENDENCIES",
      );
      denied(
        await lifecycle(f.teamId, "agent", agent, "archive", f.cookie),
        409,
        "UNVERIFIABLE_DEPENDENCIES",
      );
    }
    expect(
      (await lifecycle(other, "workspace", foreign, "archive", f.cookie))
        .statusCode,
    ).toBe(200);
    await db.pool.query(
      "UPDATE resources SET archived_at=now(),lifecycle_revision=2 WHERE id=$1",
      [f.records.flow.id],
    );
    await transition(f, "workspace", workspace, "archive");
    await transition(f, "agent", agent, "archive");
  });

  it("checks inbound Flow references and unsupported definitions beyond the first scan page", async () => {
    const f = await fixture();
    const target = await create(
      f.teamId,
      "workspace",
      { ...workspaceDefinition, name: "Late page dependency" },
      f.cookie,
    );
    const lastId = "00000000-0000-4000-8000-000000000051";
    await withTransaction(db.pool, async (client) => {
      for (let index = 1; index <= 51; index++) {
        const id = `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
        const name = `Scan Flow ${index}`;
        await client.query(
          "INSERT INTO resources(id,organization_id,team_id,kind,name,revision) VALUES($1,$2,$3,'flow',$4,1)",
          [id, f.me.organization.id, f.teamId, name],
        );
        await client.query(
          "INSERT INTO resource_versions(resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,1,1,$2::jsonb,$3)",
          [
            id,
            JSON.stringify({
              ...f.definitions.flow,
              name,
              workspace:
                index === 51 ? pin(target) : f.definitions.flow.workspace,
            }),
            f.me.user.id,
          ],
        );
      }
    });
    denied(
      await lifecycle(f.teamId, "workspace", target, "archive", f.cookie),
      409,
      "RESOURCE_IN_USE",
    );
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2 WHERE resource_id=$1",
      [lastId],
    );
    denied(
      await lifecycle(f.teamId, "workspace", target, "archive", f.cookie),
      409,
      "UNVERIFIABLE_DEPENDENCIES",
    );
    await db.pool.query(
      "UPDATE resources SET archived_at=now(),lifecycle_revision=2 WHERE id=$1",
      [lastId],
    );
    await transition(f, "workspace", target, "archive");
  });

  it("revalidates Flow creation, editing, restore, and reactivation against archived dependencies", async () => {
    const f = await fixture();
    let archivedFlow = await transition(f, "flow", f.records.flow, "archive");
    for (const kind of ["workspace", "agent"] as const) {
      const archived = await transition(f, kind, f.records[kind], "archive");
      denied(
        await mutate(
          "POST",
          collection(f.teamId, "flow"),
          {
            id: randomUUID(),
            schemaVersion: 1,
            definition: { ...f.definitions.flow, name: `New flow ${kind}` },
          },
          f.cookie,
        ),
        400,
        "INVALID_DEPENDENCY",
      );
      denied(
        await lifecycle(f.teamId, "flow", archivedFlow, "unarchive", f.cookie),
        400,
        "INVALID_DEPENDENCY",
      );
      f.records[kind] = await transition(f, kind, archived, "unarchive");
    }
    const unsupportedDependency = f.records.agent;
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=2 WHERE id=$1",
      [unsupportedDependency.versionId],
    );
    denied(
      await lifecycle(f.teamId, "flow", archivedFlow, "unarchive", f.cookie),
      400,
      "UNSUPPORTED_DEPENDENCY",
    );
    await db.pool.query(
      "UPDATE resource_versions SET schema_version=1 WHERE id=$1",
      [unsupportedDependency.versionId],
    );
    const activeFlow = await transition(f, "flow", archivedFlow, "unarchive");
    // Administrative changes are outside API locking guarantees. They exercise fresh validation on every write path.
    await db.pool.query(
      "UPDATE resources SET archived_at=now(),lifecycle_revision=lifecycle_revision+1 WHERE id=$1",
      [f.records.agent.id],
    );
    denied(
      await update(f.teamId, "flow", activeFlow, f.definitions.flow, f.cookie),
      400,
      "INVALID_DEPENDENCY",
    );
    denied(
      await restore(
        f.teamId,
        "flow",
        activeFlow,
        f.records.flow.versionId,
        f.cookie,
      ),
      400,
      "INVALID_DEPENDENCY",
    );
    archivedFlow = await transition(f, "flow", activeFlow, "archive");
    expect(archivedFlow.revision).toBe(1);
  });

  it.each(["audit", "response"] as const)(
    "rolls back lifecycle state when %s validation fails before commit",
    async (failure) => {
      const f = await fixture();
      await transition(f, "flow", f.records.flow, "archive");
      if (failure === "audit")
        await db.pool.query(
          "ALTER TABLE audit_events ADD CONSTRAINT reject_archive_audit CHECK(action NOT LIKE '%.archived' AND action NOT LIKE '%.unarchived') NOT VALID",
        );
      else
        await db.pool.query(
          `CREATE FUNCTION invalidate_archive_response() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE '%.archived' OR NEW.action LIKE '%.unarchived' THEN UPDATE resources SET name=chr(9) WHERE id=NEW.target_id; END IF; RETURN NEW; END $$; CREATE TRIGGER invalidate_archive_response AFTER INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION invalidate_archive_response()`,
        );
      for (const kind of kinds) {
        const current = record(
          kind,
          (
            await get(detail(f.teamId, kind, f.records[kind].id), f.cookie)
          ).json(),
        );
        const beforeVersions = await snapshots(current.id);
        const beforeAudits = await audits(current.id);
        denied(
          await lifecycle(
            f.teamId,
            kind,
            current,
            kind === "flow" ? "unarchive" : "archive",
            f.cookie,
          ),
          500,
          "INTERNAL_ERROR",
        );
        expect(
          (await get(detail(f.teamId, kind, current.id), f.cookie)).json(),
        ).toEqual({ [kind]: current });
        expect(await snapshots(current.id)).toEqual(beforeVersions);
        expect(await audits(current.id)).toEqual(beforeAudits);
      }
    },
  );

  it("waits for a membership revocation and refuses the newly unauthorized archive", async () => {
    const f = await fixture();
    const developer = await member(f.me.organization.id, f.teamId, "developer");
    const blocker = await db.pool.connect();
    let pending: ReturnType<typeof lifecycle> | undefined;
    try {
      await blocker.query("BEGIN");
      const pid = (
        await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
      ).rows[0]!.pid;
      await blocker.query(
        "UPDATE team_memberships SET revoked_at=now() WHERE team_id=$1 AND user_id=$2",
        [f.teamId, developer.id],
      );
      pending = lifecycle(
        f.teamId,
        "flow",
        f.records.flow,
        "archive",
        developer.cookie,
      );
      await blockedBy(pid, "%team_memberships%");
      await blocker.query("COMMIT");
      expect((await pending).statusCode).toBe(404);
      expect(await audits(f.records.flow.id)).toHaveLength(1);
    } finally {
      await blocker.query("ROLLBACK");
      blocker.release();
      if (pending) await pending;
    }
  });
});

async function blockedBy(pid: number, queryPattern: string): Promise<number> {
  let blockedPid: number | undefined;
  await expect
    .poll(
      async () => {
        const result = await db.pool.query<{ pid: number }>(
          `SELECT pid FROM pg_stat_activity WHERE datname=current_database() AND state='active' AND wait_event_type='Lock' AND $1::integer=ANY(pg_blocking_pids(pid)) AND query LIKE $2`,
          [pid, queryPattern],
        );
        blockedPid = result.rows[0]?.pid;
        return blockedPid !== undefined;
      },
      { timeout: 5000, interval: 20 },
    )
    .toBe(true);
  return blockedPid!;
}

type FlowOperation = "create" | "update" | "restore" | "unarchive";
async function raceFixture(operation: FlowOperation) {
  const f = await fixture();
  const target = await create(
    f.teamId,
    "workspace",
    { ...workspaceDefinition, name: "Racing dependency" },
    f.cookie,
  );
  const definition: FlowDefinition = {
    ...f.definitions.flow,
    workspace: pin(target),
  };
  let current = f.records.flow;
  let source = current.versionId;
  let id = current.id;
  if (operation === "create") id = randomUUID();
  if (operation === "restore" || operation === "unarchive") {
    current = record(
      "flow",
      (await update(f.teamId, "flow", current, definition, f.cookie)).json(),
    );
    source = current.versionId;
    if (operation === "restore")
      current = record(
        "flow",
        (
          await update(f.teamId, "flow", current, f.definitions.flow, f.cookie)
        ).json(),
      );
    else current = await transition(f, "flow", current, "archive");
  }
  const run = () => {
    if (operation === "create")
      return mutate(
        "POST",
        collection(f.teamId, "flow"),
        {
          id,
          schemaVersion: 1,
          definition: { ...definition, name: "Racing new flow" },
        },
        f.cookie,
      );
    if (operation === "update")
      return update(f.teamId, "flow", current, definition, f.cookie);
    if (operation === "restore")
      return restore(f.teamId, "flow", current, source, f.cookie);
    return lifecycle(f.teamId, "flow", current, "unarchive", f.cookie);
  };
  return { ...f, target, flowId: id, run };
}

async function gateAudit(action: string, id: string) {
  // The generated-schema hash isolates this transaction gate from other tests.
  const gate = `archive-race:${db.schema}`;
  await db.pool.query(
    `CREATE FUNCTION gate_archive_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action=TG_ARGV[0] AND NEW.target_id::text=TG_ARGV[1] THEN PERFORM pg_advisory_xact_lock(hashtext(TG_ARGV[2])); END IF; RETURN NEW; END $$`,
  );
  // All interpolated values here are static actions or generated UUID/schema text.
  await db.pool.query(
    `CREATE TRIGGER gate_archive_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION gate_archive_audit('${action}','${id}','${gate}')`,
  );
  const blocker = await db.pool.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT pg_advisory_xact_lock(hashtext($1))", [gate]);
  const pid = (
    await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")
  ).rows[0]!.pid;
  return { blocker, pid };
}

describe("Flow and dependency archive races", () => {
  it.each(["create", "update", "restore", "unarchive"] as const)(
    "observes the committed Flow %s after waiting for its dependency lock",
    async (operation) => {
      const f = await raceFixture(operation);
      const action = {
        create: "created",
        update: "updated",
        restore: "restored",
        unarchive: "unarchived",
      }[operation];
      const { blocker, pid } = await gateAudit(`flow.${action}`, f.flowId);
      let flowPending: ReturnType<typeof f.run> | undefined;
      let archivePending: ReturnType<typeof lifecycle> | undefined;
      try {
        flowPending = f.run();
        const flowPid = await blockedBy(pid, "%INSERT INTO audit_events%");
        archivePending = lifecycle(
          f.teamId,
          "workspace",
          f.target,
          "archive",
          f.cookie,
        );
        await blockedBy(flowPid, "%resources%FOR UPDATE%");
        await blocker.query("COMMIT");
        expect((await flowPending).statusCode).toBe(
          operation === "create" ? 201 : 200,
        );
        denied(await archivePending, 409, "RESOURCE_IN_USE");
        expect(
          record(
            "workspace",
            (
              await get(detail(f.teamId, "workspace", f.target.id), f.cookie)
            ).json(),
          ).archivedAt,
        ).toBeNull();
        expect(await audits(f.target.id)).toHaveLength(1);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.all([flowPending, archivePending]);
      }
    },
  );

  it.each(["create", "update", "restore", "unarchive"] as const)(
    "rejects Flow %s after a concurrent dependency archive commits",
    async (operation) => {
      const f = await raceFixture(operation);
      const beforeVersions = await snapshots(f.flowId);
      const beforeAudits = await audits(f.flowId);
      const { blocker, pid } = await gateAudit(
        "workspace.archived",
        f.target.id,
      );
      let flowPending: ReturnType<typeof f.run> | undefined;
      let archivePending: ReturnType<typeof lifecycle> | undefined;
      try {
        archivePending = lifecycle(
          f.teamId,
          "workspace",
          f.target,
          "archive",
          f.cookie,
        );
        const archivePid = await blockedBy(pid, "%INSERT INTO audit_events%");
        flowPending = f.run();
        await blockedBy(archivePid, "%resources%FOR SHARE%");
        await blocker.query("COMMIT");
        expect((await archivePending).statusCode).toBe(200);
        denied(await flowPending, 400, "INVALID_DEPENDENCY");
        expect(await snapshots(f.flowId)).toEqual(beforeVersions);
        expect(await audits(f.flowId)).toEqual(beforeAudits);
        if (operation === "create")
          expect(
            (await get(detail(f.teamId, "flow", f.flowId), f.cookie))
              .statusCode,
          ).toBe(404);
      } finally {
        await blocker.query("ROLLBACK");
        blocker.release();
        await Promise.all([flowPending, archivePending]);
      }
    },
  );
});

describe("archive migration upgrade", () => {
  it("adds active lifecycle metadata to populated 001–004 catalogs without rewriting records or snapshots", async () => {
    // databaseFixture already enforces local ark_test. This second generated schema
    // is populated using the actual older migration files, then upgraded by migrate.
    const schema = `ark_test_${randomBytes(10).toString("hex")}`;
    if (!/^ark_test_[a-f0-9]{20}$/.test(schema))
      throw new Error("Unsafe archive upgrade fixture target.");
    await db.admin.query(`CREATE SCHEMA "${schema}"`);
    const url = new URL(db.connection);
    url.searchParams.set("options", `-csearch_path=${schema}`);
    const legacy = createPool(url.toString());
    try {
      await legacy.query(
        "CREATE TABLE schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
      );
      for (const version of [
        "001_identity",
        "002_workspaces",
        "003_agents",
        "004_flows",
      ]) {
        const sql = await readFile(
          new URL(
            `../../packages/db/migrations/${version}.sql`,
            import.meta.url,
          ),
          "utf8",
        );
        await withTransaction(legacy, async (client) => {
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)",
            [
              version,
              createHash("sha256")
                .update(sql.replaceAll("\r\n", "\n"))
                .digest("hex"),
            ],
          );
        });
      }
      const organization = randomUUID();
      const team = randomUUID();
      const user = randomUUID();
      await legacy.query(
        "INSERT INTO organizations(id,name) VALUES($1,'Legacy archive fixture')",
        [organization],
      );
      await legacy.query(
        "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Legacy team')",
        [team, organization],
      );
      await legacy.query(
        "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'legacy@example.test','Legacy user','unused-test-hash')",
        [user],
      );
      for (const kind of kinds)
        await withTransaction(legacy, async (client) => {
          const id = randomUUID();
          await client.query(
            "INSERT INTO resources(id,organization_id,team_id,kind,name,revision) VALUES($1,$2,$3,$4,$5,2)",
            [id, organization, team, kind, `Legacy ${kind}`],
          );
          for (const revision of [1, 2])
            await client.query(
              "INSERT INTO resource_versions(id,resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,$2,$3,1,$4::jsonb,$5)",
              [
                randomUUID(),
                id,
                revision,
                JSON.stringify({
                  name: `Legacy ${kind}`,
                  revision,
                  preserved: "  exact payload 🚀  ",
                }),
                user,
              ],
            );
        });
      const beforeRecords = (
        await legacy.query("SELECT * FROM resources ORDER BY id")
      ).rows;
      const beforeSnapshots = (
        await legacy.query("SELECT * FROM resource_versions ORDER BY id")
      ).rows;
      await migrate(legacy);
      expect(
        (await legacy.query("SELECT * FROM resources ORDER BY id")).rows,
      ).toEqual(
        beforeRecords.map((value) => ({
          ...value,
          archived_at: null,
          lifecycle_revision: 1,
        })),
      );
      expect(
        (await legacy.query("SELECT * FROM resource_versions ORDER BY id"))
          .rows,
      ).toEqual(beforeSnapshots);
      expect(
        (
          await legacy.query(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
        ).rows.at(-1)?.version,
      ).toBe("005_catalog_archive");
      await migrate(legacy);
      expect(
        (
          await legacy.query(
            "SELECT count(*)::int AS count FROM schema_migrations",
          )
        ).rows[0].count,
      ).toBe(5);
      await expect(
        legacy.query("UPDATE resources SET lifecycle_revision=0 WHERE id=$1", [
          beforeRecords[0].id,
        ]),
      ).rejects.toMatchObject({ code: "23514" });
    } finally {
      await legacy.end();
      await db.admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    }
  });
});
