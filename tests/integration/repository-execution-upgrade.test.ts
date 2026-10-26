import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  AgentDefinitionSchema,
  FlowDefinitionSchema,
  SessionSnapshotSchema,
  StartSessionRequestSchema,
  WorkspaceDefinitionSchema,
  compileRepositoryCommandPlan,
  serializeRepositoryCommandPlan,
  stubStageOutputs,
} from "@ark/contracts";
import { createPool, migrate, withTransaction } from "@ark/db";
import { expect, it } from "vitest";
import { IdentityService } from "../../apps/api/src/identity.js";
import { SessionService } from "../../apps/api/src/sessions.js";
import { databaseFixture } from "../helpers/database.js";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

it("upgrades populated 009 stub ownership to 010 without changing legacy data or global runner capacity", async () => {
  const db = await databaseFixture();
  const schema = `ark_test_${randomBytes(10).toString("hex")}`;
  if (!/^ark_test_[a-f0-9]{20}$/.test(schema))
    throw new Error("Unsafe repository upgrade fixture target.");
  try {
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
        "005_catalog_archive",
        "006_runner_enrollment",
        "007_runner_compute_controls",
        "008_durable_sessions",
        "009_repository_plans",
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
            [version, sha(sql.replaceAll("\r\n", "\n"))],
          );
        });
      }

      const organizationId = randomUUID();
      const teamId = randomUUID();
      const userId = randomUUID();
      const runnerId = randomUUID();
      const sessionId = randomUUID();
      const leaseId = randomUUID();
      const leaseToken = randomBytes(32).toString("hex");
      const credential = `ark_runner_${runnerId}_${randomBytes(32).toString("hex")}`;
      const workspace = { resourceId: randomUUID(), versionId: randomUUID() };
      const agent = { resourceId: randomUUID(), versionId: randomUUID() };
      const flow = { resourceId: randomUUID(), versionId: randomUUID() };
      const stageId = randomUUID();
      const workspaceDefinition = WorkspaceDefinitionSchema.parse({
        name: "Legacy upgrade workspace",
        description: "Preserve the exact saved configuration 🚀.",
        repositoryUrl: "https://github.com/example/legacy.git",
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
      });
      const agentDefinition = AgentDefinitionSchema.parse({
        name: "Legacy upgrade stub",
        description: "Pure fixture",
        instructions: "Return deterministic typed outputs.",
        runtime: "stub",
        modelPreference: null,
        capabilities: [],
      });
      const flowDefinition = FlowDefinitionSchema.parse({
        name: "Legacy upgrade Flow",
        description: "Preserve the original pins and values.",
        workspace,
        inputs: [{ name: "task", type: "text" }],
        stages: [
          {
            id: stageId,
            name: "Evaluate",
            agent,
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
      });
      const snapshot = SessionSnapshotSchema.parse({
        flow: { ...flow, definition: flowDefinition },
        workspace: { ...workspace, definition: workspaceDefinition },
        agents: [{ ...agent, definition: agentDefinition }],
      });
      const request = StartSessionRequestSchema.parse({
        id: sessionId,
        flow,
        runnerId,
        inputValues: {
          task: { type: "text", value: "  preserve exact legacy input 🚀  " },
        },
      });
      await withTransaction(legacy, async (client) => {
        await client.query(
          "INSERT INTO organizations(id,name) VALUES($1,'Legacy execution upgrade')",
          [organizationId],
        );
        await client.query(
          "INSERT INTO users(id,email,display_name,password_hash) VALUES($1,'upgrade@example.test','Legacy owner','unused-test-hash')",
          [userId],
        );
        await client.query(
          "INSERT INTO organization_memberships(organization_id,user_id,role) VALUES($1,$2,'owner')",
          [organizationId, userId],
        );
        await client.query(
          "INSERT INTO teams(id,organization_id,name) VALUES($1,$2,'Legacy team')",
          [teamId, organizationId],
        );
        await client.query(
          "INSERT INTO team_memberships(team_id,user_id,organization_id,role) VALUES($1,$2,$3,'admin')",
          [teamId, userId, organizationId],
        );
        for (const saved of [
          {
            kind: "workspace",
            reference: workspace,
            definition: workspaceDefinition,
          },
          { kind: "agent", reference: agent, definition: agentDefinition },
          { kind: "flow", reference: flow, definition: flowDefinition },
        ]) {
          await client.query(
            "INSERT INTO resources(id,organization_id,team_id,kind,name,revision) VALUES($1,$2,$3,$4,$5,1)",
            [
              saved.reference.resourceId,
              organizationId,
              teamId,
              saved.kind,
              saved.definition.name,
            ],
          );
          await client.query(
            "INSERT INTO resource_versions(id,resource_id,revision,schema_version,definition,created_by_user_id) VALUES($1,$2,1,1,$3::jsonb,$4)",
            [
              saved.reference.versionId,
              saved.reference.resourceId,
              JSON.stringify(saved.definition),
              userId,
            ],
          );
        }
        await client.query(
          `INSERT INTO runners(id,organization_id,team_id,name,issued_by,enrollment_token_hash,enrollment_expires_at,credential_hash,enrolled_at,dispatch_approved)
           VALUES($1,$2,$3,'Legacy enrolled runner',$4,$5,clock_timestamp()+interval '10 minutes',$6,clock_timestamp(),true)`,
          [
            runnerId,
            organizationId,
            teamId,
            userId,
            sha(randomBytes(32).toString("hex")),
            sha(credential),
          ],
        );
        await client.query(
          "INSERT INTO runner_use_grants(runner_id,team_id,organization_id,user_id,granted) VALUES($1,$2,$3,$4,true)",
          [runnerId, teamId, organizationId, userId],
        );
        await client.query(
          `INSERT INTO execution_sessions(id,organization_id,team_id,started_by,runner_id,flow_resource_id,flow_version_id,workspace_id,flow_name,request,snapshot,input_values,state,revision)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,'running',2)`,
          [
            sessionId,
            organizationId,
            teamId,
            userId,
            runnerId,
            flow.resourceId,
            flow.versionId,
            workspace.resourceId,
            flowDefinition.name,
            JSON.stringify(request),
            JSON.stringify(snapshot),
            JSON.stringify(request.inputValues),
          ],
        );
        await client.query(
          `INSERT INTO session_leases(id,session_id,runner_id,team_id,organization_id,workspace_id,token_hash,expires_at,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '5 minutes','active')`,
          [
            leaseId,
            sessionId,
            runnerId,
            teamId,
            organizationId,
            workspace.resourceId,
            sha(leaseToken),
          ],
        );
        for (const item of [
          { sequence: 1, kind: "created", state: "queued" },
          { sequence: 2, kind: "claimed", state: "running" },
        ])
          await client.query(
            "INSERT INTO execution_events(session_id,sequence,id,lease_id,kind,state,stage_index) VALUES($1,$2,$3,$4,$5,$6,0)",
            [
              sessionId,
              item.sequence,
              randomUUID(),
              item.sequence === 2 ? leaseId : null,
              item.kind,
              item.state,
            ],
          );
      });
      const beforeSession = (
        await legacy.query("SELECT * FROM execution_sessions WHERE id=$1", [
          sessionId,
        ])
      ).rows[0];
      const beforeLease = (
        await legacy.query("SELECT * FROM session_leases WHERE id=$1", [
          leaseId,
        ])
      ).rows[0];
      const beforeVersions = (
        await legacy.query("SELECT * FROM resource_versions ORDER BY id")
      ).rows;
      const beforeEvents = (
        await legacy.query("SELECT * FROM execution_events ORDER BY sequence")
      ).rows;
      const beforeIndex = (
        await legacy.query(
          "SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='session_leases_exclusive_runner'",
          [schema],
        )
      ).rows;
      expect(beforeIndex).toHaveLength(1);
      expect(
        (
          await legacy.query(
            "SELECT count(*)::int AS count FROM schema_migrations",
          )
        ).rows[0].count,
      ).toBe(9);

      await migrate(legacy);

      expect(
        (
          await legacy.query("SELECT * FROM execution_sessions WHERE id=$1", [
            sessionId,
          ])
        ).rows[0],
      ).toEqual(beforeSession);
      expect(
        (
          await legacy.query("SELECT * FROM session_leases WHERE id=$1", [
            leaseId,
          ])
        ).rows[0],
      ).toEqual({
        ...beforeLease,
        runtime: "stub.v1",
        repository_execution_id: null,
        control_sequence: 0,
      });
      expect(
        (await legacy.query("SELECT * FROM resource_versions ORDER BY id"))
          .rows,
      ).toEqual(beforeVersions);
      expect(
        (await legacy.query("SELECT * FROM execution_events ORDER BY sequence"))
          .rows,
      ).toEqual(beforeEvents);
      expect(
        (
          await legacy.query(
            "SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='session_leases_exclusive_runner'",
            [schema],
          )
        ).rows,
      ).toEqual(beforeIndex);
      expect(
        (
          await legacy.query(
            "SELECT version FROM schema_migrations ORDER BY version",
          )
        ).rows.at(-1)?.version,
      ).toBe("010_repository_execution_control");

      const service = new SessionService(
        legacy,
        new IdentityService(legacy, 43_200),
      );
      const repeated = await service.claim(`Bearer ${credential}`, {
        claimId: leaseId,
        leaseToken,
        runtime: "stub.v1",
      });
      expect(repeated.job).toMatchObject({
        session: {
          id: sessionId,
          state: "running",
          revision: 2,
          snapshot,
          inputValues: request.inputValues,
        },
        lease: {
          id: leaseId,
          generation: 1,
          status: "active",
          expiresAt: beforeLease.expires_at.toISOString(),
        },
      });
      expect(
        (await legacy.query("SELECT * FROM execution_events ORDER BY sequence"))
          .rows,
      ).toEqual(beforeEvents);

      const selection = {
        action: "test" as const,
        commitOid: "b".repeat(40),
        imageDigest: `node@sha256:${"a".repeat(64)}`,
      };
      const plan = compileRepositoryCommandPlan(
        { ...workspace, definition: workspaceDefinition },
        selection,
      );
      const planDigest = sha(serializeRepositoryCommandPlan(plan));
      const planId = randomUUID();
      const repositoryId = randomUUID();
      const repositoryLeaseId = randomUUID();
      await legacy.query(
        `INSERT INTO repository_plans(id,organization_id,team_id,created_by,workspace_resource_id,workspace_version_id,workspace_name,request,plan,plan_digest)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10)`,
        [
          planId,
          organizationId,
          teamId,
          userId,
          workspace.resourceId,
          workspace.versionId,
          workspaceDefinition.name,
          JSON.stringify({ id: planId, workspace, selection }),
          serializeRepositoryCommandPlan(plan),
          planDigest,
        ],
      );
      await legacy.query(
        `WITH timer AS (SELECT clock_timestamp() AS now)
         INSERT INTO repository_executions(id,organization_id,team_id,started_by,runner_id,repository_plan_id,plan_digest,workspace_id,workspace_version_id,workspace_name,request,state,claimed_at,run_deadline_at,preparation_deadline_at)
         SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'running',timer.now,timer.now+interval '900 seconds',timer.now+interval '120 seconds' FROM timer`,
        [
          repositoryId,
          organizationId,
          teamId,
          userId,
          runnerId,
          planId,
          planDigest,
          workspace.resourceId,
          workspace.versionId,
          workspaceDefinition.name,
          JSON.stringify({
            id: repositoryId,
            repositoryPlanId: planId,
            expectedPlanDigest: planDigest,
            runnerId,
          }),
        ],
      );
      const insertRepositoryLease = () =>
        legacy.query(
          `INSERT INTO session_leases(id,runtime,repository_execution_id,runner_id,team_id,organization_id,workspace_id,token_hash,expires_at,status)
         VALUES($1,'repository.v1',$2,$3,$4,$5,$6,$7,clock_timestamp()+interval '45 seconds','active') RETURNING *`,
          [
            repositoryLeaseId,
            repositoryId,
            runnerId,
            teamId,
            organizationId,
            workspace.resourceId,
            sha(randomBytes(32).toString("hex")),
          ],
        );
      await expect(insertRepositoryLease()).rejects.toMatchObject({
        code: "23505",
        constraint: "session_leases_exclusive_runner",
      });
      expect(
        (
          await legacy.query(
            "SELECT count(*)::int AS count FROM session_leases WHERE runner_id=$1",
            [runnerId],
          )
        ).rows[0].count,
      ).toBe(1);

      const progressed = await service.advance(`Bearer ${credential}`, {
        kind: "stage_completed",
        eventId: randomUUID(),
        leaseId,
        leaseToken,
        generation: 1,
        expectedRevision: repeated.job!.session.revision,
        stageId,
        outputs: stubStageOutputs(repeated.job!.session),
      });
      expect(progressed.session).toMatchObject({
        state: "running",
        stageIndex: 1,
        revision: 3,
        snapshot,
      });
      const completed = await service.advance(`Bearer ${credential}`, {
        kind: "completed",
        eventId: randomUUID(),
        leaseId,
        leaseToken,
        generation: 1,
        expectedRevision: progressed.session.revision,
        confirmedStopped: true,
      });
      expect(completed.session.state).toBe("completed");
      expect(completed.lease.status).toBe("released");
      expect((await insertRepositoryLease()).rows[0]).toMatchObject({
        id: repositoryLeaseId,
        runtime: "repository.v1",
        session_id: null,
        repository_execution_id: repositoryId,
        status: "active",
        control_sequence: 0,
      });
      expect(
        (
          await legacy.query(
            "SELECT count(*)::int AS count FROM session_leases WHERE runner_id=$1 AND status IN ('active','uncertain')",
            [runnerId],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await legacy.end();
      await db.admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      expect(
        (
          await db.admin.query("SELECT 1 FROM pg_namespace WHERE nspname=$1", [
            schema,
          ])
        ).rowCount,
      ).toBe(0);
    }
  } finally {
    await db.close();
  }
});
