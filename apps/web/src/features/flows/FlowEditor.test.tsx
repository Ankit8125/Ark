// @vitest-environment jsdom
import type {
  AgentDefinition,
  Flow,
  FlowDefinition,
  ResourceVersion,
  Team,
  WorkspaceDefinition,
} from "@ark/contracts";
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
import { agentApi } from "../agents/api";
import { workspaceApi } from "../workspaces/api";
import { useDraftNavigation } from "../catalog/useDraftNavigation";
import { FlowRoutes } from "./FlowRoutes";
import { flowApi } from "./api";

const team: Team = {
  id: "ec4f7655-318b-4e08-8915-621a87237d7d",
  name: "Engineering",
  role: "developer",
};
const flowId = "e88484ed-6da1-4b91-8ce8-5bcc02f0d46c";
const workspace = {
  resourceId: "703ded0a-2333-4fe8-a254-8a4b1d1b797e",
  versionId: "d4411b86-1fa6-4ac7-8fdd-1cb724c0b109",
};
const agent = {
  resourceId: "bb4f0c39-105b-4d0b-a39f-c620c164b537",
  versionId: "b575a3f5-6e05-43b4-b486-c54cfe0d392e",
};
const firstStage = "b6073848-7b96-4d7f-99c4-38ac524ba2fc";
const secondStage = "df26d801-1702-41fc-a169-e1207a749427";
const timestamp = "2026-09-28T00:00:00.000Z";
const workspaceDefinition: WorkspaceDefinition = {
  name: "Source workspace",
  description: "",
  repositoryUrl: "https://example.com/team/project",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "node:24",
  workingDirectory: ".",
  actions: { install: "", test: "", lint: "", build: "" },
};
const agentDefinition: AgentDefinition = {
  name: "Reviewer",
  description: "",
  instructions: "Review changes",
  runtime: "stub",
  modelPreference: null,
  capabilities: [],
};
const definition: FlowDefinition = {
  name: "Change review",
  description: "  Multiline description\nPreserve whitespace 🧭  ",
  workspace,
  inputs: [
    { name: "task", type: "text" },
    { name: "context", type: "json" },
  ],
  stages: [
    {
      id: firstStage,
      name: "Plan",
      agent,
      inputs: [
        {
          name: "task",
          type: "text",
          source: { kind: "flow_input", port: "task" },
        },
        {
          name: "context",
          type: "json",
          source: { kind: "flow_input", port: "context" },
        },
      ],
      outputs: [{ name: "plan", type: "json" }],
    },
    {
      id: secondStage,
      name: "Review",
      agent,
      inputs: [
        {
          name: "proposal",
          type: "json",
          source: { kind: "stage_output", stageId: firstStage, port: "plan" },
        },
      ],
      outputs: [{ name: "report", type: "text" }],
    },
  ],
  outputs: [
    {
      name: "result",
      type: "text",
      source: { kind: "stage_output", stageId: secondStage, port: "report" },
    },
  ],
};
function saved(overrides: Partial<Flow> = {}): Flow {
  return {
    id: flowId,
    teamId: team.id,
    name: definition.name,
    revision: 1,
    versionId: "bb42b83e-c60a-43c0-a0ed-8b3860dfb16b",
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    definition: structuredClone(definition),
    ...overrides,
  };
}
function summary(kind: "workspace" | "agent") {
  const reference = kind === "workspace" ? workspace : agent;
  return {
    id: reference.resourceId,
    teamId: team.id,
    name:
      kind === "workspace" ? workspaceDefinition.name : agentDefinition.name,
    revision: 1,
    versionId: reference.versionId,
    schemaVersion: 1,
    updatedAt: timestamp,
  };
}
const onExpired = vi.fn();
let changeTeam: (value: Team) => void;
function Harness() {
  const [currentTeam, setCurrentTeam] = useState(team);
  useEffect(() => {
    changeTeam = setCurrentTeam;
  }, []);
  const { onDraftStatus, prompt } = useDraftNavigation("flow");
  return (
    <>
      <Link to="/sessions">Sessions</Link>
      {prompt}
      <Routes>
        <Route
          path="/flows/*"
          element={
            <FlowRoutes
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

describe("ordered flow editing and pinned versions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(flowApi, "get").mockResolvedValue(saved());
    vi.spyOn(flowApi, "list").mockResolvedValue({
      flows: [],
      nextCursor: null,
    });
    vi.spyOn(workspaceApi, "list").mockResolvedValue({
      workspaces: [summary("workspace")],
      nextCursor: null,
    });
    vi.spyOn(agentApi, "list").mockResolvedValue({
      agents: [summary("agent")],
      nextCursor: null,
    });
    vi.spyOn(flowApi, "version").mockImplementation(
      async (teamId, kind, reference) => ({
        ...reference,
        teamId,
        revision: 1,
        schemaVersion: 1,
        createdAt: timestamp,
        definition:
          kind === "workspace" ? workspaceDefinition : agentDefinition,
      }),
    );
    vi.spyOn(flowApi, "create").mockImplementation(async (_team, input) =>
      saved({
        id: input.id,
        name: input.definition.name,
        definition: input.definition,
      }),
    );
    vi.spyOn(flowApi, "update").mockImplementation(async (_team, id, input) =>
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
  async function open(path = `/flows/${flowId}`) {
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
  function select(name: string) {
    return container.querySelector<HTMLSelectElement>(
      `select[name="${name}"]`,
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
  async function choose(name: string, value: string) {
    await act(() => {
      select(name).value = value;
      select(name).dispatchEvent(new Event("change", { bubbles: true }));
    });
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
    const control = [
      ...container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        "button,a",
      ),
    ].find(
      (item) =>
        item.getAttribute("aria-label") === label ||
        item.textContent?.trim() === label,
    );
    expect(control, `Control ${label} is present`).toBeDefined();
    await act(() => control!.click());
  }

  it("starts clean with one stable stage and leaves without a false unsaved warning", async () => {
    await open("/flows/new");
    expect(container.textContent).toContain("Not saved yet");
    expect(container.textContent).not.toContain("Unsaved changes");
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading);
    expect(unloading.defaultPrevented).toBe(false);
    await click("Sessions");
    expect(router.state.location.pathname).toBe("/sessions");
  });

  it("creates a pinned flow and reloads its complete supported definition", async () => {
    await open("/flows/new");
    await fill("name", "A new flow");
    await fill("description", definition.description);
    await choose("workspace", `${workspace.resourceId}:${workspace.versionId}`);
    await choose("stages.0.agent", `${agent.resourceId}:${agent.versionId}`);
    await submit();
    expect(flowApi.create).toHaveBeenCalledTimes(1);
    const request = vi.mocked(flowApi.create).mock.calls[0]![1];
    expect(request.definition).toMatchObject({
      name: "A new flow",
      description: definition.description,
      workspace,
      stages: [
        {
          name: "Stage 1",
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
      outputs: [{ source: { stageId: request.definition.stages[0]!.id } }],
    });
    expect(router.state.location.pathname).toBe(`/flows/${request.id}`);
    // The detail endpoint remains authoritative after navigation/reload.
    expect(input("description").value).toBe(definition.description);
    expect(select("stages.1.inputs.0.source").value).toBe(
      `stage:${firstStage}:plan`,
    );
    await submit();
    expect(vi.mocked(flowApi.update).mock.calls[0]![2].definition).toEqual(
      definition,
    );
  });

  it("keeps historical pins when newer catalog revisions exist and only changes a pin explicitly", async () => {
    const newerVersion = "f3fe7e8e-7b72-44c6-b1d4-55e82a7ca832";
    vi.mocked(workspaceApi.list).mockResolvedValue({
      workspaces: [
        { ...summary("workspace"), revision: 2, versionId: newerVersion },
      ],
      nextCursor: null,
    });
    await open();
    expect(select("workspace").value).toBe(
      `${workspace.resourceId}:${workspace.versionId}`,
    );
    expect(select("workspace").selectedOptions[0]!.textContent).toContain(
      "Revision 1 (pinned)",
    );
    await fill("description", "Only description changed");
    await submit();
    expect(
      vi.mocked(flowApi.update).mock.calls[0]![2].definition.workspace,
    ).toEqual(workspace);
    await choose("workspace", `${workspace.resourceId}:${newerVersion}`);
    await submit();
    expect(
      vi.mocked(flowApi.update).mock.calls[1]![2].definition.workspace
        .versionId,
    ).toBe(newerVersion);
  });

  it("preserves stable stage references on reorder and rejects now-forward inputs", async () => {
    await open();
    await click("Move stage 2 up");
    expect(input("stages.0.name").value).toBe("Review");
    expect(select("stages.0.inputs.0.source").value).toBe(
      `stage:${firstStage}:plan`,
    );
    await submit();
    expect(flowApi.update).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "Choose an output from an earlier stage.",
    );
    expect(document.activeElement).toBe(select("stages.0.inputs.0.source"));
    await click("Move stage 1 down");
    await submit();
    expect(vi.mocked(flowApi.update).mock.calls[0]![2].definition).toEqual(
      definition,
    );
  });

  it("requires confirmation to remove a stage and keeps dangling references visible", async () => {
    await open();
    await click("Remove stage 1");
    expect(input("stages.0.name").value).toBe("Plan");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Remove stage 1");
    expect(input("stages.0.name").value).toBe("Review");
    expect(
      select("stages.0.inputs.0.source").selectedOptions[0]!.textContent,
    ).toContain("Unavailable source");
    await submit();
    expect(flowApi.update).not.toHaveBeenCalled();
  });

  it("focuses missing version choices and displays server dependency errors without dropping drafts", async () => {
    await open("/flows/new");
    await fill("name", "Needs dependencies");
    await submit();
    expect(document.activeElement).toBe(select("workspace"));
    expect(flowApi.create).not.toHaveBeenCalled();
    await choose("workspace", `${workspace.resourceId}:${workspace.versionId}`);
    await choose("stages.0.agent", `${agent.resourceId}:${agent.versionId}`);
    vi.mocked(flowApi.create).mockRejectedValueOnce(
      new ApiRequestError(
        400,
        "INVALID_DEPENDENCY",
        "Choose an available dependency.",
        { "definition.stages.0.agent": ["This version is unavailable."] },
      ),
    );
    await submit();
    expect(input("name").value).toBe("Needs dependencies");
    expect(document.activeElement).toBe(select("stages.0.agent"));
    expect(select("stages.0.agent").getAttribute("aria-invalid")).toBe("true");
  });

  it("validates port types and retains renamed sources until explicitly repaired", async () => {
    await open();
    await choose("inputs.0.type", "json");
    await submit();
    expect(flowApi.update).not.toHaveBeenCalled();
    expect(container.textContent).toContain(
      "The type must match the selected source port.",
    );
    await choose("inputs.0.type", "text");
    await fill("stages.0.outputs.0.name", "renamed_plan");
    await submit();
    expect(container.textContent).toContain(
      "The selected source port does not exist.",
    );
    expect(select("stages.1.inputs.0.source").value).toBe(
      `stage:${firstStage}:plan`,
    );
    await choose(
      "stages.1.inputs.0.source",
      `stage:${firstStage}:renamed_plan`,
    );
    await submit();
    expect(
      vi.mocked(flowApi.update).mock.calls[0]![2].definition.stages[1]!
        .inputs[0]!.source,
    ).toEqual({
      kind: "stage_output",
      stageId: firstStage,
      port: "renamed_plan",
    });
  });

  it("loads additional dependency choices without replacing selected pins and retries list failures", async () => {
    const next = {
      ...summary("workspace"),
      id: "c662c1ec-407d-4a09-8193-a75f552f5630",
      name: "Next page workspace",
    };
    vi.mocked(workspaceApi.list)
      .mockResolvedValueOnce({
        workspaces: [summary("workspace")],
        nextCursor: workspace.resourceId,
      })
      .mockRejectedValueOnce(
        new ApiRequestError(0, "OFFLINE", "Cannot reach Ark."),
      )
      .mockResolvedValueOnce({ workspaces: [next], nextCursor: null });
    await open();
    await click("Load more workspaces");
    expect(select("workspace").value).toBe(
      `${workspace.resourceId}:${workspace.versionId}`,
    );
    await click("Retry more workspaces");
    expect(vi.mocked(workspaceApi.list).mock.calls[2]?.slice(0, 2)).toEqual([
      team.id,
      workspace.resourceId,
    ]);
    expect(
      [...select("workspace").options].some((option) =>
        option.textContent?.includes(next.name),
      ),
    ).toBe(true);
  });

  it("retains every field on offline save and requires explicit conflict recovery", async () => {
    vi.mocked(flowApi.update)
      .mockRejectedValueOnce(
        new ApiRequestError(0, "OFFLINE", "Cannot reach Ark."),
      )
      .mockRejectedValueOnce(
        new ApiRequestError(409, "REVISION_CONFLICT", "This flow has changed."),
      );
    await open();
    await fill("description", "Keep this draft");
    await submit();
    expect(input("description").value).toBe("Keep this draft");
    expect(flowApi.update).toHaveBeenCalledTimes(1);
    await submit();
    await click("Load latest");
    expect(flowApi.get).toHaveBeenCalledTimes(1);
    expect(select("outputs.0.source").value).toBe(
      `stage:${secondStage}:report`,
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Load latest");
    expect(input("description").value).toBe(definition.description);
  });

  it("keeps a pin when its historical metadata read fails and retries without rewriting it", async () => {
    vi.mocked(flowApi.version).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Cannot read this version."),
    );
    await open();
    expect(container.textContent).toContain("The selected version is kept.");
    await click("Retry workspace version");
    expect(select("workspace").value).toBe(
      `${workspace.resourceId}:${workspace.versionId}`,
    );
    await submit();
    expect(vi.mocked(flowApi.update).mock.calls[0]![2].definition).toEqual(
      definition,
    );
  });

  it("prevents delayed metadata for an old selection from replacing the new version label", async () => {
    let resolveOld!: (value: ResourceVersion) => void;
    const newerVersion = "f3fe7e8e-7b72-44c6-b1d4-55e82a7ca832";
    vi.mocked(workspaceApi.list).mockResolvedValue({
      workspaces: [
        { ...summary("workspace"), revision: 2, versionId: newerVersion },
      ],
      nextCursor: null,
    });
    vi.mocked(flowApi.version).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await open();
    await choose("workspace", `${workspace.resourceId}:${newerVersion}`);
    await act(() =>
      resolveOld({
        ...workspace,
        teamId: team.id,
        revision: 1,
        schemaVersion: 1,
        createdAt: timestamp,
        definition: { ...workspaceDefinition, name: "Stale label" },
      }),
    );
    expect(container.textContent).not.toContain("Stale label");
    expect(select("workspace").value).toBe(
      `${workspace.resourceId}:${newerVersion}`,
    );
  });

  it("keeps dirty flow values and disables all mutations after role downgrade", async () => {
    await open();
    await fill("description", "Unsaved flow draft");
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(input("description").value).toBe("Unsaved flow draft");
    expect(input("description").readOnly).toBe(true);
    expect(select("workspace").disabled).toBe(true);
    expect(select("stages.0.inputs.0.source").disabled).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    expect(container.textContent).not.toContain("Add stage");
    await submit();
    expect(flowApi.update).not.toHaveBeenCalled();
  });

  it.each([
    [2, { customField: "Preserve this future flow" }],
    [1, { ...definition, customField: "Preserve this future flow" }],
  ])(
    "renders unsupported schema %s read-only",
    async (schemaVersion, value) => {
      vi.mocked(flowApi.get).mockResolvedValueOnce(
        saved({ schemaVersion, definition: value }),
      );
      await open();
      expect(container.querySelector("form")).toBeNull();
      expect(container.querySelector("pre")?.textContent).toContain(
        "Preserve this future flow",
      );
    },
  );

  it("protects flow drafts during soft navigation and hard reload", async () => {
    await open();
    await fill("description", "Unsaved flow draft");
    const unloading = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unloading);
    expect(unloading.defaultPrevented).toBe(true);
    await click("Sessions");
    expect(container.textContent).toContain("Leave this flow?");
    await click("Stay here");
    expect(input("description").value).toBe("Unsaved flow draft");
    await click("Sessions");
    await click("Discard and leave");
    expect(router.state.location.pathname).toBe("/sessions");
  });

  it("lists flows and appends later pages", async () => {
    const second = saved({
      id: "894ff754-0af7-4ee6-bc9f-a4c7d658dc8f",
      name: "Second flow",
    });
    vi.mocked(flowApi.list)
      .mockResolvedValueOnce({ flows: [saved()], nextCursor: flowId })
      .mockResolvedValueOnce({ flows: [second], nextCursor: null });
    await open("/flows");
    await click("Load more");
    expect(
      container.querySelector(`a[href="/flows/${flowId}"]`),
    ).not.toBeNull();
    expect(
      container.querySelector(`a[href="/flows/${second.id}"]`),
    ).not.toBeNull();
    expect(container.textContent).toContain("2 loaded");
  });
});
