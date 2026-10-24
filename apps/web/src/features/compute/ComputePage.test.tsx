// @vitest-environment jsdom
import {
  CreateRunnerEnrollmentRequestSchema,
  type MeResponse,
  type Runner,
  type RunnerListResponse,
  type Team,
} from "@ark/contracts";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
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
import { api, ApiRequestError } from "../../api";
import { Shell } from "../../Shell";
import { ComputePage } from "./ComputePage";
import { registrationStatus } from "./registration";
import { computeApi, createEnrollment } from "./api";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "admin",
};
const runnerId = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const organizationId = "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60";
const observedAt = "2026-10-14T00:00:00.000Z";
function runner(overrides: Partial<Runner> = {}): Runner {
  return {
    id: runnerId,
    organizationId,
    teamId: team.id,
    name: "Local workstation",
    lifecycleRevision: 1,
    createdAt: observedAt,
    enrollmentExpiresAt: "2026-10-14T00:10:00.000Z",
    enrolledAt: null,
    lastHeartbeatAt: null,
    revokedAt: null,
    health: "unknown",
    dispatchApproved: false,
    ...overrides,
  };
}
function list(
  runners: Runner[] = [],
  nextCursor: string | null = null,
): RunnerListResponse {
  return { runners, nextCursor, observedAt };
}

describe("Compute API and credential generation", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses 32 Web Crypto bytes and pairs every fresh enrollment token with its UUID", () => {
    const first = createEnrollment("Local workstation");
    const second = createEnrollment("Local workstation");
    expect(CreateRunnerEnrollmentRequestSchema.safeParse(first).success).toBe(
      true,
    );
    expect(first.enrollmentToken.split("_").at(-1)).toHaveLength(64);
    expect(first.id).not.toBe(second.id);
    expect(first.enrollmentToken).not.toBe(second.enrollmentToken);
  });

  it("reads metadata with the team, cursor and abort signal", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(list([runner()]))));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    expect(await computeApi.list(team.id, runnerId, controller.signal)).toEqual(
      list([runner()]),
    );
    expect(fetch).toHaveBeenCalledExactlyOnceWith(
      `/api/teams/${team.id}/runners?cursor=${runnerId}`,
      expect.objectContaining({
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
  });

  it("posts credentials only in the enrollment JSON body and uses lifecycle checks for revoke", async () => {
    const input = createEnrollment("Local workstation");
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ runner: runner({ id: input.id }), observedAt }),
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            runner: runner({ revokedAt: observedAt, lifecycleRevision: 2 }),
            observedAt,
          }),
        ),
      );
    vi.stubGlobal("fetch", fetch);
    await computeApi.issue(team.id, input);
    expect(fetch.mock.calls[0]![0]).toBe(
      `/api/teams/${team.id}/runner-enrollments`,
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify(input),
      headers: { "Content-Type": "application/json" },
    });
    expect(fetch.mock.calls[0]![0]).not.toContain(input.enrollmentToken);
    await computeApi.revoke(team.id, runnerId, {
      expectedLifecycleRevision: 1,
    });
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ expectedLifecycleRevision: 1 }),
    });
  });

  it.each([
    list([runner({ teamId: organizationId })]),
    list([runner(), runner()]),
    { ...list([runner()]), secret: "unexpected" },
  ])("rejects malformed, duplicate, or wrong-team metadata", async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
    );
    await expect(computeApi.list(team.id)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
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

describe("Compute enrollment and recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter> | undefined;
  let changeTeam: (team: Team) => void;
  const onExpired = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(computeApi, "list").mockResolvedValue(list());
    vi.spyOn(computeApi, "issue").mockImplementation(async (_team, input) => ({
      runner: runner({ id: input.id, name: input.name }),
      observedAt,
    }));
    vi.spyOn(computeApi, "revoke").mockImplementation(async (_team, id) => ({
      runner: runner({ id, revokedAt: observedAt, lifecycleRevision: 2 }),
      observedAt,
    }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    onExpired.mockClear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    router?.dispose();
    router = undefined;
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function open(initialTeam = team) {
    function Harness() {
      const [current, setTeam] = useState(initialTeam);
      useEffect(() => {
        changeTeam = setTeam;
      }, []);
      return <ComputePage team={current} onExpired={onExpired} />;
    }
    await act(() => root.render(<Harness />));
  }
  function input(name: string) {
    return container.querySelector<HTMLInputElement>(`[name="${name}"]`);
  }
  async function fill(value: string) {
    const control = input("runnerName")!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (value) =>
        value.textContent?.trim() === label ||
        value.getAttribute("aria-label") === label,
    );
  }
  async function click(label: string) {
    expect(button(label), label).toBeDefined();
    await act(() => button(label)!.click());
  }
  async function submit() {
    await act(() =>
      container
        .querySelector("form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        ),
    );
  }

  it("requires a name and exposes only an acknowledged masked code without browser storage", async () => {
    const local = vi.spyOn(Storage.prototype, "setItem");
    await open();
    await submit();
    expect(computeApi.issue).not.toHaveBeenCalled();
    expect(input("runnerName")!.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(input("runnerName"));
    await fill("  Desktop runner  ");
    await submit();
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    expect(request.name).toBe("Desktop runner");
    expect(input("enrollmentCode")!.type).toBe("password");
    expect(input("enrollmentCode")!.value).toBe(request.enrollmentToken);
    expect(container.textContent).not.toContain(request.enrollmentToken);
    await click("Reveal code");
    expect(input("enrollmentCode")!.type).toBe("text");
    await click("Hide code");
    expect(input("enrollmentCode")!.type).toBe("password");
    expect(local).not.toHaveBeenCalled();
    expect(container.textContent).toContain("pnpm.cmd runner:local");
    expect(container.textContent).toContain("Unapproved");
  });

  it("retains the exact identity, name and hidden code through an uncertain issue response", async () => {
    vi.mocked(computeApi.issue).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    await fill("Desktop runner");
    await submit();
    const original = structuredClone(
      vi.mocked(computeApi.issue).mock.calls[0]![1],
    );
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")!.readOnly).toBe(true);
    expect(container.textContent).toContain("response was not confirmed");
    await click("Retry same enrollment");
    expect(vi.mocked(computeApi.issue).mock.calls[1]![1]).toEqual(original);
    expect(input("enrollmentCode")!.value).toBe(original.enrollmentToken);
  });

  it("keeps the request hidden in flight and rejects duplicate submissions", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof computeApi.issue>>) => void;
    vi.mocked(computeApi.issue).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open();
    await fill("Desktop runner");
    await submit();
    await submit();
    expect(computeApi.issue).toHaveBeenCalledOnce();
    expect(input("enrollmentCode")).toBeNull();
    expect(button("Issuing enrollment…")!.disabled).toBe(true);
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    await act(() =>
      resolve({
        runner: runner({ id: request.id, name: request.name }),
        observedAt,
      }),
    );
    expect(input("enrollmentCode")!.type).toBe("password");
  });

  it.each(["enrolled", "expired", "revoked"] as const)(
    "does not expose a spent %s code after replay",
    async (state) => {
      vi.mocked(computeApi.issue).mockImplementationOnce(
        async (_team, request) => ({
          runner: runner({
            id: request.id,
            name: request.name,
            ...(state === "enrolled"
              ? { enrolledAt: observedAt }
              : state === "expired"
                ? { enrollmentExpiresAt: observedAt }
                : { revokedAt: observedAt }),
          }),
          observedAt,
        }),
      );
      await open();
      await fill("Spent registration");
      await submit();
      expect(input("enrollmentCode")).toBeNull();
      expect(button("Reveal code")).toBeUndefined();
      expect(container.textContent).toContain("code is no longer available");
    },
  );

  it("hides a previously revealed code when a refresh confirms enrollment", async () => {
    await open();
    await fill("Desktop runner");
    await submit();
    await click("Reveal code");
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([
        runner({
          id: request.id,
          name: request.name,
          enrolledAt: observedAt,
          lastHeartbeatAt: observedAt,
          health: "online",
          lifecycleRevision: 2,
        }),
      ]),
    );
    await click("Refresh runners");
    expect(input("enrollmentCode")).toBeNull();
    expect(container.textContent).toContain("Enrolled");
    expect(container.textContent).toContain("Online");
    expect(container.textContent).toContain("Unapproved");
  });

  it.each([403, 404])(
    "clears private runner data and acknowledged codes after list access denial (%s)",
    async (status) => {
      await open();
      await fill("Confidential build host");
      await submit();
      await click("Reveal code");
      const code = input("enrollmentCode")!.value;
      vi.mocked(computeApi.list).mockRejectedValueOnce(
        new ApiRequestError(status, "FORBIDDEN", "Team access unavailable"),
      );
      await click("Refresh runners");
      expect(input("enrollmentCode")).toBeNull();
      expect(container.innerHTML).not.toContain(code);
      expect(container.textContent).not.toContain("Confidential build host");
      expect(input("runnerName")).toBeNull();
      expect(container.textContent).toContain("read-only Compute access");
      expect(container.textContent).toContain("have been cleared");
      await click("Retry runner list");
      expect(input("enrollmentCode")).toBeNull();
    },
  );

  it("hides a code when its registration is omitted from a refreshed first page", async () => {
    await open();
    await fill("Desktop runner");
    await submit();
    await click("Reveal code");
    vi.mocked(computeApi.list).mockResolvedValueOnce(list([], runnerId));
    await click("Refresh runners");
    expect(input("enrollmentCode")).toBeNull();
    expect(button("Reveal code")).toBeUndefined();
    expect(container.textContent).toContain("Not loaded");
    expect(container.textContent).toContain("code is hidden");
  });

  it("masks a code again when pagination brings its registration back into view", async () => {
    await open();
    await fill("Desktop runner");
    await submit();
    await click("Reveal code");
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    vi.mocked(computeApi.list).mockResolvedValueOnce(list([], runnerId));
    await click("Refresh runners");
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ id: request.id, name: request.name })]),
    );
    await click("Load more runners");
    expect(input("enrollmentCode")!.value).toBe(request.enrollmentToken);
    expect(input("enrollmentCode")!.type).toBe("password");
  });

  it("retires a spent code even if a later metadata response describes it as pending", async () => {
    await open();
    await fill("Desktop runner");
    await submit();
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([
        runner({
          id: request.id,
          enrolledAt: observedAt,
          lifecycleRevision: 2,
        }),
      ]),
    );
    await click("Refresh runners");
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ id: request.id })]),
    );
    await click("Refresh runners");
    expect(input("enrollmentCode")).toBeNull();
    expect(button("Reveal code")).toBeUndefined();
  });

  it.each(["list", "revoke"] as const)(
    "clears an already revealed code immediately when %s detects an expired session",
    async (operation) => {
      await open();
      await fill("Private runner");
      await submit();
      await click("Reveal code");
      const code = input("enrollmentCode")!.value;
      vi.mocked(computeApi[operation]).mockRejectedValueOnce(
        new ApiRequestError(401, "UNAUTHENTICATED", "Expired"),
      );
      await click(operation === "list" ? "Refresh runners" : "Revoke runner");
      expect(onExpired).toHaveBeenCalledOnce();
      expect(input("enrollmentCode")).toBeNull();
      expect(container.innerHTML).not.toContain(code);
      expect(container.textContent).not.toContain("Private runner");
    },
  );

  it("discards a revealed code when revocation detects lost admin access", async () => {
    await open();
    await fill("Private runner");
    await submit();
    await click("Reveal code");
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    vi.mocked(computeApi.revoke).mockRejectedValueOnce(
      new ApiRequestError(403, "FORBIDDEN", "Admin access required"),
    );
    await click("Revoke runner");
    expect(input("enrollmentCode")).toBeNull();
    expect(container.innerHTML).not.toContain(request.enrollmentToken);
    expect(container.textContent).toContain("read-only Compute access");
    expect(container.textContent).toContain("Private runner");
    expect(button("Revoke runner")).toBeUndefined();
  });

  it("clears the code when admin access is lost and cannot recover it after role restoration", async () => {
    await open();
    await fill("Desktop runner");
    await submit();
    await click("Reveal code");
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")).toBeNull();
    await act(() => changeTeam(team));
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")!.value).toBe("");
  });

  it.each(["developer", "reviewer", "viewer"] as const)(
    "allows %s metadata reads and hides admin mutations",
    async (role) => {
      vi.mocked(computeApi.list).mockResolvedValueOnce(list([runner()]));
      await open({ ...team, role });
      expect(container.textContent).toContain("Local workstation");
      expect(container.textContent).toContain("read-only Compute access");
      expect(input("runnerName")).toBeNull();
      expect(button("Revoke runner")).toBeUndefined();
      expect(computeApi.issue).not.toHaveBeenCalled();
    },
  );

  it("clears an acknowledged code on team change and keeps old issue responses out of the new team", async () => {
    await open();
    await fill("First team runner");
    await submit();
    await click("Reveal code");
    const firstRequest = vi.mocked(computeApi.issue).mock.calls[0]![1];
    const secondTeam = { ...team, id: organizationId, name: "Second team" };
    await act(() => changeTeam(secondTeam));
    expect(input("enrollmentCode")).toBeNull();
    expect(container.innerHTML).not.toContain(firstRequest.enrollmentToken);
    let resolve!: (value: Awaited<ReturnType<typeof computeApi.issue>>) => void;
    vi.mocked(computeApi.issue).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await fill("Second team runner");
    await submit();
    const request = vi.mocked(computeApi.issue).mock.calls[1]![1];
    const signal = vi.mocked(computeApi.issue).mock.calls[1]![2]!;
    await act(() => changeTeam(team));
    expect(signal.aborted).toBe(true);
    await act(() =>
      resolve({
        runner: runner({ id: request.id, teamId: secondTeam.id }),
        observedAt,
      }),
    );
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")!.value).toBe("");
    expect(container.textContent).not.toContain("Second team runner");
  });

  it("aborts a pending issue on unmount and a new mount cannot recover its code", async () => {
    vi.mocked(computeApi.issue).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    await open();
    await fill("Desktop runner");
    await submit();
    const signal = vi.mocked(computeApi.issue).mock.calls[0]![2]!;
    await act(() => root.render(<p>Closed</p>));
    expect(signal.aborted).toBe(true);
    await open();
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")!.value).toBe("");
    expect(button("Issue enrollment code")).toBeDefined();
  });

  it("redacts an echoed request code from a failed response", async () => {
    vi.mocked(computeApi.issue).mockImplementationOnce(
      async (_team, request) => {
        throw new ApiRequestError(
          500,
          "FAILED",
          `Failure ${request.enrollmentToken}`,
        );
      },
    );
    await open();
    await fill("Desktop runner");
    await submit();
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    expect(container.innerHTML).not.toContain(request.enrollmentToken);
    expect(container.textContent).toContain("[redacted]");
  });

  it("allows name correction after a confirmed validation rejection", async () => {
    vi.mocked(computeApi.issue).mockRejectedValueOnce(
      new ApiRequestError(400, "VALIDATION_ERROR", "Invalid runner name", {
        name: ["Choose another name."],
      }),
    );
    await open();
    await fill("Rejected name");
    await submit();
    expect(input("runnerName")!.readOnly).toBe(false);
    expect(container.textContent).toContain("Choose another name");
    await fill("Corrected name");
    await submit();
    expect(vi.mocked(computeApi.issue).mock.calls[1]![1].name).toBe(
      "Corrected name",
    );
  });

  it("redacts a code echoed inside field validation errors", async () => {
    vi.mocked(computeApi.issue).mockImplementationOnce(
      async (_team, request) => {
        throw new ApiRequestError(400, "VALIDATION_ERROR", "Invalid name", {
          name: [`Name contains ${request.enrollmentToken}`],
        });
      },
    );
    await open();
    await fill("Desktop runner");
    await submit();
    const request = vi.mocked(computeApi.issue).mock.calls[0]![1];
    expect(container.innerHTML).not.toContain(request.enrollmentToken);
    expect(container.textContent).toContain("Name contains [redacted]");
  });

  it("retries offline list and pagination reads without losing loaded metadata", async () => {
    vi.mocked(computeApi.list).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    expect(container.textContent).toContain("Offline");
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner()], runnerId),
    );
    await click("Retry runner list");
    vi.mocked(computeApi.list).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Pagination unavailable"),
    );
    await click("Load more runners");
    expect(container.textContent).toContain("Local workstation");
    expect(container.textContent).toContain("Pagination unavailable");
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ id: organizationId, name: "Second runner" })]),
    );
    await click("Retry more runners");
    expect(container.textContent).toContain("Local workstation");
    expect(container.textContent).toContain("Second runner");
    expect(vi.mocked(computeApi.list).mock.calls.at(-1)![1]).toBe(runnerId);
  });

  it("ignores a late list response after a team switch", async () => {
    let resolve!: (value: RunnerListResponse) => void;
    vi.mocked(computeApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open();
    const signal = vi.mocked(computeApi.list).mock.calls[0]![2]!;
    await act(() => changeTeam({ ...team, id: organizationId }));
    expect(signal.aborted).toBe(true);
    await act(() => resolve(list([runner()])));
    expect(container.textContent).not.toContain("Local workstation");
  });

  it("keeps a pending read alive across callback changes and calls the latest expiration handler", async () => {
    let reject!: (reason: Error) => void;
    vi.mocked(computeApi.list).mockImplementationOnce(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const initialExpired = vi.fn();
    await act(() =>
      root.render(<ComputePage team={team} onExpired={initialExpired} />),
    );
    const signal = vi.mocked(computeApi.list).mock.calls[0]![2]!;
    await act(() =>
      root.render(<ComputePage team={team} onExpired={onExpired} />),
    );
    expect(computeApi.list).toHaveBeenCalledOnce();
    expect(signal.aborted).toBe(false);
    await act(() =>
      reject(new ApiRequestError(401, "UNAUTHENTICATED", "Expired")),
    );
    expect(initialExpired).not.toHaveBeenCalled();
    expect(onExpired).toHaveBeenCalledOnce();
  });

  it("keeps pagination alive across callback changes without replacing the loaded page", async () => {
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner()], runnerId),
    );
    await act(() =>
      root.render(<ComputePage team={team} onExpired={vi.fn()} />),
    );
    let resolve!: (value: RunnerListResponse) => void;
    vi.mocked(computeApi.list).mockImplementationOnce(
      () =>
        new Promise((yes) => {
          resolve = yes;
        }),
    );
    await click("Load more runners");
    const signal = vi.mocked(computeApi.list).mock.calls[1]![2]!;
    await act(() =>
      root.render(<ComputePage team={team} onExpired={onExpired} />),
    );
    expect(computeApi.list).toHaveBeenCalledTimes(2);
    expect(signal.aborted).toBe(false);
    await act(() =>
      resolve(list([runner({ id: organizationId, name: "Second runner" })])),
    );
    expect(container.textContent).toContain("Local workstation");
    expect(container.textContent).toContain("Second runner");
    expect(container.textContent).not.toContain("Loading runners…");
  });

  it("confirms revoke, rejects stale revisions, then uses fresh metadata after refresh", async () => {
    vi.mocked(computeApi.list).mockResolvedValueOnce(list([runner()]));
    await open();
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click("Revoke runner");
    expect(computeApi.revoke).not.toHaveBeenCalled();
    vi.mocked(computeApi.revoke).mockRejectedValueOnce(
      new ApiRequestError(409, "LIFECYCLE_CONFLICT", "Registration changed"),
    );
    await click("Revoke runner");
    expect(vi.mocked(computeApi.revoke).mock.calls[0]![2]).toEqual({
      expectedLifecycleRevision: 1,
    });
    expect(container.textContent).toContain(
      "Refresh runners before confirming",
    );
    expect(button("Revoke runner")!.disabled).toBe(true);
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ lifecycleRevision: 2, enrolledAt: observedAt })]),
    );
    await click("Refresh runners");
    await click("Revoke runner");
    expect(vi.mocked(computeApi.revoke).mock.calls[1]![2]).toEqual({
      expectedLifecycleRevision: 2,
    });
    expect(container.textContent).toContain("Revoked");
    expect(button("Revoke runner")).toBeUndefined();
  });

  it("preserves metadata but requires refresh after an uncertain revoke", async () => {
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([
        runner({
          enrolledAt: observedAt,
          lastHeartbeatAt: observedAt,
          health: "online",
          lifecycleRevision: 2,
        }),
      ]),
    );
    vi.mocked(computeApi.revoke).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    await click("Revoke runner");
    expect(container.textContent).toContain("Online");
    expect(container.textContent).toContain(
      "previous request may have succeeded",
    );
    await click("Revoke runner");
    expect(computeApi.revoke).toHaveBeenCalledOnce();
    expect(button("Revoke runner")!.disabled).toBe(true);
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ enrolledAt: observedAt, lifecycleRevision: 3 })]),
    );
    await click("Refresh runners");
    await click("Revoke runner");
    expect(
      vi.mocked(computeApi.revoke).mock.calls.map((call) => call[2]),
    ).toEqual([
      { expectedLifecycleRevision: 2 },
      { expectedLifecycleRevision: 3 },
    ]);
  });

  it("keeps a stale revoke blocked when refresh fails and pagination only loads other runners", async () => {
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner()], runnerId),
    );
    await open();
    vi.mocked(computeApi.revoke).mockRejectedValueOnce(
      new ApiRequestError(409, "LIFECYCLE_CONFLICT", "Registration changed"),
    );
    await click("Revoke runner");
    vi.mocked(computeApi.list).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Refresh unavailable"),
    );
    await click("Refresh runners");
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ id: organizationId, name: "Second runner" })]),
    );
    await click("Retry more runners");
    expect(button(`Revoke Local workstation (${runnerId})`)!.disabled).toBe(
      true,
    );
    expect(container.textContent).toContain(
      "Refresh runners before confirming",
    );
    expect(computeApi.revoke).toHaveBeenCalledOnce();
    vi.mocked(computeApi.list).mockResolvedValueOnce(
      list([runner({ lifecycleRevision: 2, enrolledAt: observedAt })]),
    );
    await click("Refresh runners");
    expect(button("Revoke runner")!.disabled).toBe(false);
    await click("Revoke runner");
    expect(vi.mocked(computeApi.revoke).mock.calls[1]![2]).toEqual({
      expectedLifecycleRevision: 2,
    });
  });

  it.each(["list", "issue", "revoke"] as const)(
    "reports expired authentication on %s",
    async (operation) => {
      vi.mocked(computeApi.list).mockResolvedValue(list([runner()]));
      vi.mocked(computeApi[operation]).mockRejectedValueOnce(
        new ApiRequestError(401, "UNAUTHENTICATED", "Expired"),
      );
      await open();
      if (operation === "issue") {
        await fill("Desktop runner");
        await submit();
      }
      if (operation === "revoke") await click("Revoke runner");
      expect(onExpired).toHaveBeenCalledOnce();
      expect(input("enrollmentCode")).toBeNull();
    },
  );

  it("shows distinct registration and health facts including historical heartbeat after revoke", async () => {
    const revoked = runner({
      revokedAt: observedAt,
      enrolledAt: observedAt,
      lastHeartbeatAt: observedAt,
      health: "unknown",
    });
    vi.mocked(computeApi.list).mockResolvedValueOnce(list([revoked]));
    await open();
    expect(registrationStatus(runner(), observedAt)).toBe("Pending");
    expect(
      registrationStatus(
        runner({ enrollmentExpiresAt: observedAt }),
        observedAt,
      ),
    ).toBe("Expired");
    expect(
      registrationStatus(runner({ enrolledAt: observedAt }), observedAt),
    ).toBe("Enrolled");
    expect(registrationStatus(revoked, observedAt)).toBe("Revoked");
    expect(container.textContent).toContain("Unknown");
    expect(container.textContent).toContain("historical");
    expect(container.textContent).toContain("Unapproved");
    expect(button("Revoke runner")).toBeUndefined();
  });

  it("routes Compute through verified team access and clears the code when logout starts", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as MediaQueryList),
    );
    vi.spyOn(api, "team").mockResolvedValue(team);
    let reject!: (reason: Error) => void;
    vi.spyOn(api, "logout").mockImplementation(
      () =>
        new Promise((_resolve, no) => {
          reject = no;
        }),
    );
    const me: MeResponse = {
      user: {
        id: organizationId,
        name: "Test admin",
        email: "admin@example.com",
      },
      organization: {
        id: organizationId,
        name: "Test organization",
        role: "owner",
      },
      teams: [team],
    };
    router = createMemoryRouter(
      [
        {
          path: "*",
          element: (
            <Shell
              me={me}
              onExpired={onExpired}
              onLogout={vi.fn()}
              onRefresh={vi.fn()}
            />
          ),
        },
      ],
      { initialEntries: ["/compute"] },
    );
    await act(() => root.render(<RouterProvider router={router!} />));
    expect(
      container
        .querySelector('a[href="/compute"]')
        ?.getAttribute("aria-current"),
    ).toBe("page");
    await fill("Desktop runner");
    await submit();
    await click("Reveal code");
    const code = input("enrollmentCode")!.value;
    await click("Sign out");
    expect(input("enrollmentCode")).toBeNull();
    expect(container.innerHTML).not.toContain(code);
    await act(() =>
      reject(new ApiRequestError(0, "OFFLINE", "Logout unavailable")),
    );
    expect(input("enrollmentCode")).toBeNull();
    expect(input("runnerName")!.value).toBe("");
  });
});
