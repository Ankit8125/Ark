// @vitest-environment jsdom
import {
  FlowDefinitionSchema,
  type AgentTemplate,
  type CatalogTemplateKind,
  type CatalogTemplateListResponse,
  type FlowTemplate,
  type Team,
  type Workspace,
  type WorkspaceTemplate,
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
import { ApiRequestError } from "../../api";
import { AgentEditor } from "../agents/AgentEditor";
import { agentApi } from "../agents/api";
import { FlowEditor } from "../flows/FlowEditor";
import { flowApi } from "../flows/api";
import { WorkspaceEditor } from "../workspaces/WorkspaceEditor";
import { workspaceApi } from "../workspaces/api";
import { templateApi } from "./template-api";
import {
  agentFromTemplate,
  flowFromTemplate,
  workspaceFromTemplate,
} from "./template-drafts";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "developer",
};
const id = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const versionId = "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60";
const timestamp = "2026-10-05T00:00:00.000Z";
const metadata = {
  templateVersion: 1,
  schemaVersion: 1 as const,
  description: "An editable example.",
};
const workspaceTemplate: WorkspaceTemplate = {
  ...metadata,
  id: "node-pnpm",
  kind: "workspace",
  title: "Node.js with pnpm",
  definition: {
    name: "Node workspace",
    description: "Review commands",
    sourceRef: "main",
    defaultBranch: "main",
    sandboxImage: "node:24",
    workingDirectory: ".",
    actions: {
      install: "pnpm install",
      test: "pnpm test",
      lint: "pnpm lint",
      build: "pnpm build",
    },
  },
};
const agentTemplate: AgentTemplate = {
  ...metadata,
  id: "implementation",
  kind: "agent",
  title: "Implementation agent",
  definition: {
    name: "Implementation agent",
    description: "Scoped changes",
    instructions: "Inspect the code. Report actual checks.",
    runtime: "stub",
    modelPreference: null,
    capabilities: ["read_files", "edit_files"],
  },
};
const flowTemplate: FlowTemplate = {
  ...metadata,
  id: "implementation-review",
  kind: "flow",
  title: "Implementation and review",
  definition: {
    name: "Implementation and review",
    description: "One ordered example",
    inputs: [{ name: "task", type: "text" }],
    stages: [
      {
        id,
        name: "Implement",
        inputs: [
          {
            name: "task",
            type: "text",
            source: { kind: "flow_input", port: "task" },
          },
        ],
        outputs: [{ name: "proposal", type: "text" }],
      },
      {
        id: versionId,
        name: "Review",
        inputs: [
          {
            name: "task",
            type: "text",
            source: { kind: "flow_input", port: "task" },
          },
          {
            name: "proposal",
            type: "text",
            source: { kind: "stage_output", stageId: id, port: "proposal" },
          },
        ],
        outputs: [{ name: "report", type: "text" }],
      },
    ],
    outputs: [
      {
        name: "result",
        type: "text",
        source: { kind: "stage_output", stageId: versionId, port: "report" },
      },
    ],
  },
};
const templates = {
  workspace: workspaceTemplate,
  agent: agentTemplate,
  flow: flowTemplate,
};
const reference = { resourceId: id, versionId };
function savedWorkspace(): Workspace {
  return {
    id,
    teamId: team.id,
    name: "Saved workspace",
    versionId,
    revision: 1,
    lifecycleRevision: 1,
    archivedAt: null,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    definition: {
      ...workspaceFromTemplate(workspaceTemplate),
      name: "Saved workspace",
      repositoryUrl: "https://example.com/team/project",
    },
  };
}

describe("template drafts", () => {
  it("makes independent Workspace and Agent copies with no repository choice", () => {
    const workspace = workspaceFromTemplate(workspaceTemplate);
    expect(workspace.repositoryUrl).toBe("");
    workspace.actions.test = "changed";
    expect(workspaceFromTemplate(workspaceTemplate).actions.test).toBe(
      "pnpm test",
    );
    const agent = agentFromTemplate(agentTemplate);
    expect(agent.runtime).toBe("stub");
    expect(agent.modelPreference).toBeNull();
    agent.capabilities.pop();
    expect(agentFromTemplate(agentTemplate).capabilities).toHaveLength(2);
  });

  it("gives every Flow copy fresh stage IDs and remaps intermediate and final references", () => {
    const first = flowFromTemplate(flowTemplate);
    const second = flowFromTemplate(flowTemplate);
    expect(
      new Set([...first.stages, ...second.stages].map((stage) => stage.id))
        .size,
    ).toBe(4);
    expect(first.stages.map((stage) => stage.id)).not.toContain(id);
    expect(first.stages.map((stage) => stage.id)).not.toContain(versionId);
    expect(first.workspace).toEqual({ resourceId: "", versionId: "" });
    expect(
      first.stages.every(
        (stage) =>
          stage.agent.resourceId === "" && stage.agent.versionId === "",
      ),
    ).toBe(true);
    expect(first.stages[1]!.inputs[1]!.source).toEqual({
      kind: "stage_output",
      stageId: first.stages[0]!.id,
      port: "proposal",
    });
    expect(first.outputs[0]!.source.stageId).toBe(first.stages[1]!.id);
    expect(first.stages[1]!.inputs[0]!.source).toEqual({
      kind: "flow_input",
      port: "task",
    });
    expect(FlowDefinitionSchema.safeParse(first).success).toBe(false);
    expect(
      FlowDefinitionSchema.safeParse({
        ...first,
        workspace: reference,
        stages: first.stages.map((stage) => ({ ...stage, agent: reference })),
      }).success,
    ).toBe(true);
    first.stages[0]!.outputs[0]!.name = "changed";
    expect(second.stages[0]!.outputs[0]!.name).toBe("proposal");
    expect(flowTemplate.definition.stages[0]!.outputs[0]!.name).toBe(
      "proposal",
    );
  });
});

describe("template API adapter", () => {
  afterEach(() => vi.unstubAllGlobals());
  it.each(["workspace", "agent", "flow"] as const)(
    "reads %s templates with the current team and abort signal",
    async (kind) => {
      const value = { templates: [templates[kind]] };
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(value)));
      vi.stubGlobal("fetch", fetch);
      const controller = new AbortController();
      expect(await templateApi.list(team.id, kind, controller.signal)).toEqual(
        value,
      );
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/teams/${team.id}/templates/${kind}`,
        expect.objectContaining({
          credentials: "same-origin",
          signal: controller.signal,
        }),
      );
    },
  );
  it.each([
    { templates: [agentTemplate] },
    { templates: [{ ...workspaceTemplate, schemaVersion: 2 }] },
    {
      templates: [
        {
          ...workspaceTemplate,
          definition: {
            ...workspaceTemplate.definition,
            repositoryUrl: "https://example.com",
          },
        },
      ],
    },
    { templates: [workspaceTemplate, workspaceTemplate] },
  ])("rejects malformed or wrong-kind responses", async (value) => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify(value))),
    );
    await expect(templateApi.list(team.id, "workspace")).rejects.toMatchObject({
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

describe("template editor interactions", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  let changeTeam: (team: Team) => void;
  let changeStatusCallback: (callback: typeof onDraftStatus) => void;
  let changeExpiryCallback: (callback: typeof onExpired) => void;
  let changeResource: (resourceId: string | undefined) => void;
  const onExpired = vi.fn();
  const onDraftStatus = vi.fn();
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(templateApi, "list").mockImplementation(async (_team, kind) => ({
      templates: [structuredClone(templates[kind])],
    }));
    vi.spyOn(workspaceApi, "get").mockResolvedValue(savedWorkspace());
    vi.spyOn(workspaceApi, "list").mockResolvedValue({
      workspaces: [],
      nextCursor: null,
    });
    vi.spyOn(agentApi, "list").mockResolvedValue({
      agents: [],
      nextCursor: null,
    });
    vi.spyOn(window, "confirm").mockReturnValue(false);
    onExpired.mockClear();
    onDraftStatus.mockClear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    router?.dispose();
    container.remove();
    vi.restoreAllMocks();
  });
  async function open(
    kind: CatalogTemplateKind = "workspace",
    saved = false,
    initialTeam = team,
  ) {
    function Harness() {
      const [currentTeam, setTeam] = useState(initialTeam);
      const [resourceId, setResourceId] = useState(saved ? id : undefined);
      const [statusCallback, setStatusCallback] = useState(() => onDraftStatus);
      const [expiryCallback, setExpiryCallback] = useState(() => onExpired);
      useEffect(() => {
        changeTeam = setTeam;
        changeResource = setResourceId;
        changeStatusCallback = (callback) => setStatusCallback(() => callback);
        changeExpiryCallback = (callback) => setExpiryCallback(() => callback);
      }, []);
      const props = {
        team: currentTeam,
        onExpired: expiryCallback,
        onDraftStatus: statusCallback,
      };
      return kind === "workspace" ? (
        <WorkspaceEditor {...props} workspaceId={resourceId} />
      ) : kind === "agent" ? (
        <AgentEditor {...props} agentId={resourceId} />
      ) : (
        <FlowEditor {...props} flowId={resourceId} />
      );
    }
    router = createMemoryRouter([{ path: "*", element: <Harness /> }]);
    await act(() => root.render(<RouterProvider router={router} />));
  }
  function input(name: string) {
    return container.querySelector<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >(`[name="${name}"]`)!;
  }
  async function fill(name: string, value: string) {
    const control = input(name);
    const prototype =
      control instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : control instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : HTMLInputElement.prototype;
    await act(() => {
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        control,
        value,
      );
      control.dispatchEvent(
        new Event(control instanceof HTMLSelectElement ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  function button(label: string) {
    return [...container.querySelectorAll("button")].find(
      (item) => item.textContent === label,
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

  it("loads on request without replacing the dirty draft; cancellation keeps edits", async () => {
    await open();
    expect(templateApi.list).not.toHaveBeenCalled();
    await fill("name", "Manual draft");
    await fill("repositoryUrl", "https://example.com/manual");
    await click("Browse templates");
    expect(input("name").value).toBe("Manual draft");
    await click("Use Node.js with pnpm template");
    expect(window.confirm).toHaveBeenCalledOnce();
    expect(input("name").value).toBe("Manual draft");
    expect(input("repositoryUrl").value).toBe("https://example.com/manual");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Use Node.js with pnpm template");
    expect(input("name").value).toBe(workspaceTemplate.definition.name);
    expect(input("repositoryUrl").value).toBe("");
    expect(input("actions.test").value).toBe("pnpm test");
    expect(container.textContent).toContain("Template copied to your draft");
  });

  it("requires the repository and preserves the creation ID after a lost create response and template replacement", async () => {
    const create = vi
      .spyOn(workspaceApi, "create")
      .mockRejectedValue(new ApiRequestError(0, "OFFLINE", "Offline"));
    await open();
    await click("Browse templates");
    await click("Use Node.js with pnpm template");
    await submit();
    expect(create).not.toHaveBeenCalled();
    await fill("repositoryUrl", "https://example.com/first");
    await submit();
    const originalId = create.mock.calls[0]![1].id;
    expect(container.textContent).toContain("Offline");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Use Node.js with pnpm template");
    await fill("repositoryUrl", "https://example.com/second");
    create.mockRejectedValueOnce(
      new ApiRequestError(409, "ID_CONFLICT", "This ID was already saved"),
    );
    await submit();
    expect(create.mock.calls[1]![1].id).toBe(originalId);
    expect(button("Load saved workspace")).toBeDefined();
    expect(button("Keep draft as new")).toBeDefined();
    expect(button("Use Node.js with pnpm template")!.disabled).toBe(true);
    expect(input("repositoryUrl").value).toBe("https://example.com/second");
  });

  it("copies an Agent and saves it through ordinary create without template metadata", async () => {
    const create = vi
      .spyOn(agentApi, "create")
      .mockImplementation(async (_team, request) => ({
        ...savedWorkspace(),
        id: request.id,
        name: request.definition.name,
        definition: request.definition,
      }));
    await open("agent");
    await click("Browse templates");
    await click("Use Implementation agent template");
    expect(window.confirm).not.toHaveBeenCalled();
    expect(input("instructions").value).toBe(
      agentTemplate.definition.instructions,
    );
    expect(input("runtime").value).toBe("stub");
    await fill("name", "My agent copy");
    await submit();
    expect(create).toHaveBeenCalledOnce();
    const request = create.mock.calls[0]![1];
    expect(Object.keys(request).sort()).toEqual([
      "definition",
      "id",
      "schemaVersion",
    ]);
    expect(request.definition).toEqual({
      ...agentTemplate.definition,
      name: "My agent copy",
    });
    expect(container.textContent).toContain("Saved revision 1.");
    expect(button("Browse templates")).toBeUndefined();
  });

  it("copies a Flow with blank pins and retains valid remapped bindings when explicitly selecting dependencies", async () => {
    const summary = {
      id,
      teamId: team.id,
      versionId,
      revision: 1,
      schemaVersion: 1,
      lifecycleRevision: 1,
      archivedAt: null,
      updatedAt: timestamp,
      name: "Available dependency",
    };
    vi.mocked(workspaceApi.list).mockResolvedValue({
      workspaces: [summary],
      nextCursor: null,
    });
    vi.mocked(agentApi.list).mockResolvedValue({
      agents: [summary],
      nextCursor: null,
    });
    vi.spyOn(flowApi, "version").mockImplementation(async (_team, kind) => ({
      resourceId: id,
      teamId: team.id,
      versionId,
      revision: 1,
      schemaVersion: 1,
      createdAt: timestamp,
      definition:
        kind === "workspace"
          ? savedWorkspace().definition
          : agentTemplate.definition,
    }));
    const create = vi
      .spyOn(flowApi, "create")
      .mockImplementation(async (_team, request) => ({
        ...savedWorkspace(),
        id: request.id,
        name: request.definition.name,
        definition: request.definition,
      }));
    await open("flow");
    await click("Browse templates");
    await click("Use Implementation and review template");
    expect(input("workspace").value).toBe("");
    expect(input("stages.0.agent").value).toBe("");
    expect(input("stages.1.agent").value).toBe("");
    await submit();
    expect(create).not.toHaveBeenCalled();
    for (const name of ["workspace", "stages.0.agent", "stages.1.agent"])
      await fill(name, `${id}:${versionId}`);
    await submit();
    expect(create).toHaveBeenCalledOnce();
    const definition = create.mock.calls[0]![1].definition;
    expect(FlowDefinitionSchema.safeParse(definition).success).toBe(true);
    expect(definition.stages[0]!.id).not.toBe(
      flowTemplate.definition.stages[0]!.id,
    );
    expect(definition.stages[1]!.inputs[1]!.source).toMatchObject({
      stageId: definition.stages[0]!.id,
    });
    expect(definition.outputs[0]!.source.stageId).toBe(
      definition.stages[1]!.id,
    );
  });

  it.each([0, 403])(
    "keeps the draft after a template read error (%s) and allows retry",
    async (status) => {
      vi.mocked(templateApi.list).mockRejectedValueOnce(
        new ApiRequestError(status, "FAILED", "Template read failed"),
      );
      await open();
      await fill("name", "Retain this draft");
      await click("Browse templates");
      expect(container.textContent).toContain("Template read failed");
      expect(input("name").value).toBe("Retain this draft");
      await click("Retry templates");
      expect(button("Use Node.js with pnpm template")).toBeDefined();
      expect(input("name").value).toBe("Retain this draft");
    },
  );

  it("reports expired authentication without replacing the draft", async () => {
    vi.mocked(templateApi.list).mockRejectedValueOnce(
      new ApiRequestError(401, "UNAUTHENTICATED", "Expired"),
    );
    await open();
    await fill("name", "Retain this draft");
    await click("Browse templates");
    expect(onExpired).toHaveBeenCalledOnce();
    expect(input("name").value).toBe("Retain this draft");
  });

  it("blocks save while loading and ignores late template responses after a team switch", async () => {
    let resolve!: (value: CatalogTemplateListResponse) => void;
    vi.mocked(templateApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open();
    await fill("name", "First team draft");
    await click("Browse templates");
    const signal = vi.mocked(templateApi.list).mock.calls[0]![2]!;
    expect(button("Create workspace")!.disabled).toBe(true);
    expect(onDraftStatus).toHaveBeenLastCalledWith({ dirty: true, busy: true });
    const nextTeam = {
      ...team,
      id: "537bcb18-d56c-471b-bc59-2f38866049a7",
      name: "Second team",
    };
    await act(() => changeTeam(nextTeam));
    expect(signal.aborted).toBe(true);
    await act(() => resolve({ templates: [workspaceTemplate] }));
    expect(input("name").value).toBe("");
    expect(button("Use Node.js with pnpm template")).toBeUndefined();
    expect(button("Browse templates")!.disabled).toBe(false);
    await click("Browse templates");
    expect(vi.mocked(templateApi.list).mock.calls[1]![0]).toBe(nextTeam.id);
  });

  it("aborts a template request when the editor unmounts", async () => {
    vi.mocked(templateApi.list).mockImplementationOnce(
      () => new Promise(() => undefined),
    );
    await open();
    await click("Browse templates");
    const signal = vi.mocked(templateApi.list).mock.calls[0]![2]!;
    await act(() => root.render(<p>Closed</p>));
    expect(signal.aborted).toBe(true);
  });

  it("keeps a template read recoverable when the draft-status callback changes", async () => {
    let resolve!: (value: CatalogTemplateListResponse) => void;
    vi.mocked(templateApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open();
    await fill("name", "Keep my draft");
    await click("Browse templates");
    const signal = vi.mocked(templateApi.list).mock.calls[0]![2]!;
    const nextStatus = vi.fn();
    await act(() => changeStatusCallback(nextStatus));
    expect(signal.aborted).toBe(false);
    expect(nextStatus).toHaveBeenLastCalledWith({ dirty: true, busy: true });
    await act(() => resolve({ templates: [workspaceTemplate] }));
    expect(input("name").value).toBe("Keep my draft");
    expect(button("Use Node.js with pnpm template")!.disabled).toBe(false);
    expect(nextStatus).toHaveBeenLastCalledWith({ dirty: true, busy: false });
  });

  it("ignores a late template response after opening a saved resource", async () => {
    let resolve!: (value: CatalogTemplateListResponse) => void;
    vi.mocked(templateApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open();
    await click("Browse templates");
    const signal = vi.mocked(templateApi.list).mock.calls[0]![2]!;
    await act(() => changeResource(id));
    expect(signal.aborted).toBe(true);
    await act(() => resolve({ templates: [workspaceTemplate] }));
    expect(input("name").value).toBe("Saved workspace");
    expect(button("Use Node.js with pnpm template")).toBeUndefined();
    expect(button("Browse templates")).toBeUndefined();
  });

  it("clears previous-team dependency choices while loading a new Flow team's catalog", async () => {
    const summary = {
      id,
      teamId: team.id,
      versionId,
      revision: 1,
      schemaVersion: 1,
      lifecycleRevision: 1,
      archivedAt: null,
      updatedAt: timestamp,
      name: "First team dependency",
    };
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({
      workspaces: [summary],
      nextCursor: null,
    });
    vi.mocked(agentApi.list).mockResolvedValueOnce({
      agents: [summary],
      nextCursor: null,
    });
    let resolveWorkspaces!: (
      value: Awaited<ReturnType<typeof workspaceApi.list>>,
    ) => void;
    let resolveAgents!: (
      value: Awaited<ReturnType<typeof agentApi.list>>,
    ) => void;
    vi.mocked(workspaceApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolveWorkspaces = value;
        }),
    );
    vi.mocked(agentApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolveAgents = value;
        }),
    );
    await open("flow");
    expect(input("workspace").textContent).toContain("First team dependency");
    expect(input("stages.0.agent").textContent).toContain(
      "First team dependency",
    );
    const nextTeam = {
      ...team,
      id: "537bcb18-d56c-471b-bc59-2f38866049a7",
      name: "Second team",
    };
    await act(() => changeTeam(nextTeam));
    expect(input("workspace").textContent).not.toContain(
      "First team dependency",
    );
    expect(input("stages.0.agent").textContent).not.toContain(
      "First team dependency",
    );
    expect(container.textContent).toContain("Loading workspace choices");
    expect(container.textContent).toContain("Loading agent choices");
    const nextSummary = {
      ...summary,
      teamId: nextTeam.id,
      name: "Second team dependency",
    };
    await act(() => {
      resolveWorkspaces({ workspaces: [nextSummary], nextCursor: null });
      resolveAgents({ agents: [nextSummary], nextCursor: null });
    });
    expect(input("workspace").textContent).toContain("Second team dependency");
    expect(input("stages.0.agent").textContent).toContain(
      "Second team dependency",
    );
    expect(input("workspace").value).toBe("");
    expect(input("stages.0.agent").value).toBe("");
  });

  it("recovers a failed new-team dependency read without clearing the Flow draft", async () => {
    await open("flow");
    vi.mocked(workspaceApi.list).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Workspace choices unavailable"),
    );
    const nextTeam = {
      ...team,
      id: "537bcb18-d56c-471b-bc59-2f38866049a7",
      name: "Second team",
    };
    await act(() => changeTeam(nextTeam));
    expect(container.textContent).toContain("Workspace choices unavailable");
    expect(container.textContent).not.toContain("Loading workspace choices");
    await fill("name", "Keep this Flow draft");
    let resolve!: (
      value: Awaited<ReturnType<typeof workspaceApi.list>>,
    ) => void;
    vi.mocked(workspaceApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await click("Retry workspace choices");
    expect(container.textContent).toContain("Loading workspace choices");
    expect(container.textContent).not.toContain(
      "Workspace choices unavailable",
    );
    expect(input("name").value).toBe("Keep this Flow draft");
    await act(() => resolve({ workspaces: [], nextCursor: null }));
    expect(container.textContent).toContain("No workspaces in this team yet");
    expect(container.textContent).not.toContain("Loading workspace choices");
    expect(input("name").value).toBe("Keep this Flow draft");
    expect(input("workspace").value).toBe("");
    expect(vi.mocked(workspaceApi.list).mock.calls.at(-1)![0]).toBe(
      nextTeam.id,
    );
  });

  it("recovers an interrupted dependency page when authentication callbacks change", async () => {
    vi.mocked(workspaceApi.list).mockResolvedValueOnce({
      workspaces: [],
      nextCursor: id,
    });
    let resolve!: (
      value: Awaited<ReturnType<typeof workspaceApi.list>>,
    ) => void;
    vi.mocked(workspaceApi.list).mockImplementationOnce(
      () =>
        new Promise((value) => {
          resolve = value;
        }),
    );
    await open("flow");
    await fill("name", "Keep my Flow draft");
    await click("Load more workspaces");
    const signal = vi.mocked(workspaceApi.list).mock.calls[1]![2]!;
    expect(container.textContent).toContain("Loading workspace choices");
    await act(() => changeExpiryCallback(vi.fn()));
    expect(signal.aborted).toBe(true);
    expect(container.textContent).not.toContain("Loading workspace choices");
    expect(container.textContent).toContain("No workspaces in this team yet");
    await act(() => resolve({ workspaces: [], nextCursor: id }));
    expect(button("Load more workspaces")).toBeUndefined();
    expect(input("name").value).toBe("Keep my Flow draft");
  });

  it.each(["saved", "viewer"] as const)(
    "does not offer templates in a %s editor",
    async (mode) => {
      await open(
        "workspace",
        mode === "saved",
        mode === "viewer" ? { ...team, role: "viewer" } : team,
      );
      expect(button("Browse templates")).toBeUndefined();
      expect(templateApi.list).not.toHaveBeenCalled();
    },
  );
});
