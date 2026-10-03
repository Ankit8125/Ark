import { afterEach, describe, expect, it, vi } from "vitest";
import { agentApi } from "../agents/api";
import { flowApi } from "../flows/api";
import { workspaceApi } from "../workspaces/api";

const teamId = "b8f983e4-8bfe-4c11-8302-d050c258d883";
const id = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const versionId = "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60";
const timestamp = "2026-10-02T00:00:00.000Z";
const summary = {
  resourceId: id,
  teamId,
  versionId,
  revision: 1,
  schemaVersion: 2,
  createdAt: timestamp,
};
const fixture = {
  id,
  teamId,
  versionId,
  revision: 3,
  schemaVersion: 2,
  name: "Stored configuration",
  createdAt: timestamp,
  updatedAt: timestamp,
  definition: { futureField: "Preserve unknown fields" },
};
function respond(value: unknown) {
  const fetch = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(value), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
}
afterEach(() => vi.unstubAllGlobals());

describe.each([
  { plural: "workspaces", kind: "workspace", adapter: workspaceApi },
  { plural: "agents", kind: "agent", adapter: agentApi },
  { plural: "flows", kind: "flow", adapter: flowApi },
])("$kind history request adapter", ({ plural, kind, adapter }) => {
  it("uses a numeric cursor and preserves revision metadata", async () => {
    const fetch = respond({ versions: [summary], nextCursor: null });
    const controller = new AbortController();
    expect(
      await adapter.listVersions(teamId, id, 2, controller.signal),
    ).toEqual({ versions: [summary], nextCursor: null });
    expect(fetch).toHaveBeenCalledWith(
      `/api/teams/${teamId}/${plural}/${id}/versions?cursor=2`,
      expect.objectContaining({
        signal: controller.signal,
        credentials: "same-origin",
      }),
    );
  });
  it("reads the exact snapshot and preserves unknown definition fields", async () => {
    const version = { ...summary, definition: fixture.definition };
    const fetch = respond({ version });
    expect(await adapter.getVersion(teamId, id, versionId)).toEqual(version);
    expect(fetch).toHaveBeenCalledWith(
      `/api/teams/${teamId}/${plural}/${id}/versions/${versionId}`,
      expect.anything(),
    );
  });
  it("posts only the selected version and expected current revision and parses the concrete response", async () => {
    const fetch = respond({ [kind]: fixture });
    const controller = new AbortController();
    expect(
      await adapter.restore(
        teamId,
        id,
        { versionId, revision: 2 },
        controller.signal,
      ),
    ).toEqual(fixture);
    expect(fetch).toHaveBeenCalledWith(
      `/api/teams/${teamId}/${plural}/${id}/restore`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ versionId, revision: 2 }),
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
      }),
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("rejects history, preview, and restore results from another resource context", async () => {
    const otherId = "537bcb18-d56c-471b-bc59-2f38866049a7";
    respond({
      versions: [{ ...summary, resourceId: otherId }],
      nextCursor: null,
    });
    await expect(adapter.listVersions(teamId, id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    respond({
      version: { ...summary, teamId: otherId, definition: fixture.definition },
    });
    await expect(
      adapter.getVersion(teamId, id, versionId),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond({ [kind]: { ...fixture, id: otherId } });
    await expect(
      adapter.restore(teamId, id, { versionId, revision: 2 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});

describe("history page boundaries", () => {
  it.each([
    { versions: [{ ...summary, revision: 2 }], nextCursor: null },
    {
      versions: [
        summary,
        {
          ...summary,
          versionId: "537bcb18-d56c-471b-bc59-2f38866049a7",
          revision: 1,
        },
      ],
      nextCursor: null,
    },
    { versions: [summary], nextCursor: 2 },
    { versions: [], nextCursor: 1 },
  ])(
    "rejects an invalid exclusive cursor, order, or next-page boundary",
    async (page) => {
      respond(page);
      await expect(
        workspaceApi.listVersions(teamId, id, 2),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
});
