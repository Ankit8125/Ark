// @vitest-environment jsdom
import {
  SessionSummarySchema,
  type ExecutionSession,
  type Flow,
  type Runner,
  type SessionEvent,
  type SessionSnapshot,
  type Team,
} from "@ark/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { ApiRequestError } from "../../api";
import { computeApi } from "../compute/api";
import { flowApi } from "../flows/api";
import { parseSessionEvent, sessionEventsUrl, sessionsApi } from "./api";
import { SessionPage } from "./SessionPage";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "admin",
};
const userId = "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60";
const runnerId = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const flowId = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const versionId = "ab286801-a441-4c81-b111-589de8611ff2";
const stageId = "3c286801-a441-4c81-b111-589de8611ff2";
const sessionId = "7c286801-a441-4c81-b111-589de8611ff2";
const otherId = "8c286801-a441-4c81-b111-589de8611ff2";
const now = "2026-10-25T10:00:00.000Z";
const ref = { resourceId: flowId, versionId };
const snapshot: SessionSnapshot = {
  flow: {
    ...ref,
    definition: {
      name: "Review flow",
      description: "",
      workspace: ref,
      inputs: [
        { name: "task", type: "text" },
        { name: "config", type: "json" },
      ],
      stages: [
        {
          id: stageId,
          name: "Review",
          agent: ref,
          inputs: [
            {
              name: "task",
              type: "text",
              source: { kind: "flow_input", port: "task" },
            },
          ],
          outputs: [{ name: "report", type: "text" }],
        },
      ],
      outputs: [
        {
          name: "result",
          type: "text",
          source: { kind: "stage_output", stageId, port: "report" },
        },
      ],
    },
  },
  workspace: {
    ...ref,
    definition: {
      name: "Workspace",
      description: "",
      repositoryUrl: "https://github.com/example/repository",
      sourceRef: "main",
      defaultBranch: "main",
      sandboxImage: "node:24",
      workingDirectory: ".",
      actions: { install: "", test: "", lint: "", build: "" },
    },
  },
  agents: [
    {
      ...ref,
      definition: {
        name: "Agent",
        description: "",
        instructions: "Stub configuration",
        runtime: "stub",
        modelPreference: null,
        capabilities: [],
      },
    },
  ],
};
const inputValues = {
  task: { type: "text" as const, value: "" },
  config: { type: "json" as const, value: {} },
};
const flow: Flow = {
  id: flowId,
  teamId: team.id,
  name: "Review flow",
  revision: 3,
  versionId,
  schemaVersion: 1,
  updatedAt: now,
  createdAt: now,
  archivedAt: null,
  lifecycleRevision: 1,
  definition: snapshot.flow.definition,
};
const runner: Runner = {
  id: runnerId,
  organizationId: userId,
  teamId: team.id,
  name: "Local runner",
  lifecycleRevision: 3,
  createdAt: now,
  enrollmentExpiresAt: now,
  enrolledAt: now,
  lastHeartbeatAt: now,
  revokedAt: null,
  health: "offline",
  dispatchApproved: true,
};
function session(overrides: Partial<ExecutionSession> = {}): ExecutionSession {
  return {
    id: sessionId,
    organizationId: userId,
    teamId: team.id,
    startedBy: userId,
    runnerId,
    flowResourceId: flowId,
    flowVersionId: versionId,
    flowName: "Review flow",
    state: "queued",
    revision: 1,
    stageIndex: 0,
    blockReason: null,
    runtime: "stub.v1",
    quality: "not_evaluated",
    createdAt: now,
    updatedAt: now,
    snapshot,
    inputValues,
    stageResults: {},
    outputs: null,
    ...overrides,
  };
}
function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
  return {
    id: otherId,
    sessionId,
    sequence: 1,
    kind: "created",
    state: "queued",
    stageIndex: 0,
    createdAt: now,
    ...overrides,
  };
}

function summary(overrides: Partial<ExecutionSession> = {}) {
  return SessionSummarySchema.strip().parse(session(overrides));
}

// This fake exercises component cleanup and replay behavior without opening a
// network stream. API/browser acceptance verifies the actual SSE transport.
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly close = vi.fn();
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<
    string,
    (message: MessageEvent<string>) => void
  >();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(
    kind: string,
    listener: (message: MessageEvent<string>) => void,
  ) {
    this.listeners.set(kind, listener);
  }

  emit(
    value: SessionEvent,
    lastEventId = `${value.sessionId}:${value.sequence}`,
  ) {
    this.listeners.get("session")?.(
      new MessageEvent<string>("session", {
        data: JSON.stringify(value),
        lastEventId,
      }),
    );
  }

  fail() {
    this.onerror?.();
  }
}

describe("Sessions API response boundaries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it("scopes a paginated list to its team and forwards its abort signal", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ sessions: [summary()], nextCursor: null }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await sessionsApi.list(team.id, sessionId, controller.signal);
    expect(fetch).toHaveBeenCalledWith(
      `/api/teams/${team.id}/sessions?cursor=${sessionId}`,
      expect.objectContaining({
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
  });
  it.each([
    { sessions: [summary({ teamId: otherId })], nextCursor: null },
    { sessions: [summary(), summary()], nextCursor: null },
  ])("rejects wrong-team or duplicate summaries", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
    );
    await expect(sessionsApi.list(team.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("rejects a preview with a different pin or runner", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ snapshot, runnerId: otherId, inputValues }),
          ),
        ),
    );
    await expect(
      sessionsApi.preview(team.id, { flow: ref, runnerId, inputValues }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("posts a caller-owned creation UUID and rejects a mismatched saved session", async () => {
    const request = { id: sessionId, flow: ref, runnerId, inputValues };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: session() })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: session({ id: otherId }) })),
      );
    vi.stubGlobal("fetch", fetch);
    await sessionsApi.start(team.id, request);
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
    });
    await expect(sessionsApi.start(team.id, request)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
  it("sends exact optimistic revisions and explicit stopped acknowledgement", async () => {
    const fetch = vi
      .fn()
      .mockImplementation(
        async () => new Response(JSON.stringify({ session: session() })),
      );
    vi.stubGlobal("fetch", fetch);
    await sessionsApi.cancel(team.id, sessionId, 7);
    await sessionsApi.reconcile(team.id, sessionId, 8);
    expect(fetch.mock.calls[0]).toEqual([
      `/api/teams/${team.id}/sessions/${sessionId}/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedRevision: 7 }),
      }),
    ]);
    expect(fetch.mock.calls[1]).toEqual([
      `/api/teams/${team.id}/sessions/${sessionId}/reconcile`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ expectedRevision: 8, confirmedStopped: true }),
      }),
    ]);
  });
  it.each([
    { events: [event({ sessionId: otherId })], nextAfter: null },
    { events: [event(), event()], nextAfter: null },
    { events: [event()], nextAfter: 6 },
    { events: [], nextAfter: 2 },
  ])(
    "rejects event pages with another session or invalid ordering/cursor",
    async (body) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(body))),
      );
      await expect(
        sessionsApi.events(team.id, sessionId),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    },
  );
  it("uses a session-bound SSE cursor and verifies data and event identities", () => {
    expect(sessionEventsUrl(team.id, sessionId, 2)).toBe(
      `/api/teams/${team.id}/sessions/${sessionId}/events?after=${sessionId}%3A2`,
    );
    expect(
      parseSessionEvent(sessionId, JSON.stringify(event()), `${sessionId}:1`),
    ).toEqual(event());
    expect(() =>
      parseSessionEvent(sessionId, JSON.stringify(event()), `${otherId}:1`),
    ).toThrow();
    expect(() =>
      parseSessionEvent(
        sessionId,
        JSON.stringify(event({ sessionId: otherId })),
        `${sessionId}:1`,
      ),
    ).toThrow();
    expect(() =>
      parseSessionEvent(
        sessionId,
        JSON.stringify({ ...event(), unrecognized: true }),
        `${sessionId}:1`,
      ),
    ).toThrow();
    expect(() => sessionEventsUrl(team.id, sessionId, -1)).toThrow();
  });
});

const environment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previous = environment.IS_REACT_ACT_ENVIRONMENT;
beforeAll(() => {
  environment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  if (previous === undefined) delete environment.IS_REACT_ACT_ENVIRONMENT;
  else environment.IS_REACT_ACT_ENVIRONMENT = previous;
});

describe("Sessions saved state, authorization and recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onExpired = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(sessionsApi, "list").mockResolvedValue({
      sessions: [],
      nextCursor: null,
    });
    vi.spyOn(sessionsApi, "get").mockImplementation(async (_team, id) => ({
      session: session({ id }),
    }));
    vi.spyOn(sessionsApi, "events").mockImplementation(async (_team, id) => ({
      events: [event({ sessionId: id })],
      nextAfter: null,
    }));
    vi.spyOn(sessionsApi, "preview").mockImplementation(
      async (_team, input) => ({
        snapshot,
        runnerId: input.runnerId,
        inputValues: input.inputValues,
      }),
    );
    vi.spyOn(sessionsApi, "start").mockImplementation(async (_team, input) => ({
      session: session({ id: input.id, inputValues: input.inputValues }),
    }));
    vi.spyOn(sessionsApi, "cancel").mockResolvedValue({
      session: session({ state: "cancelled", revision: 2 }),
    });
    vi.spyOn(sessionsApi, "reconcile").mockResolvedValue({
      session: session({ state: "failed", revision: 3 }),
    });
    vi.spyOn(flowApi, "list").mockResolvedValue({
      flows: [flow],
      nextCursor: null,
    });
    vi.spyOn(flowApi, "get").mockResolvedValue(flow);
    vi.spyOn(computeApi, "list").mockResolvedValue({
      runners: [runner],
      nextCursor: null,
      observedAt: now,
    });
    vi.spyOn(computeApi, "useAccess").mockResolvedValue({
      runner,
      observedAt: now,
      hasUseGrant: true,
      useAllowed: true,
    });
    onExpired.mockClear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function open(
    currentTeam = team,
    onDraftStatus?: (status: { dirty: boolean; busy: boolean }) => void,
  ) {
    await act(() =>
      root.render(
        <SessionPage
          team={currentTeam}
          userId={userId}
          onExpired={onExpired}
          {...(onDraftStatus ? { onDraftStatus } : {})}
        />,
      ),
    );
  }
  function button(label: string) {
    return [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (item) => item.textContent?.trim() === label,
    );
  }
  async function click(label: string) {
    expect(button(label), label).toBeDefined();
    await act(() => button(label)!.click());
  }
  async function select(index: number, value: string) {
    const element = container.querySelectorAll("select")[index]!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function fill(index: number, value: string) {
    const element = container.querySelectorAll("textarea")[index]!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!.call(element, value);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  async function choose() {
    await select(0, flowId);
    await select(1, runnerId);
  }
  async function chooseSaved() {
    await act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!
        .click(),
    );
  }
  function enableFakeStream() {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  }
  function eventRows() {
    return container.querySelectorAll<HTMLLIElement>("li[value]");
  }

  it.each(["viewer", "reviewer"] as const)(
    "keeps %s read-only without loading start choices",
    async (role) => {
      await open({ ...team, role });
      expect(button("Queue stub session")).toBeUndefined();
      expect(flowApi.list).not.toHaveBeenCalled();
      expect(computeApi.list).not.toHaveBeenCalled();
      expect(container.textContent).toContain("can read saved sessions");
    },
  );
  it("previews exact typed values and explicitly pins the chosen saved Flow", async () => {
    await open();
    await choose();
    await fill(0, "Review this task");
    await fill(1, '{"enabled":true}');
    expect(button("Queue stub session")!.disabled).toBe(true);
    await click("Preview");
    expect(sessionsApi.preview).toHaveBeenCalledWith(
      team.id,
      {
        flow: ref,
        runnerId,
        inputValues: {
          task: { type: "text", value: "Review this task" },
          config: { type: "json", value: { enabled: true } },
        },
      },
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain(versionId);
    expect(container.textContent).toContain("not_evaluated");
    expect(container.textContent).toContain("offline");
    expect(button("Queue stub session")!.disabled).toBe(false);
    await fill(0, "Changed");
    expect(button("Queue stub session")!.disabled).toBe(true);
  });
  it("rejects invalid JSON before preview and keeps missing own grants ineligible", async () => {
    await open();
    await choose();
    await fill(1, "invalid JSON");
    await click("Preview");
    expect(sessionsApi.preview).not.toHaveBeenCalled();
    expect(container.textContent).toContain("valid bounded JSON");
    vi.mocked(computeApi.useAccess).mockResolvedValue({
      runner,
      observedAt: now,
      hasUseGrant: false,
      useAllowed: false,
    });
    await select(1, "");
    await select(1, runnerId);
    expect(button("Preview")!.disabled).toBe(true);
    expect(container.textContent).toContain("own explicit grant");
  });
  it("keeps the same immutable creation request through response loss", async () => {
    vi.mocked(sessionsApi.start).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    await choose();
    await click("Preview");
    await click("Queue stub session");
    const first = vi.mocked(sessionsApi.start).mock.calls[0]![1];
    expect(container.textContent).toContain(first.id);
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    expect(button("Refresh choices")!.disabled).toBe(true);
    await click("Retry same queue request");
    expect(vi.mocked(sessionsApi.start).mock.calls[1]![1]).toBe(first);
    expect(container.textContent).not.toContain("outcome is uncertain");
  });
  it("requires a fresh preview after a definite start conflict", async () => {
    vi.mocked(sessionsApi.start).mockRejectedValueOnce(
      new ApiRequestError(409, "CONFLICT", "Changed pin"),
    );
    await open();
    await choose();
    await click("Preview");
    await click("Queue stub session");
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
    expect(button("Queue stub session")!.disabled).toBe(true);
    expect(container.textContent).toContain("Preview again");
  });
  it("preview grant withdrawal preserves readable sessions and the draft while invalidating admission permission", async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [summary({ flowName: "Saved readable run" })],
      nextCursor: null,
    });
    await open();
    await choose();
    await fill(0, "Keep this preview draft");
    await fill(1, '{"enabled":true}');
    await click("Preview");
    expect(container.querySelector('[aria-label="Session preview"]')).not.toBe(
      null,
    );
    expect(button("Queue stub session")!.disabled).toBe(false);
    vi.mocked(sessionsApi.preview).mockRejectedValueOnce(
      new ApiRequestError(
        403,
        "COMPUTE_FORBIDDEN",
        "Your explicit runner grant was withdrawn.",
      ),
    );

    await click("Preview");

    expect(container.textContent).toContain("Saved readable run");
    expect(container.textContent).toContain(sessionId);
    expect(container.textContent).not.toContain("Session access restricted");
    expect(container.textContent).toContain("runner grant was withdrawn");
    expect(container.textContent).toContain(
      "permission is unavailable or denied",
    );
    expect(container.querySelector('[aria-label="Session preview"]')).toBe(
      null,
    );
    expect(button("Preview")!.disabled).toBe(true);
    expect(button("Queue stub session")!.disabled).toBe(true);
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
    expect(container.querySelectorAll("textarea")[0]!.value).toBe(
      "Keep this preview draft",
    );
    expect(container.querySelectorAll("textarea")[1]!.value).toBe(
      '{"enabled":true}',
    );
    expect(container.querySelectorAll("select")[0]!.value).toBe(flowId);
    expect(container.querySelectorAll("select")[1]!.value).toBe(runnerId);
    expect(sessionsApi.start).not.toHaveBeenCalled();
    expect(onExpired).not.toHaveBeenCalled();

    await click("Refresh sessions");
    expect(sessionsApi.list).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("Saved readable run");
    expect(container.querySelectorAll("textarea")[0]!.value).toBe(
      "Keep this preview draft",
    );
    expect(button("Preview")!.disabled).toBe(true);
  });
  it("start grant withdrawal preserves readable sessions and the draft while invalidating admission preview", async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [summary({ flowName: "Saved readable run" })],
      nextCursor: null,
    });
    vi.mocked(sessionsApi.start).mockRejectedValueOnce(
      new ApiRequestError(
        403,
        "COMPUTE_FORBIDDEN",
        "Your explicit runner grant was withdrawn.",
      ),
    );
    await open();
    await choose();
    await fill(0, "Keep this queue draft");
    await fill(1, '{"mode":"saved"}');
    await click("Preview");
    expect(button("Queue stub session")!.disabled).toBe(false);

    await click("Queue stub session");

    expect(sessionsApi.start).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Saved readable run");
    expect(container.textContent).toContain(sessionId);
    expect(container.textContent).not.toContain("Session access restricted");
    expect(container.textContent).toContain("runner grant was withdrawn");
    expect(container.textContent).toContain(
      "permission is unavailable or denied",
    );
    expect(container.querySelector('[aria-label="Session preview"]')).toBe(
      null,
    );
    expect(button("Preview")!.disabled).toBe(true);
    expect(button("Queue stub session")!.disabled).toBe(true);
    expect(button("Retry same queue request")).toBeUndefined();
    expect(container.textContent).not.toContain("Creation ID:");
    expect(container.querySelector("fieldset")!.disabled).toBe(false);
    expect(container.querySelectorAll("textarea")[0]!.value).toBe(
      "Keep this queue draft",
    );
    expect(container.querySelectorAll("textarea")[1]!.value).toBe(
      '{"mode":"saved"}',
    );
    expect(container.querySelectorAll("select")[0]!.value).toBe(flowId);
    expect(container.querySelectorAll("select")[1]!.value).toBe(runnerId);
    expect(onExpired).not.toHaveBeenCalled();

    await chooseSaved();
    expect(sessionsApi.get).toHaveBeenCalledWith(
      team.id,
      sessionId,
      expect.any(AbortSignal),
    );
    expect(container.textContent).not.toContain("Session access restricted");
    expect(container.querySelectorAll("textarea")[0]!.value).toBe(
      "Keep this queue draft",
    );
    expect(button("Queue stub session")!.disabled).toBe(true);
  });
  it("clears restricted session contents on current authorization denial", async () => {
    vi.mocked(sessionsApi.list)
      .mockResolvedValueOnce({ sessions: [session()], nextCursor: null })
      .mockRejectedValueOnce(new ApiRequestError(403, "FORBIDDEN", "Denied"));
    await open();
    await click("Refresh sessions");
    expect(container.textContent).toContain("Session access restricted");
    expect(container.textContent).not.toContain(sessionId);
    expect(button("Queue stub session")).toBeUndefined();
  });
  it("handles session expiration and aborts later pending start replies after a team switch", async () => {
    let resolve!: (value: { session: ExecutionSession }) => void;
    vi.mocked(sessionsApi.start).mockImplementationOnce(
      () =>
        new Promise((complete) => {
          resolve = complete;
        }),
    );
    await open();
    await choose();
    await click("Preview");
    await click("Queue stub session");
    const signal = vi.mocked(sessionsApi.start).mock.calls[0]![2]!;
    await open({ ...team, id: otherId, role: "viewer" });
    expect(signal.aborted).toBe(true);
    await act(() => resolve({ session: session() }));
    expect(container.textContent).not.toContain(sessionId);
    vi.mocked(sessionsApi.list).mockRejectedValueOnce(
      new ApiRequestError(401, "UNAUTHORIZED", "Expired"),
    );
    await click("Refresh sessions");
    expect(onExpired).toHaveBeenCalledOnce();
  });
  it("appends saved list pages and opens the selected immutable snapshot", async () => {
    vi.mocked(sessionsApi.list)
      .mockResolvedValueOnce({ sessions: [session()], nextCursor: sessionId })
      .mockResolvedValueOnce({
        sessions: [session({ id: otherId, flowName: "Second session" })],
        nextCursor: null,
      });
    await open({ ...team, role: "viewer" });
    await click("Load more sessions");
    expect(sessionsApi.list).toHaveBeenLastCalledWith(
      team.id,
      sessionId,
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("Second session");
    await chooseSaved();
    expect(container.textContent).toContain("Stage progress");
    expect(container.textContent).toContain("Agent version");
    expect(button("Cancel session")).toBeUndefined();
    expect(container.textContent).toContain("deterministic placeholders");
  });
  it("confirms cancellation with the saved revision and requires refresh after stale state", async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session()],
      nextCursor: null,
    });
    vi.mocked(sessionsApi.cancel).mockRejectedValueOnce(
      new ApiRequestError(409, "STALE", "Stale revision"),
    );
    await open();
    await chooseSaved();
    await click("Cancel session");
    expect(sessionsApi.cancel).not.toHaveBeenCalled();
    await click("Confirm cancel");
    expect(sessionsApi.cancel).toHaveBeenCalledWith(
      team.id,
      sessionId,
      1,
      expect.any(AbortSignal),
    );
    expect(button("Cancel session")!.disabled).toBe(true);
    await click("Refresh session");
    expect(button("Cancel session")!.disabled).toBe(false);
  });
  it("requires revoked runner observation and explicit stopped confirmation for recovery", async () => {
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session({ state: "blocked", revision: 2 })],
      nextCursor: null,
    });
    vi.mocked(sessionsApi.get).mockResolvedValue({
      session: session({
        state: "blocked",
        revision: 2,
        blockReason: "lease_expired",
      }),
    });
    vi.mocked(computeApi.useAccess).mockResolvedValue({
      runner: { ...runner, revokedAt: now },
      observedAt: now,
      hasUseGrant: true,
      useAllowed: false,
    });
    await open();
    await chooseSaved();
    await click("Reconcile stopped stub");
    expect(button("Confirm reconciliation")!.disabled).toBe(true);
    await act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await click("Confirm reconciliation");
    expect(sessionsApi.reconcile).toHaveBeenCalledWith(
      team.id,
      sessionId,
      2,
      expect.any(AbortSignal),
    );
  });

  it("rechecks runner revocation on refresh even when the blocked session revision is unchanged", async () => {
    const blocked = session({
      state: "blocked",
      revision: 2,
      blockReason: "lease_expired",
    });
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [blocked],
      nextCursor: null,
    });
    vi.mocked(sessionsApi.get).mockResolvedValue({ session: blocked });
    await open();
    await chooseSaved();
    await click("Reconcile stopped stub");
    await act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    expect(button("Confirm reconciliation")!.disabled).toBe(true);
    expect(container.textContent).toContain("not confirmed revoked");

    vi.mocked(computeApi.useAccess).mockResolvedValue({
      runner: { ...runner, revokedAt: now },
      observedAt: now,
      hasUseGrant: true,
      useAllowed: false,
    });
    await click("Refresh session");
    expect(container.textContent).toContain("The runner is revoked.");
    expect(button("Confirm reconciliation")!.disabled).toBe(false);
    await click("Confirm reconciliation");
    expect(sessionsApi.reconcile).toHaveBeenCalledWith(
      team.id,
      sessionId,
      blocked.revision,
      expect.any(AbortSignal),
    );
  });

  it("reports an uncertain queue draft to navigation and clears it only after a confirmed retry", async () => {
    const onDraftStatus = vi.fn();
    let rejectStart!: (reason: unknown) => void;
    vi.mocked(sessionsApi.start).mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectStart = reject;
        }),
    );
    await open(team, onDraftStatus);
    expect(onDraftStatus).toHaveBeenLastCalledWith({
      dirty: false,
      busy: false,
    });
    await choose();
    expect(onDraftStatus).toHaveBeenLastCalledWith({
      dirty: true,
      busy: false,
    });
    await click("Preview");
    await click("Queue stub session");
    expect(onDraftStatus).toHaveBeenLastCalledWith({ dirty: true, busy: true });
    await act(() =>
      rejectStart(new ApiRequestError(0, "OFFLINE", "Response lost")),
    );
    expect(onDraftStatus).toHaveBeenLastCalledWith({
      dirty: true,
      busy: false,
    });
    expect(container.querySelector("fieldset")!.disabled).toBe(true);
    await click("Retry same queue request");
    expect(onDraftStatus).toHaveBeenLastCalledWith({
      dirty: false,
      busy: false,
    });
    expect(
      [...container.querySelectorAll("select")].map((control) => control.value),
    ).toEqual(["", ""]);
  });

  it("deduplicates replay and resumes manual and delayed reconnects after the last verified sequence", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session()],
      nextCursor: null,
    });
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const first = FakeEventSource.instances[0]!;
    expect(first.url).toBe(sessionEventsUrl(team.id, sessionId, 1));
    const claimed = event({
      id: stageId,
      sequence: 2,
      kind: "claimed",
      state: "running",
    });
    await act(() => {
      first.emit(event());
      first.emit(claimed);
      first.emit(claimed);
    });
    expect(eventRows()).toHaveLength(2);
    vi.mocked(sessionsApi.get).mockResolvedValue({
      session: session({ state: "running", revision: 2 }),
    });
    await act(() => vi.advanceTimersByTimeAsync(100));
    await click("Reconnect live events");
    const second = FakeEventSource.instances[1]!;
    expect(first.close).toHaveBeenCalled();
    expect(second.url).toBe(sessionEventsUrl(team.id, sessionId, 2));
    await act(() =>
      first.emit(
        event({
          id: flowId,
          sequence: 3,
          kind: "lease_uncertain",
          state: "blocked",
        }),
      ),
    );
    expect(eventRows()).toHaveLength(2);
    const readsBeforeError = vi.mocked(sessionsApi.get).mock.calls.length;
    await act(() => {
      second.fail();
      second.fail();
    });
    expect(vi.mocked(sessionsApi.get).mock.calls.length).toBe(
      readsBeforeError + 1,
    );
    expect(FakeEventSource.instances).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(999));
    expect(FakeEventSource.instances).toHaveLength(2);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(FakeEventSource.instances).toHaveLength(3);
    expect(FakeEventSource.instances[2]!.url).toBe(
      sessionEventsUrl(team.id, sessionId, 2),
    );
  });

  it("catches up terminal history after finite stream closure and keeps failed tail reads retryable", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session()],
      nextCursor: null,
    });
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const stream = FakeEventSource.instances[0]!;
    vi.mocked(sessionsApi.get).mockResolvedValue({
      session: session({ state: "completed", revision: 4, stageIndex: 1 }),
    });
    const finalStage = event({
      id: stageId,
      sequence: 2,
      kind: "stage_completed",
      state: "running",
      stageIndex: 1,
    });
    const completed = event({
      id: flowId,
      sequence: 3,
      kind: "completed",
      state: "completed",
      stageIndex: 1,
    });
    vi.mocked(sessionsApi.events)
      .mockResolvedValueOnce({ events: [finalStage], nextAfter: 2 })
      .mockRejectedValueOnce(
        new ApiRequestError(0, "OFFLINE", "Tail unavailable"),
      );

    await act(() => stream.fail());
    expect(stream.close).toHaveBeenCalled();
    expect(
      vi
        .mocked(sessionsApi.events)
        .mock.calls.slice(1)
        .map((call) => call[2]),
    ).toEqual([1, 2]);
    expect(eventRows()).toHaveLength(2);
    expect(eventRows()[1]!.textContent).toContain("stage_completed");
    expect(container.textContent).toContain(
      "Saved event history needs a refresh",
    );
    expect(container.textContent).not.toContain(
      "Saved event history is up to date",
    );
    expect(button("Reconnect live events")).toBeUndefined();

    vi.mocked(sessionsApi.events).mockResolvedValueOnce({
      events: [completed],
      nextAfter: null,
    });
    await click("Load more events");
    expect(sessionsApi.events).toHaveBeenLastCalledWith(
      team.id,
      sessionId,
      2,
      expect.any(AbortSignal),
    );
    expect(eventRows()).toHaveLength(3);
    expect(eventRows()[2]!.textContent).toContain("completed");
    expect(container.textContent).toContain(
      "Saved event history is up to date",
    );
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(sessionsApi.events).toHaveBeenCalledTimes(4);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("coalesces a terminal event behind an in-flight detail read and closes the stream permanently", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session()],
      nextCursor: null,
    });
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const stream = FakeEventSource.instances[0]!;
    let resolveRead!: (value: { session: ExecutionSession }) => void;
    vi.mocked(sessionsApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
    );
    await click("Refresh session");
    const completed = session({
      state: "completed",
      revision: 3,
      stageIndex: 1,
      stageResults: {
        [stageId]: { report: { type: "text", value: "Deterministic report" } },
      },
      outputs: { result: { type: "text", value: "Deterministic report" } },
    });
    vi.mocked(sessionsApi.get).mockResolvedValue({ session: completed });
    await act(() =>
      stream.emit(
        event({
          id: stageId,
          sequence: 2,
          kind: "completed",
          state: "completed",
          stageIndex: 1,
        }),
      ),
    );
    expect(stream.close).toHaveBeenCalled();
    expect(sessionsApi.get).toHaveBeenCalledTimes(2);
    await act(() => resolveRead({ session: session() }));
    expect(sessionsApi.get).toHaveBeenCalledTimes(3);
    expect(container.textContent).toContain("Deterministic report");
    expect(button("Reconnect live events")).toBeUndefined();
    await act(() => {
      stream.fail();
      stream.emit(
        event({ id: flowId, sequence: 3, kind: "claimed", state: "running" }),
      );
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(sessionsApi.get).toHaveBeenCalledTimes(3);
    expect(eventRows()).toHaveLength(2);
  });

  it.each([401, 403, 404])(
    "clears private saved data when stream reauthorization returns %s",
    async (status) => {
      enableFakeStream();
      vi.mocked(sessionsApi.list).mockResolvedValue({
        sessions: [session({ flowName: "Private session" })],
        nextCursor: null,
      });
      vi.mocked(sessionsApi.get).mockResolvedValue({
        session: session({
          flowName: "Private session",
          inputValues: {
            ...inputValues,
            task: { type: "text", value: "Private task contents" },
          },
        }),
      });
      await open({ ...team, role: "viewer" });
      await chooseSaved();
      expect(container.textContent).toContain("Private task contents");
      const stream = FakeEventSource.instances[0]!;
      vi.mocked(sessionsApi.get).mockRejectedValueOnce(
        new ApiRequestError(status, "DENIED", "Access lost"),
      );
      await act(() => stream.fail());
      expect(container.textContent).toContain("Session access restricted");
      expect(container.textContent).not.toContain("Private session");
      expect(container.textContent).not.toContain("Private task contents");
      expect(container.textContent).not.toContain(sessionId);
      expect(stream.close).toHaveBeenCalled();
      expect(onExpired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      await act(() => vi.advanceTimersByTimeAsync(10_000));
      expect(FakeEventSource.instances).toHaveLength(1);
    },
  );

  it("leaves reconnect manual after an offline access read instead of retrying in a loop", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [session()],
      nextCursor: null,
    });
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const stream = FakeEventSource.instances[0]!;
    vi.mocked(sessionsApi.get).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "API unavailable"),
    );
    await act(() => stream.fail());
    expect(container.textContent).toContain("Reconnect manually");
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(sessionsApi.get).toHaveBeenCalledTimes(2);
    await click("Reconnect live events");
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(FakeEventSource.instances[1]!.url).toBe(
      sessionEventsUrl(team.id, sessionId, 1),
    );
  });

  it("abandons old stream callbacks and pending access reads on a team switch", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValueOnce({
      sessions: [session()],
      nextCursor: null,
    });
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const oldStream = FakeEventSource.instances[0]!;
    let resolveAccess!: (value: { session: ExecutionSession }) => void;
    vi.mocked(sessionsApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAccess = resolve;
        }),
    );
    await act(() => oldStream.fail());
    const signal = vi.mocked(sessionsApi.get).mock.calls.at(-1)![2]!;
    await open({ ...team, id: otherId, name: "Second team", role: "viewer" });
    expect(signal.aborted).toBe(true);
    await act(() => {
      resolveAccess({ session: session({ flowName: "Late private session" }) });
      oldStream.emit(
        event({ id: stageId, sequence: 2, kind: "claimed", state: "running" }),
      );
      oldStream.fail();
    });
    await act(() => vi.advanceTimersByTimeAsync(10_000));
    expect(container.textContent).toContain("Second team");
    expect(container.textContent).not.toContain("Late private session");
    expect(container.textContent).not.toContain(sessionId);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("starts a newly selected session with its own replay cursor and ignores the previous session stream", async () => {
    enableFakeStream();
    vi.mocked(sessionsApi.list).mockResolvedValue({
      sessions: [
        session(),
        session({ id: otherId, flowName: "Second session" }),
      ],
      nextCursor: null,
    });
    vi.mocked(sessionsApi.get).mockImplementation(async (_team, id) => ({
      session: session({
        id,
        flowName: id === sessionId ? "First session" : "Second session",
      }),
    }));
    vi.mocked(sessionsApi.events).mockImplementation(async (_team, id) => ({
      events: [event({ sessionId: id })],
      nextAfter: null,
    }));
    await open({ ...team, role: "viewer" });
    await chooseSaved();
    const first = FakeEventSource.instances[0]!;
    await act(() =>
      first.emit(
        event({ id: stageId, sequence: 2, kind: "claimed", state: "running" }),
      ),
    );
    expect(eventRows()).toHaveLength(2);
    await chooseSaved();
    const second = FakeEventSource.instances[1]!;
    expect(first.close).toHaveBeenCalled();
    expect(second.url).toBe(sessionEventsUrl(team.id, otherId, 1));
    expect(eventRows()).toHaveLength(1);
    await act(() =>
      first.emit(
        event({
          id: flowId,
          sequence: 3,
          kind: "lease_uncertain",
          state: "blocked",
        }),
      ),
    );
    expect(eventRows()).toHaveLength(1);
    expect(
      container.querySelector("#session-detail-heading")!.textContent,
    ).toBe("Second session");
  });
});
