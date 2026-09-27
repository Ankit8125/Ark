// @vitest-environment jsdom
import type { Agent, AgentDefinition, Team } from "@ark/contracts";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  Link,
  Route,
  RouterProvider,
  Routes,
} from "react-router-dom";
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
import { useDraftNavigation } from "../catalog/useDraftNavigation";
import { AgentRoutes } from "./AgentRoutes";
import { agentApi } from "./api";

const team: Team = {
  id: "ec4f7655-318b-4e08-8915-621a87237d7d",
  name: "Engineering",
  role: "developer",
};
const agentId = "e88484ed-6da1-4b91-8ce8-5bcc02f0d46c";
const definition: AgentDefinition = {
  name: "Code reviewer",
  description: "Review changes with context. 🧭",
  instructions:
    "  Read the changes.\nReport findings with concrete examples.\n ",
  runtime: "stub",
  modelPreference: "example/model-v1",
  capabilities: ["read_files", "edit_files", "run_commands"],
};
function saved(overrides: Partial<Agent> = {}): Agent {
  return {
    id: agentId,
    teamId: team.id,
    name: definition.name,
    revision: 1,
    versionId: "bb42b83e-c60a-43c0-a0ed-8b3860dfb16b",
    schemaVersion: 1,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    definition: structuredClone(definition),
    ...overrides,
  };
}
const onExpired = vi.fn();
let changeTeam: (value: Team) => void;
function Harness() {
  const [currentTeam, setCurrentTeam] = useState(team);
  useEffect(() => {
    changeTeam = setCurrentTeam;
  }, []);
  const { onDraftStatus, prompt } = useDraftNavigation("agent");
  return (
    <>
      <Link to="/sessions">Sessions</Link>
      {prompt}
      <Routes>
        <Route
          path="/agents/*"
          element={
            <AgentRoutes
              team={currentTeam}
              onExpired={onExpired}
              onDraftStatus={onDraftStatus}
            />
          }
        />
        <Route path="/sessions" element={<h1>Sessions</h1>} />
      </Routes>
    </>
  );
}
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

describe("agent catalog form and recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(agentApi, "get").mockResolvedValue(saved());
    vi.spyOn(agentApi, "list").mockResolvedValue({
      agents: [],
      nextCursor: null,
    });
    vi.spyOn(agentApi, "create").mockImplementation(async (_team, input) =>
      saved({
        id: input.id,
        name: input.definition.name,
        definition: input.definition,
      }),
    );
    vi.spyOn(agentApi, "update").mockImplementation(async (_team, id, input) =>
      saved({
        id,
        name: input.definition.name,
        revision: input.revision + 1,
        definition: input.definition,
      }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    });
    onExpired.mockClear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    router?.dispose();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function open(path = `/agents/${agentId}`) {
    router = createMemoryRouter([{ path: "*", element: <Harness /> }], {
      initialEntries: [path],
    });
    await act(() => root.render(<RouterProvider router={router} />));
  }
  function input(name: string) {
    return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name="${name}"]`,
    )!;
  }
  async function fill(name: string, value: string) {
    const control = input(name);
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    await act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        control,
        value,
      );
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  function checkbox(value: string) {
    return container.querySelector<HTMLInputElement>(
      `input[type="checkbox"][value="${value}"]`,
    )!;
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
  async function click(label: string) {
    const button = [
      ...container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        "button,a",
      ),
    ].find((item) => item.textContent === label);
    expect(button, `Control ${label} is present`).toBeDefined();
    await act(() => button!.click());
  }

  it("creates with no requested capabilities or model by default and preserves instruction whitespace", async () => {
    await open("/agents/new");
    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>(
          'input[type="checkbox"]',
        ),
      ].every((control) => !control.checked),
    ).toBe(true);
    expect(input("modelPreference").value).toBe("");
    await fill("name", "New reviewer");
    await fill("description", definition.description);
    await fill("instructions", definition.instructions);
    await submit();
    expect(agentApi.create).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(agentApi.create).mock.calls[0]![1];
    expect(submitted.definition).toEqual({
      ...definition,
      name: "New reviewer",
      modelPreference: null,
      capabilities: [],
    });
    expect(router.state.location.pathname).toBe(`/agents/${submitted.id}`);
  });

  it("retains every supported field after a failed save and only retries explicitly", async () => {
    vi.mocked(agentApi.update).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Cannot reach Ark."),
    );
    await open();
    expect(input("instructions").value).toBe(definition.instructions);
    expect(input("modelPreference").value).toBe(definition.modelPreference);
    await fill(
      "instructions",
      "  Preserve this draft.\nInclude exact evidence.  ",
    );
    await act(() => checkbox("edit_files").click());
    await submit();
    expect(container.textContent).toContain("Cannot reach Ark.");
    expect(input("instructions").value).toBe(
      "  Preserve this draft.\nInclude exact evidence.  ",
    );
    expect(checkbox("read_files").checked).toBe(true);
    expect(checkbox("edit_files").checked).toBe(false);
    expect(checkbox("run_commands").checked).toBe(true);
    expect(agentApi.update).toHaveBeenCalledTimes(1);
    await submit();
    expect(vi.mocked(agentApi.update).mock.calls[1]![2]).toEqual({
      revision: 1,
      schemaVersion: 1,
      definition: {
        ...definition,
        instructions: "  Preserve this draft.\nInclude exact evidence.  ",
        capabilities: ["read_files", "run_commands"],
      },
    });
    expect(container.textContent).toContain("Saved revision 2.");
  });

  it("clears an existing model preference to null and saves an empty capability set", async () => {
    await open();
    await fill("modelPreference", "");
    for (const capability of definition.capabilities)
      await act(() => checkbox(capability).click());
    await submit();
    expect(vi.mocked(agentApi.update).mock.calls[0]![2].definition).toEqual({
      ...definition,
      modelPreference: null,
      capabilities: [],
    });
  });

  it("validates required instructions and focuses the first invalid field", async () => {
    await open("/agents/new");
    await fill("name", "Needs instructions");
    await fill("instructions", "   \n ");
    await submit();
    expect(agentApi.create).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input("instructions"));
    expect(input("instructions").getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Enter agent instructions.");
  });

  it("keeps a conflicted draft until loading latest is explicitly confirmed", async () => {
    vi.mocked(agentApi.update).mockRejectedValueOnce(
      new ApiRequestError(409, "REVISION_CONFLICT", "This agent has changed."),
    );
    await open();
    await fill("instructions", "Unsaved agent instructions");
    await submit();
    await click("Load latest");
    expect(agentApi.get).toHaveBeenCalledTimes(1);
    expect(input("instructions").value).toBe("Unsaved agent instructions");
    vi.mocked(window.confirm).mockReturnValue(true);
    vi.mocked(agentApi.get).mockResolvedValueOnce(
      saved({
        revision: 3,
        definition: { ...definition, instructions: "Saved by another editor" },
      }),
    );
    await click("Load latest");
    expect(input("instructions").value).toBe("Saved by another editor");
    expect(container.textContent).toContain("Revision 3");
  });

  it.each([
    [2, { runtime: "future", customField: "Preserve me" }],
    [1, { ...definition, customField: "Preserve me" }],
  ])(
    "shows unsupported schema %s unchanged and read-only",
    async (schemaVersion, value) => {
      vi.mocked(agentApi.get).mockResolvedValueOnce(
        saved({ schemaVersion, definition: value }),
      );
      await open();
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector("pre")?.textContent).toContain(
        "Preserve me",
      );
      expect(agentApi.update).not.toHaveBeenCalled();
    },
  );

  it("keeps the draft but disables text, runtime, and capabilities after role downgrade", async () => {
    await open();
    await fill("instructions", "A draft worth preserving");
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(input("instructions").value).toBe("A draft worth preserving");
    expect(input("instructions").readOnly).toBe(true);
    expect(
      container.querySelector<HTMLSelectElement>('[name="runtime"]')?.disabled,
    ).toBe(true);
    expect(checkbox("read_files").matches(":disabled")).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    await submit();
    expect(agentApi.update).not.toHaveBeenCalled();
  });

  it("warns about the agent draft before navigation and hard reload", async () => {
    await open();
    await fill("instructions", "Unsaved agent draft");
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading);
    expect(unloading.defaultPrevented).toBe(true);
    await click("Sessions");
    expect(container.textContent).toContain("Leave this agent?");
    expect(router.state.location.pathname).toBe(`/agents/${agentId}`);
    await click("Stay here");
    expect(input("instructions").value).toBe("Unsaved agent draft");
    await click("Sessions");
    await click("Discard and leave");
    expect(router.state.location.pathname).toBe("/sessions");
  });

  it("ignores the old team's delayed read after switching teams", async () => {
    let resolveOld!: (value: Agent) => void;
    vi.mocked(agentApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await open();
    const otherTeam = {
      ...team,
      id: "0b22c0c5-8850-421f-8569-01b15e664024",
      name: "Other team",
    };
    vi.mocked(agentApi.get).mockResolvedValueOnce(
      saved({
        teamId: otherTeam.id,
        definition: {
          ...definition,
          instructions: "Other team's instructions",
        },
      }),
    );
    await act(() => changeTeam(otherTeam));
    await act(() => resolveOld(saved()));
    expect(input("instructions").value).toBe("Other team's instructions");
  });

  it("lists summaries and loads the next cursor without dropping earlier rows", async () => {
    const first = saved();
    const second = saved({
      id: "f9fe8a3b-7714-476c-a275-a0e69d458a61",
      name: "Second agent",
    });
    vi.mocked(agentApi.list)
      .mockResolvedValueOnce({ agents: [first], nextCursor: first.id })
      .mockResolvedValueOnce({ agents: [second], nextCursor: null });
    await open("/agents");
    expect(
      container.querySelector(`a[href="/agents/${first.id}"]`),
    ).not.toBeNull();
    await click("Load more");
    expect(vi.mocked(agentApi.list).mock.calls[1]?.slice(0, 2)).toEqual([
      team.id,
      first.id,
    ]);
    expect(
      container.querySelector(`a[href="/agents/${first.id}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`a[href="/agents/${second.id}"]`),
    ).not.toBeNull();
    expect(container.textContent).toContain("2 loaded");
    expect(container.textContent).not.toContain("Load more");
  });
});
