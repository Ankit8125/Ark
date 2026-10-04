import { describe, expect, it } from "vitest";
import {
  AgentListQuerySchema,
  AgentSummarySchema,
  CatalogStatusSchema,
  FlowListQuerySchema,
  FlowSummarySchema,
  ResourceLifecycleRequestSchema,
  RestoreResourceRequestSchema,
  WorkspaceListQuerySchema,
  WorkspaceSummarySchema,
} from "@ark/contracts";

const id = "ab286801-a441-4c81-b111-589de8611ff2";
const instant = "2026-10-03T00:00:00.000Z";

describe("catalog archive contracts", () => {
  it("requires both exact revision counters and reserves room for lifecycle increments", () => {
    const request = { revision: 1, lifecycleRevision: 1 };
    expect(ResourceLifecycleRequestSchema.parse(request)).toEqual(request);
    expect(
      ResourceLifecycleRequestSchema.parse({
        revision: 2_147_483_647,
        lifecycleRevision: 2_147_483_646,
      }),
    ).toEqual({ revision: 2_147_483_647, lifecycleRevision: 2_147_483_646 });
    for (const field of ["revision", "lifecycleRevision"]) {
      for (const value of [undefined, null, 0, -1, 1.5, "1", 2_147_483_648]) {
        expect(
          ResourceLifecycleRequestSchema.safeParse({
            ...request,
            [field]: value,
          }).success,
        ).toBe(false);
      }
    }
    for (const invalid of [
      { ...request, lifecycleRevision: 2_147_483_647 },
      { ...request, archivedAt: instant },
      { ...request, definition: {} },
      { ...request, status: "archived" },
    ])
      expect(ResourceLifecycleRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("requires lifecycle knowledge for restore without incrementing that counter", () => {
    const request = {
      revision: 1,
      lifecycleRevision: 2_147_483_647,
      versionId: id,
    };
    expect(RestoreResourceRequestSchema.parse(request)).toEqual(request);
    for (const lifecycleRevision of [
      undefined,
      null,
      0,
      -1,
      1.5,
      "1",
      2_147_483_648,
    ]) {
      expect(
        RestoreResourceRequestSchema.safeParse({
          ...request,
          lifecycleRevision,
        }).success,
      ).toBe(false);
    }
  });

  it("defaults lists to active and accepts only explicit active or archived filters", () => {
    expect(CatalogStatusSchema.parse("active")).toBe("active");
    expect(CatalogStatusSchema.parse("archived")).toBe("archived");
    for (const schema of [
      WorkspaceListQuerySchema,
      AgentListQuerySchema,
      FlowListQuerySchema,
    ]) {
      expect(schema.parse({})).toEqual({ status: "active" });
      expect(schema.parse({ cursor: id, status: "archived" })).toEqual({
        cursor: id,
        status: "archived",
      });
      for (const status of [
        "all",
        "deleted",
        "ACTIVE",
        "",
        null,
        ["active", "archived"],
      ]) {
        expect(schema.safeParse({ status }).success).toBe(false);
      }
      expect(schema.safeParse({ status: "archived", limit: 500 }).success).toBe(
        false,
      );
    }
  });

  it("exposes validated lifecycle metadata in all catalog summaries", () => {
    const summary = {
      id,
      teamId: id,
      name: "Archive fixture",
      revision: 1,
      versionId: id,
      schemaVersion: 1,
      updatedAt: instant,
      archivedAt: null,
      lifecycleRevision: 1,
    };
    for (const schema of [
      WorkspaceSummarySchema,
      AgentSummarySchema,
      FlowSummarySchema,
    ]) {
      expect(schema.parse(summary)).toEqual(summary);
      expect(
        schema.parse({ ...summary, archivedAt: instant, lifecycleRevision: 2 }),
      ).toMatchObject({ archivedAt: instant, lifecycleRevision: 2 });
      for (const invalid of [
        { ...summary, archivedAt: "yesterday" },
        { ...summary, archivedAt: undefined },
        { ...summary, lifecycleRevision: undefined },
        { ...summary, lifecycleRevision: 0 },
        { ...summary, lifecycleRevision: 2_147_483_648 },
      ])
        expect(schema.safeParse(invalid).success).toBe(false);
    }
  });
});
