// @vitest-environment jsdom
import type {
  Runner,
  RunnerGrantMember,
  RunnerGrantsResponse,
  RunnerUseAccessResponse,
  Team,
} from "@ark/contracts";
import { act, useEffect, useState } from "react";
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
import { computeApi } from "./api";
import { ComputePage } from "./ComputePage";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "admin",
};
const observedAt = "2026-10-20T00:00:00.000Z";
const runner: Runner = {
  id: "e954fe5a-ce79-498d-b185-1f7d4f5c1b28",
  organizationId: "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60",
  teamId: team.id,
  name: "Build host",
  lifecycleRevision: 2,
  createdAt: observedAt,
  enrollmentExpiresAt: "2026-10-20T00:10:00.000Z",
  enrolledAt: observedAt,
  lastHeartbeatAt: observedAt,
  revokedAt: null,
  health: "offline",
  dispatchApproved: false,
};
const member: RunnerGrantMember = {
  userId: "f4f2e97f-02cb-49eb-bebe-e08d8dc89c90",
  displayName: "Alex Developer",
  role: "developer",
  eligible: true,
  granted: false,
};
function roster(overrides: Partial<RunnerGrantsResponse> = {}) {
  return {
    runner,
    observedAt,
    members: [member],
    nextCursor: null,
    ...overrides,
  };
}
function access(overrides: Partial<RunnerUseAccessResponse> = {}) {
  return {
    runner,
    observedAt,
    hasUseGrant: false,
    useAllowed: false,
    ...overrides,
  };
}

describe("Compute permission API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("binds permission reads to the runner and sends cursor and cancellation", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(roster())))
      .mockResolvedValueOnce(new Response(JSON.stringify(access())));
    vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    await computeApi.grants(
      team.id,
      runner.id,
      member.userId,
      controller.signal,
    );
    await computeApi.useAccess(team.id, runner.id, controller.signal);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      `/api/teams/${team.id}/runners/${runner.id}/grants?cursor=${member.userId}`,
      `/api/teams/${team.id}/runners/${runner.id}/use-access`,
    ]);
    for (const call of fetch.mock.calls)
      expect(call[1]).toMatchObject({
        credentials: "same-origin",
        signal: controller.signal,
      });
  });

  it("posts approval and grants with the expected lifecycle revision", async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            runner: { ...runner, dispatchApproved: true, lifecycleRevision: 3 },
            observedAt,
          }),
        ),
    );
    vi.stubGlobal("fetch", fetch);
    await computeApi.setApproval(team.id, runner.id, {
      expectedLifecycleRevision: 2,
      approved: true,
    });
    await computeApi.setGrant(team.id, runner.id, member.userId, {
      expectedLifecycleRevision: 3,
      granted: true,
    });
    expect(fetch.mock.calls[0]![0]).toBe(
      `/api/teams/${team.id}/runners/${runner.id}/dispatch-approval`,
    );
    expect(fetch.mock.calls[1]![0]).toBe(
      `/api/teams/${team.id}/runners/${runner.id}/grants/${member.userId}`,
    );
    expect(fetch.mock.calls[0]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ expectedLifecycleRevision: 2, approved: true }),
    });
    expect(fetch.mock.calls[1]![1]).toMatchObject({
      method: "POST",
      body: JSON.stringify({ expectedLifecycleRevision: 3, granted: true }),
    });
  });

  it.each([
    roster({ runner: { ...runner, teamId: runner.organizationId } }),
    roster({ runner: { ...runner, id: member.userId } }),
    roster({ members: [member, member] }),
    { ...roster(), enrollmentToken: "unexpected" },
  ])(
    "rejects foreign, duplicate, or extra grant response data",
    async (value) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
      );
      await expect(computeApi.grants(team.id, runner.id)).rejects.toMatchObject(
        { code: "INVALID_RESPONSE" },
      );
    },
  );

  it("rejects a personal access response for a different runner", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify(
              access({ runner: { ...runner, id: member.userId } }),
            ),
          ),
        ),
    );
    await expect(
      computeApi.useAccess(team.id, runner.id),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a successful response with the wrong approval state", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ runner, observedAt })),
        ),
    );
    await expect(
      computeApi.setApproval(team.id, runner.id, {
        expectedLifecycleRevision: 2,
        approved: true,
      }),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
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

describe("Compute approval and use grants", () => {
  let container: HTMLDivElement;
  let root: Root;
  let changeTeam: (value: Team) => void;
  const onExpired = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(computeApi, "list").mockResolvedValue({
      runners: [runner],
      observedAt,
      nextCursor: null,
    });
    vi.spyOn(computeApi, "grants").mockResolvedValue(roster());
    vi.spyOn(computeApi, "useAccess").mockResolvedValue(access());
    vi.spyOn(computeApi, "setApproval").mockResolvedValue({
      runner: { ...runner, dispatchApproved: true, lifecycleRevision: 3 },
      observedAt,
    });
    vi.spyOn(computeApi, "setGrant").mockResolvedValue({
      runner: { ...runner, lifecycleRevision: 3 },
      observedAt,
    });
    vi.spyOn(computeApi, "revoke").mockResolvedValue({
      runner: { ...runner, revokedAt: observedAt, lifecycleRevision: 3 },
      observedAt,
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    onExpired.mockClear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
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
  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (control) =>
        control.textContent?.trim() === label ||
        control.getAttribute("aria-label") === label,
    );
  }
  async function click(label: string) {
    expect(button(label), label).toBeDefined();
    await act(() => button(label)!.click());
  }
  const grantLabel = `Grant use to ${member.displayName} (${member.userId})`;
  const removeLabel = `Remove grant from ${member.displayName} (${member.userId})`;

  it("loads access only on demand and keeps approval, health, and personal permission distinct", async () => {
    await open();
    expect(computeApi.grants).not.toHaveBeenCalled();
    expect(computeApi.useAccess).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Offline");
    expect(container.textContent).toContain("Unapproved");
    await click("Manage access");
    expect(computeApi.grants).toHaveBeenCalledOnce();
    expect(computeApi.useAccess).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Your stored use grant");
    expect(container.textContent).toContain("Not granted");
    expect(container.textContent).toContain("Your current use permission");
    expect(container.textContent).toContain("Not allowed");
    expect(button("Approve dispatch")!.disabled).toBe(false);
  });

  it.each(["developer", "reviewer", "viewer"] as const)(
    "lets a %s inspect only personal access",
    async (role) => {
      await open({ ...team, role });
      await click("Check my access");
      expect(computeApi.grants).not.toHaveBeenCalled();
      expect(computeApi.useAccess).toHaveBeenCalledOnce();
      expect(container.textContent).toContain("Your current use permission");
      expect(button("Approve dispatch")).toBeUndefined();
      expect(button(grantLabel)).toBeUndefined();
    },
  );

  it("shows allowed permission independently of offline health", async () => {
    const approved = { ...runner, dispatchApproved: true };
    vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
      access({ runner: approved, hasUseGrant: true, useAllowed: true }),
    );
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ runner: approved }),
    );
    await open();
    await click("Manage access");
    expect(container.textContent).toContain("Offline");
    expect(container.textContent).toContain("Approved");
    expect(container.textContent).toContain("Allowed");
    expect(button("Withdraw dispatch approval")).toBeDefined();
  });

  it("confirms the exact runner and desired approval, and makes cancellation inert", async () => {
    await open();
    await click("Manage access");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click("Approve dispatch");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(`“${runner.name}” (${runner.id})`),
    );
    expect(computeApi.setApproval).not.toHaveBeenCalled();
    expect(button("Approve dispatch")!.disabled).toBe(false);
    await click("Approve dispatch");
    expect(computeApi.setApproval).toHaveBeenCalledExactlyOnceWith(
      team.id,
      runner.id,
      { expectedLifecycleRevision: 2, approved: true },
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("Permission saved");
    expect(button("Revoke runner")!.disabled).toBe(true);
    expect(computeApi.grants).toHaveBeenCalledOnce();
  });

  it("confirms the exact recipient, runner and removal even for an ineligible stored grant", async () => {
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ members: [{ ...member, eligible: false, granted: true }] }),
    );
    await open();
    await click("Manage access");
    await click(removeLabel);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        `Remove use permission from “${member.displayName}” (${member.userId}) on runner “${runner.name}” (${runner.id})`,
      ),
    );
    expect(computeApi.setGrant).toHaveBeenCalledExactlyOnceWith(
      team.id,
      runner.id,
      member.userId,
      { expectedLifecycleRevision: 2, granted: false },
      expect.any(AbortSignal),
    );
  });

  it.each([{ enrolledAt: null }, { revokedAt: observedAt }])(
    "does not offer approval or grant writes for pending/revoked runners",
    async (override) => {
      const unavailable = { ...runner, ...override };
      vi.mocked(computeApi.list).mockResolvedValueOnce({
        runners: [unavailable],
        observedAt,
        nextCursor: null,
      });
      vi.mocked(computeApi.grants).mockResolvedValueOnce(
        roster({ runner: unavailable }),
      );
      vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
        access({ runner: unavailable }),
      );
      await open();
      await click("Manage access");
      expect(button("Approve dispatch")).toBeUndefined();
      expect(button(grantLabel)).toBeUndefined();
    },
  );

  it("does not offer a new grant to an ineligible member", async () => {
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ members: [{ ...member, eligible: false }] }),
    );
    await open();
    await click("Manage access");
    expect(container.textContent).toContain("Currently ineligible");
    expect(button(grantLabel)).toBeUndefined();
  });

  it.each([{ enrolledAt: null }, { revokedAt: observedAt }])(
    "allows removal of stored grants on pending/revoked runners",
    async (override) => {
      const unavailable = { ...runner, ...override };
      vi.mocked(computeApi.list).mockResolvedValueOnce({
        runners: [unavailable],
        observedAt,
        nextCursor: null,
      });
      vi.mocked(computeApi.grants).mockResolvedValueOnce(
        roster({
          runner: unavailable,
          members: [{ ...member, granted: true, eligible: false }],
        }),
      );
      vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
        access({ runner: unavailable }),
      );
      await open();
      await click("Manage access");
      expect(button("Approve dispatch")).toBeUndefined();
      await click(removeLabel);
      expect(computeApi.setGrant).toHaveBeenCalledExactlyOnceWith(
        team.id,
        runner.id,
        member.userId,
        { expectedLifecycleRevision: 2, granted: false },
        expect.any(AbortSignal),
      );
    },
  );

  it("withdraws approval only after confirmation and posts the current revision", async () => {
    const approved = {
      ...runner,
      dispatchApproved: true,
      lifecycleRevision: 5,
    };
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ runner: approved }),
    );
    vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
      access({ runner: approved }),
    );
    vi.mocked(computeApi.setApproval).mockResolvedValueOnce({
      runner: { ...approved, dispatchApproved: false, lifecycleRevision: 6 },
      observedAt,
    });
    await open();
    await click("Manage access");
    await click("Withdraw dispatch approval");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        `Withdraw dispatch approval from runner “${runner.name}” (${runner.id})`,
      ),
    );
    expect(computeApi.setApproval).toHaveBeenCalledExactlyOnceWith(
      team.id,
      runner.id,
      { expectedLifecycleRevision: 5, approved: false },
      expect.any(AbortSignal),
    );
    expect(container.textContent).toContain("Unapproved");
  });

  it("cancels a grant without changing permission or revision", async () => {
    await open();
    await click("Manage access");
    vi.mocked(window.confirm).mockReturnValueOnce(false);
    await click(grantLabel);
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining(
        `Grant use permission for “${member.displayName}” (${member.userId})`,
      ),
    );
    expect(computeApi.setGrant).not.toHaveBeenCalled();
    expect(button(grantLabel)!.disabled).toBe(false);
  });

  it.each([0, 409, 502])(
    "requires explicit reconciliation after a failed grant response (%s)",
    async (status) => {
      vi.mocked(computeApi.setGrant).mockRejectedValueOnce(
        new ApiRequestError(status, "FAILED", "Could not confirm"),
      );
      await open();
      await click("Manage access");
      await click(grantLabel);
      expect(button(grantLabel)!.disabled).toBe(true);
      expect(button("Approve dispatch")!.disabled).toBe(true);
      expect(button("Revoke runner")!.disabled).toBe(true);
      await click(grantLabel);
      expect(computeApi.setGrant).toHaveBeenCalledOnce();
      const latest = { ...runner, lifecycleRevision: 3 };
      vi.mocked(computeApi.grants).mockResolvedValueOnce(
        roster({ runner: latest, members: [{ ...member, granted: true }] }),
      );
      vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
        access({ runner: latest }),
      );
      await click("Refresh access");
      expect(button(removeLabel)!.disabled).toBe(false);
      await click(removeLabel);
      expect(vi.mocked(computeApi.setGrant).mock.calls[1]![3]).toEqual({
        expectedLifecycleRevision: 3,
        granted: false,
      });
    },
  );

  it("reconciles changed recipient eligibility without removing the current admin's controls or enrollment draft", async () => {
    vi.mocked(computeApi.setGrant).mockRejectedValueOnce(
      new ApiRequestError(
        403,
        "GRANT_RECIPIENT_INELIGIBLE",
        "This member is not currently eligible to use compute.",
      ),
    );
    await open();
    const name = container.querySelector<HTMLInputElement>(
      '[name="runnerName"]',
    )!;
    await act(() => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!.call(name, "Replacement host draft");
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Manage access");
    await click(grantLabel);
    expect(container.textContent).toContain(
      "This member is not currently eligible",
    );
    expect(container.textContent).not.toContain("read-only Compute access");
    expect(container.textContent).not.toContain(member.displayName);
    expect(
      container.querySelector<HTMLInputElement>('[name="runnerName"]')!.value,
    ).toBe("Replacement host draft");
    expect(button("Manage access")).toBeDefined();
    expect(button("Revoke runner")!.disabled).toBe(true);
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({
        members: [{ ...member, role: "viewer", eligible: false }],
      }),
    );
    await click("Refresh access");
    expect(button(grantLabel)).toBeUndefined();
    expect(container.textContent).toContain("Currently ineligible");
    expect(button("Approve dispatch")!.disabled).toBe(false);
    expect(button("Revoke runner")!.disabled).toBe(false);
    expect(computeApi.setGrant).toHaveBeenCalledOnce();
    expect(onExpired).not.toHaveBeenCalled();
  });

  it("blocks writes when independently loaded permission views have different revisions", async () => {
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ runner: { ...runner, lifecycleRevision: 3 } }),
    );
    await open();
    await click("Manage access");
    expect(container.textContent).toContain(
      "Permissions changed while loading",
    );
    expect(button("Approve dispatch")).toBeUndefined();
    expect(button("Revoke runner")!.disabled).toBe(true);
  });

  it("keeps writes blocked after a failed reconciliation read", async () => {
    vi.mocked(computeApi.setApproval).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    await click("Manage access");
    await click("Approve dispatch");
    vi.mocked(computeApi.grants).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await click("Refresh access");
    expect(button("Approve dispatch")!.disabled).toBe(true);
    expect(button(grantLabel)!.disabled).toBe(true);
    expect(button("Revoke runner")!.disabled).toBe(true);
    expect(container.textContent).toContain(member.displayName);
    expect(container.textContent).not.toContain("Your current use permission");
    expect(computeApi.setApproval).toHaveBeenCalledOnce();
  });

  it("keeps one runner's uncertain outcome blocked when another runner is inspected", async () => {
    const second = {
      ...runner,
      id: runner.organizationId,
      name: "Second host",
    };
    vi.mocked(computeApi.list).mockResolvedValueOnce({
      runners: [runner, second],
      observedAt,
      nextCursor: null,
    });
    vi.mocked(computeApi.setGrant).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Offline"),
    );
    await open();
    await click(`Manage access for ${runner.name} (${runner.id})`);
    await click(grantLabel);
    await click("Close access");
    vi.mocked(computeApi.grants).mockResolvedValueOnce(
      roster({ runner: second }),
    );
    vi.mocked(computeApi.useAccess).mockResolvedValueOnce(
      access({ runner: second }),
    );
    await click(`Manage access for ${second.name} (${second.id})`);
    expect(button(`Revoke ${runner.name} (${runner.id})`)!.disabled).toBe(true);
    expect(button(`Revoke ${second.name} (${second.id})`)!.disabled).toBe(
      false,
    );
  });

  it("loads more members with the cursor and rejects a changed revision between pages", async () => {
    vi.mocked(computeApi.grants)
      .mockResolvedValueOnce(roster({ nextCursor: member.userId }))
      .mockResolvedValueOnce(
        roster({
          members: [
            { ...member, userId: runner.organizationId, displayName: "Sam" },
          ],
          nextCursor: runner.organizationId,
        }),
      )
      .mockResolvedValueOnce(
        roster({ runner: { ...runner, lifecycleRevision: 4 }, members: [] }),
      );
    await open();
    await click("Manage access");
    await click("Load more members");
    expect(vi.mocked(computeApi.grants).mock.calls[1]![2]).toBe(member.userId);
    expect(container.textContent).toContain("Alex Developer");
    expect(container.textContent).toContain("Sam");
    await click("Load more members");
    expect(button("Approve dispatch")!.disabled).toBe(true);
    expect(container.textContent).toContain(
      "Permissions changed while loading members",
    );
  });

  it("clears the roster and enrollment controls on admin access loss while retaining public-to-team rows", async () => {
    await open();
    await click("Manage access");
    vi.mocked(computeApi.grants).mockRejectedValueOnce(
      new ApiRequestError(403, "FORBIDDEN", "Admin required"),
    );
    await click("Refresh access");
    expect(container.textContent).not.toContain(member.displayName);
    expect(container.querySelector('[name="runnerName"]')).toBeNull();
    expect(button("Manage access")).toBeUndefined();
    expect(button("Check my access")).toBeDefined();
    expect(container.textContent).toContain(runner.name);
  });

  it.each([403, 404])(
    "clears team runner data when personal access read is denied (%s)",
    async (status) => {
      vi.mocked(computeApi.useAccess).mockRejectedValueOnce(
        new ApiRequestError(status, "FORBIDDEN", "Access denied"),
      );
      await open();
      await click("Manage access");
      expect(container.textContent).not.toContain(runner.name);
      expect(container.textContent).not.toContain(member.displayName);
      expect(container.querySelector('[name="runnerName"]')).toBeNull();
    },
  );

  it("clears restricted data and expires the session after a permission write returns 401", async () => {
    vi.mocked(computeApi.setApproval).mockRejectedValueOnce(
      new ApiRequestError(401, "UNAUTHENTICATED", "Expired"),
    );
    await open();
    await click("Manage access");
    await click("Approve dispatch");
    expect(onExpired).toHaveBeenCalledOnce();
    expect(container.textContent).not.toContain(runner.name);
    expect(container.textContent).not.toContain(member.displayName);
  });

  it("aborts loading on close and ignores a delayed roster", async () => {
    let complete!: (value: RunnerGrantsResponse) => void;
    vi.mocked(computeApi.grants).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await open();
    await click("Manage access");
    const signal = vi.mocked(computeApi.grants).mock.calls[0]![3]!;
    await click("Close access");
    expect(signal.aborted).toBe(true);
    await act(() => complete(roster()));
    expect(container.textContent).not.toContain(member.displayName);
    expect(button("Refresh runners")!.disabled).toBe(false);
  });

  it("aborts a pending write on close and keeps revocation blocked until refreshed", async () => {
    let complete!: (value: { runner: Runner; observedAt: string }) => void;
    vi.mocked(computeApi.setGrant).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await open();
    await click("Manage access");
    await click(grantLabel);
    const signal = vi.mocked(computeApi.setGrant).mock.calls[0]![4]!;
    await click("Close access");
    expect(signal.aborted).toBe(true);
    expect(button("Revoke runner")!.disabled).toBe(true);
    await act(() => complete({ runner, observedAt }));
    expect(container.textContent).not.toContain("Permission saved");
    await click("Refresh runners");
    expect(button("Revoke runner")!.disabled).toBe(false);
  });

  it("discards the roster and pending responses when changing teams or roles", async () => {
    await open();
    await click("Manage access");
    expect(container.textContent).toContain(member.displayName);
    await act(() => changeTeam({ ...team, role: "developer" }));
    expect(container.textContent).not.toContain(member.displayName);
    expect(button("Manage access")).toBeUndefined();
    await click("Check my access");
    await act(() =>
      changeTeam({ ...team, id: runner.organizationId, name: "Other team" }),
    );
    expect(container.textContent).not.toContain("Your stored use grant");
    expect(computeApi.list).toHaveBeenLastCalledWith(
      runner.organizationId,
      undefined,
      expect.any(AbortSignal),
    );
  });

  it("ignores a late permission write after changing teams", async () => {
    let complete!: (value: { runner: Runner; observedAt: string }) => void;
    vi.mocked(computeApi.setGrant).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    await open();
    await click("Manage access");
    await click(grantLabel);
    const signal = vi.mocked(computeApi.setGrant).mock.calls[0]![4]!;
    vi.mocked(computeApi.list).mockResolvedValueOnce({
      runners: [],
      observedAt,
      nextCursor: null,
    });
    await act(() =>
      changeTeam({ ...team, id: runner.organizationId, name: "Other team" }),
    );
    expect(signal.aborted).toBe(true);
    await act(() =>
      complete({ runner: { ...runner, dispatchApproved: true }, observedAt }),
    );
    expect(container.textContent).not.toContain(runner.name);
    expect(container.textContent).not.toContain(member.displayName);
    expect(container.textContent).not.toContain("Permission saved");
    expect(container.textContent).toContain("Other team");
  });
});
