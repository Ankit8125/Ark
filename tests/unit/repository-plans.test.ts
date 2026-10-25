import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  RepositoryCommandPlanSchema,
  RepositoryPlanListQuerySchema,
  RepositoryPlanListResponseSchema,
  RepositoryPlanParamsSchema,
  RepositoryPlanPreviewRequestSchema,
  RepositoryPlanPreviewResponseSchema,
  RepositoryPlanResponseSchema,
  RepositoryPlanSummarySchema,
  RepositoryPlanTeamParamsSchema,
  SaveRepositoryPlanRequestSchema,
  SavedRepositoryPlanSchema,
  compileRepositoryCommandPlan,
  serializeRepositoryCommandPlan,
  type RepositoryPlanSummary,
  type SavedRepositoryPlan,
} from "@ark/contracts";

const id = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const versionId = "ab286801-a441-4c81-b111-589de8611ff2";
const teamId = "3c286801-a441-4c81-b111-589de8611ff2";
const createdBy = "7c286801-a441-4c81-b111-589de8611ff2";
const planDigest = "a".repeat(64);
const request = {
  workspace: { resourceId: id, versionId },
  selection: {
    action: "test" as const,
    commitOid: "abcdef0123456789abcdef0123456789abcdef01",
    imageDigest: `node@sha256:${"b".repeat(64)}`,
  },
};
function plan() {
  return compileRepositoryCommandPlan(
    {
      ...request.workspace,
      definition: {
        name: "Web application",
        description: "Planning only.",
        repositoryUrl: "https://github.com/example/project.git",
        sourceRef: "main",
        defaultBranch: "main",
        sandboxImage: "node:24",
        workingDirectory: "apps/web",
        actions: {
          install: "",
          test: '  printf "%s" "🚀"\npnpm test\n',
          lint: "",
          build: "",
        },
      },
    },
    request.selection,
  );
}
function saved(): SavedRepositoryPlan {
  return {
    id,
    organizationId: id,
    teamId,
    createdBy,
    createdAt: "2026-10-25T10:00:00.000Z",
    workspaceName: "Web application",
    planDigest,
    plan: plan(),
  };
}
function summary(): RepositoryPlanSummary {
  const { plan: value, ...metadata } = saved();
  return {
    ...metadata,
    workspace: value.workspace,
    action: value.action.kind,
    status: value.status,
  };
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, item]) => [key, reverseKeys(item)]),
    );
  return value;
}

describe("saved repository plan contracts", () => {
  it("anchors the v1 digest to the persisted fixture byte format", () => {
    const digest = createHash("sha256")
      .update(serializeRepositoryCommandPlan(plan()), "utf8")
      .digest("hex");
    expect(digest).toBe(
      "b5396e4d35af41a94f31fca11575fa860ae705a8f6cfd77da801f0feec9be6a2",
    );
  });
  it("accepts only a Workspace pin and explicit selection for preview, with normalized identities", () => {
    expect(
      RepositoryPlanPreviewRequestSchema.parse({
        workspace: {
          resourceId: id.toUpperCase(),
          versionId: versionId.toUpperCase(),
        },
        selection: {
          ...request.selection,
          commitOid: request.selection.commitOid.toUpperCase(),
        },
      }),
    ).toEqual(request);
    for (const extra of [
      { id },
      { runnerId: id },
      { plan: plan() },
      { approved: true },
      { limits: plan().limits },
    ])
      expect(
        RepositoryPlanPreviewRequestSchema.safeParse({ ...request, ...extra })
          .success,
      ).toBe(false);
    expect(
      RepositoryPlanPreviewRequestSchema.safeParse({
        ...request,
        workspace: { ...request.workspace, definition: {} },
      }).success,
    ).toBe(false);
    expect(
      RepositoryPlanPreviewRequestSchema.safeParse({
        ...request,
        selection: { ...request.selection, command: "replacement" },
      }).success,
    ).toBe(false);
  });

  it("requires a caller-owned save UUID without accepting execution or mutation controls", () => {
    expect(
      SaveRepositoryPlanRequestSchema.parse({
        ...request,
        id: id.toUpperCase(),
      }),
    ).toEqual({ ...request, id });
    expect(SaveRepositoryPlanRequestSchema.safeParse(request).success).toBe(
      false,
    );
    for (const value of ["", "not-a-uuid", `${id}\n`])
      expect(
        SaveRepositoryPlanRequestSchema.safeParse({ ...request, id: value })
          .success,
      ).toBe(false);
    for (const extra of [
      { runnerId: id },
      { expectedRevision: 1 },
      { confirmedStopped: true },
      { planDigest },
    ])
      expect(
        SaveRepositoryPlanRequestSchema.safeParse({
          ...request,
          id,
          ...extra,
        }).success,
      ).toBe(false);
  });

  it("requires strict preview/saved wrappers and 64 lowercase hex digest syntax", () => {
    const preview = { plan: plan(), planDigest };
    expect(RepositoryPlanPreviewResponseSchema.parse(preview)).toEqual(preview);
    expect(
      RepositoryPlanResponseSchema.parse({ repositoryPlan: saved() }),
    ).toEqual({ repositoryPlan: saved() });
    for (const value of [
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      `${planDigest}\n`,
      ` ${planDigest}`,
    ]) {
      expect(
        RepositoryPlanPreviewResponseSchema.safeParse({
          ...preview,
          planDigest: value,
        }).success,
      ).toBe(false);
      expect(
        SavedRepositoryPlanSchema.safeParse({ ...saved(), planDigest: value })
          .success,
      ).toBe(false);
      expect(
        RepositoryPlanSummarySchema.safeParse({
          ...summary(),
          planDigest: value,
        }).success,
      ).toBe(false);
    }
    expect(
      RepositoryPlanPreviewResponseSchema.safeParse({ ...preview, id }).success,
    ).toBe(false);
    expect(
      RepositoryPlanResponseSchema.safeParse({ plan: saved() }).success,
    ).toBe(false);
  });

  it("validates saved provenance, dates and bounded display names without adding quality or runtime authority", () => {
    expect(
      SavedRepositoryPlanSchema.parse({
        ...saved(),
        id: id.toUpperCase(),
        organizationId: id.toUpperCase(),
        teamId: teamId.toUpperCase(),
        createdBy: createdBy.toUpperCase(),
        workspaceName: " Web application ",
      }),
    ).toEqual(saved());
    for (const workspaceName of ["", " ", "x".repeat(81), "bad\u0000name"])
      expect(
        SavedRepositoryPlanSchema.safeParse({ ...saved(), workspaceName })
          .success,
      ).toBe(false);
    for (const extra of [
      { createdAt: "yesterday" },
      { createdBy: "unknown" },
      { quality: "passed" },
      { runnerId: id },
      { leaseId: id },
    ])
      expect(
        SavedRepositoryPlanSchema.safeParse({ ...saved(), ...extra }).success,
      ).toBe(false);
  });

  it("bounds lists to 50 compact summaries and a normalized nullable UUID cursor", () => {
    const value = summary();
    expect(Object.hasOwn(value, "plan")).toBe(false);
    expect(Object.hasOwn(value, "command")).toBe(false);
    expect(RepositoryPlanSummarySchema.parse(value)).toEqual(value);
    expect(
      RepositoryPlanListResponseSchema.parse({
        repositoryPlans: [value],
        nextCursor: id.toUpperCase(),
      }).nextCursor,
    ).toBe(id);
    expect(
      RepositoryPlanListResponseSchema.safeParse({
        repositoryPlans: Array.from({ length: 50 }, () => value),
        nextCursor: null,
      }).success,
    ).toBe(true);
    for (const body of [
      {
        repositoryPlans: Array.from({ length: 51 }, () => value),
        nextCursor: null,
      },
      { repositoryPlans: [saved()], nextCursor: null },
      {
        repositoryPlans: [{ ...value, status: "completed" }],
        nextCursor: null,
      },
      { repositoryPlans: [{ ...value, action: "deploy" }], nextCursor: null },
      { repositoryPlans: [value], nextCursor: "later" },
      { repositoryPlans: [value], nextCursor: null, total: 1 },
    ])
      expect(RepositoryPlanListResponseSchema.safeParse(body).success).toBe(
        false,
      );
  });

  it("scopes strict route parameters and UUID-only pagination without admitting runner fields", () => {
    expect(
      RepositoryPlanTeamParamsSchema.parse({ teamId: teamId.toUpperCase() }),
    ).toEqual({ teamId });
    expect(
      RepositoryPlanParamsSchema.parse({
        teamId: teamId.toUpperCase(),
        planId: id.toUpperCase(),
      }),
    ).toEqual({ teamId, planId: id });
    expect(RepositoryPlanListQuerySchema.parse({})).toEqual({});
    expect(
      RepositoryPlanListQuerySchema.parse({ cursor: id.toUpperCase() }),
    ).toEqual({ cursor: id });
    for (const query of [{ cursor: "2" }, { cursor: null }, { offset: 1 }])
      expect(RepositoryPlanListQuerySchema.safeParse(query).success).toBe(
        false,
      );
    expect(
      RepositoryPlanParamsSchema.safeParse({ teamId, planId: id, runnerId: id })
        .success,
    ).toBe(false);
    expect(RepositoryPlanParamsSchema.safeParse({ teamId }).success).toBe(
      false,
    );
  });

  it("serializes v1 into a fixed field order independently of caller and nested JSONB key order", () => {
    const value = plan();
    const encoded = serializeRepositoryCommandPlan(value);
    expect(serializeRepositoryCommandPlan(reverseKeys(value))).toBe(encoded);
    expect(JSON.parse(encoded)).toEqual(value);
    expect(Object.keys(JSON.parse(encoded))).toEqual([
      "version",
      "runtime",
      "status",
      "workspace",
      "source",
      "image",
      "action",
      "workingDirectory",
      "containerDirectory",
      "sandbox",
      "limits",
    ]);
    expect(Object.keys(JSON.parse(encoded).source)).toEqual([
      "repositoryUrl",
      "requestedRef",
      "commitOid",
    ]);
    expect(Object.keys(JSON.parse(encoded).limits)).toEqual([
      "preparationSeconds",
      "commandSeconds",
      "cleanupSeconds",
      "runSeconds",
      "outputBytesPerChannel",
      "cpuCount",
      "memoryMiB",
      "workspaceMiB",
      "pids",
      "temporaryMiB",
    ]);
    expect(encoded.startsWith('{"version":1,"runtime":"repository.v1"')).toBe(
      true,
    );
    expect(encoded.endsWith("\n")).toBe(false);
  });

  it("normalizes identities in copied serialization but preserves command bytes as plan identity", () => {
    const value = plan();
    const encoded = serializeRepositoryCommandPlan(value);
    const uppercase = structuredClone(value);
    uppercase.workspace.resourceId = id.toUpperCase();
    uppercase.workspace.versionId = versionId.toUpperCase();
    uppercase.source.commitOid = request.selection.commitOid.toUpperCase();
    expect(serializeRepositoryCommandPlan(uppercase)).toBe(encoded);
    expect(uppercase.workspace.resourceId).toBe(id.toUpperCase());
    expect(JSON.parse(encoded).action.command).toBe(
      '  printf "%s" "🚀"\npnpm test\n',
    );
    const changedCommand = structuredClone(value);
    changedCommand.action.command = changedCommand.action.command.trim();
    expect(serializeRepositoryCommandPlan(changedCommand)).not.toBe(encoded);
    const changedSource = structuredClone(value);
    changedSource.source.commitOid = "c".repeat(40);
    expect(serializeRepositoryCommandPlan(changedSource)).not.toBe(encoded);
    expect(RepositoryCommandPlanSchema.parse(JSON.parse(encoded))).toEqual(
      value,
    );
  });

  it("strictly validates a plan before serialization instead of stripping unknown fields or weakened limits", () => {
    const value = plan();
    for (const invalid of [
      { ...value, authorized: true },
      { ...value, version: 2 },
      { ...value, status: "completed" },
      { ...value, limits: { ...value.limits, memoryMiB: 4096 } },
      { ...value, source: { ...value.source, observed: true } },
    ])
      expect(() => serializeRepositoryCommandPlan(invalid)).toThrow();
  });
});
