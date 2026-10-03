import { describe, expect, it } from "vitest";
import {
  ResourceVersionListQuerySchema,
  ResourceVersionListResponseSchema,
  ResourceVersionResponseSchema,
  RestoreResourceRequestSchema,
} from "@ark/contracts";

const id = "ab286801-a441-4c81-b111-589de8611ff2";
const metadata = {
  resourceId: id,
  teamId: id,
  versionId: id,
  revision: 1,
  schemaVersion: 1,
  createdAt: "2026-10-02T00:00:00.000Z",
};

describe("catalog history contracts", () => {
  it("accepts only bounded positive revision cursors and rejects extra query fields", () => {
    expect(ResourceVersionListQuerySchema.parse({})).toEqual({});
    expect(ResourceVersionListQuerySchema.parse({ cursor: "50" })).toEqual({
      cursor: 50,
    });
    expect(
      ResourceVersionListQuerySchema.parse({ cursor: "2147483647" }),
    ).toEqual({ cursor: 2_147_483_647 });
    for (const cursor of [
      "",
      "0",
      "-1",
      "1.5",
      "+1",
      " 1",
      "1 ",
      "1e2",
      "Infinity",
      "2147483648",
      id,
      1,
      null,
      ["1"],
    ]) {
      expect(ResourceVersionListQuerySchema.safeParse({ cursor }).success).toBe(
        false,
      );
    }
    expect(
      ResourceVersionListQuerySchema.safeParse({ limit: 500 }).success,
    ).toBe(false);
  });

  it("requires an exact source identity and expected current revision without client definitions", () => {
    const request = { revision: 1, versionId: id };
    expect(RestoreResourceRequestSchema.parse(request)).toEqual(request);
    expect(
      RestoreResourceRequestSchema.parse({
        ...request,
        revision: 2_147_483_646,
      }),
    ).toEqual({ revision: 2_147_483_646, versionId: id });
    for (const revision of [0, -1, 1.5, "1", 2_147_483_647]) {
      expect(
        RestoreResourceRequestSchema.safeParse({ ...request, revision })
          .success,
      ).toBe(false);
    }
    for (const input of [
      { revision: 1 },
      { versionId: id },
      { ...request, versionId: "invalid" },
      { ...request, schemaVersion: 1 },
      { ...request, definition: { name: "Forged content" } },
      { ...request, resourceId: id },
    ]) {
      expect(RestoreResourceRequestSchema.safeParse(input).success).toBe(false);
    }
  });

  it("bounds metadata pages while retaining unknown definitions only in individual reads", () => {
    const page = { versions: [metadata], nextCursor: null };
    expect(ResourceVersionListResponseSchema.parse(page)).toEqual(page);
    expect(
      ResourceVersionListResponseSchema.parse({
        versions: Array(50).fill(metadata),
        nextCursor: 1,
      }),
    ).toMatchObject({ nextCursor: 1 });
    for (const invalid of [
      { versions: Array(51).fill(metadata), nextCursor: 1 },
      { versions: [metadata], nextCursor: "1" },
      { versions: [metadata], nextCursor: 0 },
      { versions: [metadata], nextCursor: 2_147_483_648 },
      {
        versions: [
          { ...metadata, definition: { privateInstructions: "fixture" } },
        ],
        nextCursor: null,
      },
      { versions: [{ ...metadata, revision: 0 }], nextCursor: null },
    ]) {
      expect(ResourceVersionListResponseSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    const future = {
      version: {
        ...metadata,
        schemaVersion: 2,
        definition: { futurePolicy: { preserve: true } },
      },
    };
    expect(ResourceVersionResponseSchema.parse(future)).toEqual(future);
  });
});
