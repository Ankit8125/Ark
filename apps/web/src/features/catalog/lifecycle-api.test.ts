import { afterEach, describe, expect, it, vi } from "vitest";
import { agentApi } from "../agents/api";
import { flowApi } from "../flows/api";
import { workspaceApi } from "../workspaces/api";

const teamId = "b8f983e4-8bfe-4c11-8302-d050c258d883";
const id = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const timestamp = "2026-10-03T00:00:00.000Z";
const fixture = {
  id,
  teamId,
  versionId: "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60",
  name: "Configuration",
  revision: 5,
  lifecycleRevision: 2,
  archivedAt: timestamp,
  schemaVersion: 2,
  createdAt: timestamp,
  updatedAt: timestamp,
  definition: { preserved: true },
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
])("$kind lifecycle adapter", ({ plural, kind, adapter }) => {
  it.each(["archive", "unarchive"] as const)(
    "posts expected counters to %s and preserves returned metadata",
    async (action) => {
      const result = {
        ...fixture,
        archivedAt: action === "archive" ? timestamp : null,
      };
      const fetch = respond({ [kind]: result });
      const controller = new AbortController();
      const input = { revision: 5, lifecycleRevision: 1 };
      expect(
        await adapter[action](teamId, id, input, controller.signal),
      ).toEqual(result);
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/teams/${teamId}/${plural}/${id}/${action}`,
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify(input),
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
        }),
      );
    },
  );

  it("includes the archived filter with pagination and rejects records of the wrong status", async () => {
    const {
      definition: _definition,
      createdAt: _createdAt,
      ...summary
    } = fixture;
    const fetch = respond({ [plural]: [summary], nextCursor: null });
    const controller = new AbortController();
    await adapter.list(teamId, "cursor+value", controller.signal, "archived");
    expect(fetch).toHaveBeenCalledWith(
      `/api/teams/${teamId}/${plural}?status=archived&cursor=cursor%2Bvalue`,
      expect.objectContaining({ signal: controller.signal }),
    );
    respond({ [plural]: [summary], nextCursor: null });
    await expect(adapter.list(teamId)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    respond({ [plural]: [{ ...summary, archivedAt: null }], nextCursor: null });
    await expect(
      adapter.list(teamId, undefined, undefined, "archived"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a lifecycle response for another resource", async () => {
    respond({
      [kind]: { ...fixture, id: "537bcb18-d56c-471b-bc59-2f38866049a7" },
    });
    await expect(
      adapter.archive(teamId, id, { revision: 5, lifecycleRevision: 1 }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
