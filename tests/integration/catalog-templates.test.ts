import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AgentResponseSchema,
  CatalogTemplateListResponseSchema,
  FlowDefinitionSchema,
  FlowResponseSchema,
  WorkspaceResponseSchema,
  type CatalogTemplateKind,
  type FlowDefinition,
  type FlowTemplate,
  type MeResponse,
  type ResourceVersionReference,
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
  ownerName: "Template Owner",
  email: "owner@example.test",
  password: "test-only-long-password",
  organizationName: "Template Tests",
  teamName: "Alpha",
};
const kinds: CatalogTemplateKind[] = ["workspace", "agent", "flow"];
type CatalogRecord = ReturnType<
  typeof WorkspaceResponseSchema.parse
>["workspace"];
let db: Awaited<ReturnType<typeof databaseFixture>>;
let app: Awaited<ReturnType<typeof buildApp>>;
const templatePath = (teamId: string, kind: string) =>
  `/api/teams/${teamId}/templates/${kind}`;
const collection = (teamId: string, kind: CatalogTemplateKind) =>
  `/api/teams/${teamId}/${kind}s`;
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
function record(kind: CatalogTemplateKind, response: unknown): CatalogRecord {
  if (kind === "workspace")
    return WorkspaceResponseSchema.parse(response).workspace;
  if (kind === "agent") return AgentResponseSchema.parse(response).agent;
  return FlowResponseSchema.parse(response).flow;
}
const pin = (resource: CatalogRecord): ResourceVersionReference => ({
  resourceId: resource.id,
  versionId: resource.versionId,
});
const create = (
  teamId: string,
  kind: CatalogTemplateKind,
  definition: unknown,
  cookie: string,
  id: string = randomUUID(),
) =>
  mutate(
    "POST",
    collection(teamId, kind),
    { id, schemaVersion: 1, definition },
    cookie,
  );
async function save(
  teamId: string,
  kind: CatalogTemplateKind,
  definition: unknown,
  cookie: string,
) {
  const response = await create(teamId, kind, definition, cookie);
  expect(response.statusCode).toBe(201);
  return record(kind, response.json());
}
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
async function readTemplates(
  teamId: string,
  kind: CatalogTemplateKind,
  cookie: string,
) {
  const response = await get(templatePath(teamId, kind), cookie);
  expect(response.statusCode).toBe(200);
  return CatalogTemplateListResponseSchema.parse(response.json());
}
async function examples(teamId: string, cookie: string) {
  const workspace = (
    await readTemplates(teamId, "workspace", cookie)
  ).templates.find((template) => template.kind === "workspace");
  const agent = (await readTemplates(teamId, "agent", cookie)).templates.find(
    (template) => template.kind === "agent",
  );
  const flow = (await readTemplates(teamId, "flow", cookie)).templates.find(
    (template) => template.kind === "flow",
  );
  if (!workspace || !agent || !flow)
    throw new Error("Expected built-in examples for all catalog kinds.");
  return { workspace, agent, flow };
}
function completeFlow(
  template: FlowTemplate,
  workspace: CatalogRecord,
  agent: CatalogRecord,
): FlowDefinition {
  const copy = structuredClone(template.definition);
  const ids = new Map(copy.stages.map((stage) => [stage.id, randomUUID()]));
  return FlowDefinitionSchema.parse({
    ...copy,
    workspace: pin(workspace),
    stages: copy.stages.map((stage) => ({
      ...stage,
      id: ids.get(stage.id),
      agent: pin(agent),
      inputs: stage.inputs.map((input) => ({
        ...input,
        source:
          input.source.kind === "flow_input"
            ? input.source
            : { ...input.source, stageId: ids.get(input.source.stageId) },
      })),
    })),
    outputs: copy.outputs.map((output) => ({
      ...output,
      source: { ...output.source, stageId: ids.get(output.source.stageId) },
    })),
  });
}
async function dependencies(teamId: string, cookie: string) {
  const templates = await examples(teamId, cookie);
  const workspaceDefinition = {
    ...templates.workspace.definition,
    repositoryUrl: "https://github.com/example/project.git",
  };
  const workspace = await save(
    teamId,
    "workspace",
    workspaceDefinition,
    cookie,
  );
  const agent = await save(teamId, "agent", templates.agent.definition, cookie);
  return {
    templates,
    workspace,
    agent,
    workspaceDefinition,
    definition: completeFlow(templates.flow, workspace, agent),
  };
}
async function counts() {
  return (
    await db.pool.query<{
      resources: number;
      versions: number;
      audits: number;
    }>(
      "SELECT (SELECT count(*)::integer FROM resources) AS resources, (SELECT count(*)::integer FROM resource_versions) AS versions, (SELECT count(*)::integer FROM audit_events) AS audits",
    )
  ).rows[0]!;
}
async function member(
  organizationId: string,
  teamId: string,
  role: "developer" | "reviewer" | "viewer",
) {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await db.pool.query(
    "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,$2,'Template Member',$3)",
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
  const response = await mutate("POST", "/api/auth/login", {
    email,
    password: setup.password,
  });
  expect(response.statusCode).toBe(200);
  return { id, cookie: String(response.headers["set-cookie"]).split(";")[0]! };
}
async function otherTeam(
  fixture: Awaited<ReturnType<typeof bootstrap>>,
  accessible: boolean,
) {
  const id = randomUUID();
  await db.pool.query(
    "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,$3)",
    [id, fixture.me.organization.id, `Team ${id}`],
  );
  if (accessible)
    await db.pool.query(
      "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
      [id, fixture.me.user.id, fixture.me.organization.id],
    );
  return id;
}
function denied(
  response: Awaited<ReturnType<typeof get>>,
  status: number,
  code?: string,
) {
  expect(response.statusCode).toBe(status);
  if (code) expect(response.json().error.code).toBe(code);
}

beforeEach(async () => {
  db = await databaseFixture();
  app = await buildApp({ pool: db.pool });
});
afterEach(async () => {
  if (app) await app.close();
  if (db) await db.close();
});

describe("built-in catalog templates with real PostgreSQL", () => {
  it("lists only the requested kind and never creates catalog records, versions, or audits", async () => {
    const f = await bootstrap();
    const before = await counts();
    const ids = {
      workspace: ["node-pnpm"],
      agent: ["implementation", "review"],
      flow: ["implementation-review"],
    };
    for (const kind of kinds) {
      const response = await readTemplates(f.teamId, kind, f.cookie);
      expect(response.templates.map((template) => template.id)).toEqual(
        ids[kind],
      );
      for (const template of response.templates) {
        expect(template.kind).toBe(kind);
        expect(template).toMatchObject({
          schemaVersion: 1,
          templateVersion: 1,
        });
        expect(template).not.toHaveProperty("teamId");
        expect(template).not.toHaveProperty("resourceId");
        if (template.kind === "workspace")
          expect(template.definition).not.toHaveProperty("repositoryUrl");
        if (template.kind === "flow") {
          expect(template.definition).not.toHaveProperty("workspace");
          expect(template.definition.stages).toHaveLength(2);
          for (const stage of template.definition.stages)
            expect(stage).not.toHaveProperty("agent");
        }
      }
      expect(await readTemplates(f.teamId, kind, f.cookie)).toEqual(response);
    }
    expect(await counts()).toEqual(before);
  });

  it("requires a session and current explicit team membership even for an organization owner", async () => {
    const f = await bootstrap();
    const inaccessible = await otherTeam(f, false);
    const foreignTeam = randomUUID();
    const foreignOrganization = randomUUID();
    // Production permits one organization. Relax only this disposable test
    // schema to verify the defensive cross-organization read boundary too.
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
    for (const kind of kinds) {
      denied(await get(templatePath(f.teamId, kind)), 401);
      denied(
        await get(templatePath(inaccessible, kind), f.cookie),
        404,
        "NOT_FOUND",
      );
      denied(
        await get(templatePath(foreignTeam, kind), f.cookie),
        404,
        "NOT_FOUND",
      );
      denied(
        await get(templatePath(randomUUID(), kind), f.cookie),
        404,
        "NOT_FOUND",
      );
    }
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1 AND team_id=$2",
      [f.me.user.id, f.teamId],
    );
    for (const kind of kinds)
      denied(
        await get(templatePath(f.teamId, kind), f.cookie),
        404,
        "NOT_FOUND",
      );
  });

  it.each(["developer", "reviewer", "viewer"] as const)(
    "lets %s members read examples while ordinary write grants remain authoritative",
    async (role) => {
      const f = await bootstrap();
      const reader = await member(f.me.organization.id, f.teamId, role);
      for (const kind of kinds)
        await readTemplates(f.teamId, kind, reader.cookie);
      const templates = await examples(f.teamId, reader.cookie);
      const response = await create(
        f.teamId,
        "agent",
        templates.agent.definition,
        reader.cookie,
      );
      if (role === "developer") expect(response.statusCode).toBe(201);
      else denied(response, 403, "FORBIDDEN");
      await db.pool.query(
        "UPDATE organization_memberships SET revoked_at=now() WHERE user_id=$1",
        [reader.id],
      );
      for (const kind of kinds)
        denied(
          await get(templatePath(f.teamId, kind), reader.cookie),
          401,
          "UNAUTHENTICATED",
        );
    },
  );

  it.each(["malformed", "revoked", "expired", "disabled"] as const)(
    "rejects %s sessions on every template kind without catalog writes",
    async (state) => {
      const f = await bootstrap();
      const reader = await member(f.me.organization.id, f.teamId, "viewer");
      for (const kind of kinds)
        await readTemplates(f.teamId, kind, reader.cookie);
      let cookie = reader.cookie;
      if (state === "malformed") cookie = "ark_session=invalid";
      else if (state === "revoked")
        await db.pool.query(
          "UPDATE auth_sessions SET revoked_at=now() WHERE user_id=$1",
          [reader.id],
        );
      else if (state === "expired")
        await db.pool.query(
          "UPDATE auth_sessions SET expires_at=now() - interval '1 second' WHERE user_id=$1",
          [reader.id],
        );
      else
        await db.pool.query(
          "UPDATE users SET disabled_at=now() WHERE id=$1",
          [reader.id],
        );
      const before = await counts();
      for (const kind of kinds)
        denied(
          await get(templatePath(f.teamId, kind), cookie),
          401,
          "UNAUTHENTICATED",
        );
      expect(await counts()).toEqual(before);
    },
  );

  it("rejects invalid route/query shapes and exposes no template mutation route", async () => {
    const f = await bootstrap();
    const before = await counts();
    for (const url of [
      templatePath("invalid", "workspace"),
      templatePath(f.teamId, "workspaces"),
      templatePath(f.teamId, "session"),
      `${templatePath(f.teamId, "agent")}?cursor=${randomUUID()}`,
      `${templatePath(f.teamId, "flow")}?status=active`,
      `${templatePath(f.teamId, "workspace")}?kind=agent`,
    ])
      denied(await get(url, f.cookie), 400);
    for (const kind of kinds)
      denied(
        await mutate("POST", templatePath(f.teamId, kind), {}, f.cookie),
        404,
      );
    expect(await counts()).toEqual(before);
  });

  it("saves completed copies with independent immutable revisions and leaves shipped definitions unchanged", async () => {
    const f = await bootstrap();
    const before = await counts();
    const d = await dependencies(f.teamId, f.cookie);
    const flow = await save(f.teamId, "flow", d.definition, f.cookie);
    const records = { workspace: d.workspace, agent: d.agent, flow };
    const definitions = {
      workspace: d.workspaceDefinition,
      agent: d.templates.agent.definition,
      flow: d.definition,
    };
    expect(await counts()).toEqual({
      resources: before.resources + 3,
      versions: before.versions + 3,
      audits: before.audits + 3,
    });
    for (const kind of kinds) {
      const original = records[kind];
      expect(original).toMatchObject({
        teamId: f.teamId,
        definition: definitions[kind],
        revision: 1,
        lifecycleRevision: 1,
        archivedAt: null,
      });
      const saved = await get(
        `${collection(f.teamId, kind)}/${original.id}`,
        f.cookie,
      );
      expect(record(kind, saved.json())).toEqual(original);
      const editedDefinition = {
        ...definitions[kind],
        description: "Edited independent saved copy.\nPreserve whitespace.  ",
      };
      const edited = await mutate(
        "PUT",
        `${collection(f.teamId, kind)}/${original.id}`,
        {
          revision: 1,
          lifecycleRevision: 1,
          schemaVersion: 1,
          definition: editedDefinition,
        },
        f.cookie,
      );
      expect(edited.statusCode).toBe(200);
      expect(record(kind, edited.json())).toMatchObject({
        id: original.id,
        revision: 2,
        definition: editedDefinition,
      });
      const versions = await db.pool.query(
        "SELECT revision,definition FROM resource_versions WHERE resource_id=$1 ORDER BY revision",
        [original.id],
      );
      expect(versions.rows).toEqual([
        { revision: 1, definition: definitions[kind] },
        { revision: 2, definition: editedDefinition },
      ]);
      const events = await db.pool.query(
        "SELECT action,metadata FROM audit_events WHERE target_id=$1 ORDER BY action",
        [original.id],
      );
      expect(events.rows).toEqual([
        { action: `${kind}.created`, metadata: { revision: 1 } },
        { action: `${kind}.updated`, metadata: { revision: 2 } },
      ]);
    }
    expect(await examples(f.teamId, f.cookie)).toEqual(d.templates);
    expect(await counts()).toEqual({
      resources: before.resources + 3,
      versions: before.versions + 6,
      audits: before.audits + 6,
    });
  });

  it.each(kinds)(
    "preserves ordinary %s creation replay, conflicting-ID and reserved-name rules",
    async (kind) => {
      const f = await bootstrap();
      const d = await dependencies(f.teamId, f.cookie);
      const source =
        kind === "workspace"
          ? d.workspaceDefinition
          : kind === "agent"
            ? d.templates.agent.definition
            : d.definition;
      const definition = { ...source, name: "Independent copy" };
      const id = randomUUID();
      const before = await counts();
      const first = await create(f.teamId, kind, definition, f.cookie, id);
      expect(first.statusCode).toBe(201);
      const retry = await create(f.teamId, kind, definition, f.cookie, id);
      expect(retry.statusCode).toBe(200);
      expect(retry.json()).toEqual(first.json());
      denied(
        await create(
          f.teamId,
          kind,
          { ...definition, description: "Different draft" },
          f.cookie,
          id,
        ),
        409,
        "ID_CONFLICT",
      );
      denied(
        await create(
          f.teamId,
          kind,
          { ...definition, name: "INDEPENDENT COPY" },
          f.cookie,
        ),
        409,
        "NAME_CONFLICT",
      );
      expect(await counts()).toEqual({
        resources: before.resources + 1,
        versions: before.versions + 1,
        audits: before.audits + 1,
      });
    },
  );

  it("requires explicit repository and Flow dependency completion before saving", async () => {
    const f = await bootstrap();
    const templates = await examples(f.teamId, f.cookie);
    const before = await counts();
    denied(
      await create(
        f.teamId,
        "workspace",
        templates.workspace.definition,
        f.cookie,
      ),
      400,
    );
    denied(
      await create(f.teamId, "flow", templates.flow.definition, f.cookie),
      400,
    );
    denied(
      await create(
        f.teamId,
        "flow",
        {
          ...templates.flow.definition,
          workspace: { resourceId: randomUUID(), versionId: randomUUID() },
        },
        f.cookie,
      ),
      400,
    );
    expect(await counts()).toEqual(before);
  });

  it("revalidates same-team kind/version pairs and active dependencies when a completed Flow copy is submitted", async () => {
    const f = await bootstrap();
    const d = await dependencies(f.teamId, f.cookie);
    const foreignTeam = await otherTeam(f, true);
    const foreign = await dependencies(foreignTeam, f.cookie);
    const invalid: FlowDefinition[] = [
      { ...d.definition, workspace: pin(foreign.workspace) },
      { ...d.definition, workspace: pin(d.agent) },
      {
        ...d.definition,
        workspace: { resourceId: d.workspace.id, versionId: d.agent.versionId },
      },
      {
        ...d.definition,
        workspace: { resourceId: d.workspace.id, versionId: randomUUID() },
      },
      {
        ...d.definition,
        stages: d.definition.stages.map((stage) => ({
          ...stage,
          agent: pin(foreign.agent),
        })),
      },
      {
        ...d.definition,
        stages: d.definition.stages.map((stage) => ({
          ...stage,
          agent: { resourceId: d.agent.id, versionId: d.workspace.versionId },
        })),
      },
    ];
    const before = await counts();
    for (const definition of invalid)
      denied(
        await create(f.teamId, "flow", definition, f.cookie),
        400,
        "INVALID_DEPENDENCY",
      );
    expect(await counts()).toEqual(before);
    for (const [kind, dependency] of [
      ["workspace", d.workspace],
      ["agent", d.agent],
    ] as const) {
      const path = `${collection(f.teamId, kind)}/${dependency.id}`;
      const archived = await mutate(
        "POST",
        `${path}/archive`,
        { revision: 1, lifecycleRevision: 1 },
        f.cookie,
      );
      expect(archived.statusCode).toBe(200);
      const archiveCounts = await counts();
      denied(
        await create(f.teamId, "flow", d.definition, f.cookie),
        400,
        "INVALID_DEPENDENCY",
      );
      expect(await counts()).toEqual(archiveCounts);
      expect(
        (
          await mutate(
            "POST",
            `${path}/unarchive`,
            { revision: 1, lifecycleRevision: 2 },
            f.cookie,
          )
        ).statusCode,
      ).toBe(200);
    }
    const saved = await create(f.teamId, "flow", d.definition, f.cookie);
    expect(saved.statusCode).toBe(201);
    expect(FlowResponseSchema.parse(saved.json()).flow.definition).toEqual(
      d.definition,
    );
  });

  it("rejects a completed copy after the member who loaded its template loses team access", async () => {
    const f = await bootstrap();
    const d = await dependencies(f.teamId, f.cookie);
    const developer = await member(f.me.organization.id, f.teamId, "developer");
    const templates = await examples(f.teamId, developer.cookie);
    const definition = completeFlow(templates.flow, d.workspace, d.agent);
    await db.pool.query(
      "UPDATE team_memberships SET revoked_at=now() WHERE user_id=$1",
      [developer.id],
    );
    const before = await counts();
    denied(
      await create(f.teamId, "flow", definition, developer.cookie),
      404,
      "NOT_FOUND",
    );
    denied(
      await create(
        f.teamId,
        "agent",
        templates.agent.definition,
        developer.cookie,
      ),
      404,
      "NOT_FOUND",
    );
    expect(await counts()).toEqual(before);
  });
});
