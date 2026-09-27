// @vitest-environment jsdom
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  createMemoryRouter,
  Link,
  Route,
  RouterProvider,
  Routes,
  useParams,
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
import type {
  MeResponse,
  Team,
  Workspace,
  WorkspaceDefinition,
} from "@ark/contracts";
import { api, ApiRequestError } from "../../api";
import { Shell } from "../../Shell";
import { workspaceApi } from "./api";
import { WorkspaceEditor } from "./WorkspaceEditor";
import { useDraftNavigation } from "../catalog/useDraftNavigation";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "developer",
};
const workspaceId = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const definition: WorkspaceDefinition = {
  name: "Customer portal",
  description: "All fields must survive a failed save.",
  repositoryUrl: "https://github.com/example/portal",
  sourceRef: "release/one",
  defaultBranch: "main",
  sandboxImage: "node:24-bookworm",
  workingDirectory: "apps/web",
  actions: {
    install: "pnpm install",
    test: "pnpm test",
    lint: "pnpm lint",
    build: "pnpm build",
  },
};
function saved(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: workspaceId,
    teamId: team.id,
    name: definition.name,
    revision: 1,
    versionId: "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60",
    schemaVersion: 1,
    createdAt: "2026-09-27T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    definition: structuredClone(definition),
    ...overrides,
  };
}
const onExpired = vi.fn();
let changeTeam: (value: Team) => void;

function EditorRoute({
  currentTeam,
  onDraftStatus,
}: {
  currentTeam: Team;
  onDraftStatus: ReturnType<typeof useDraftNavigation>["onDraftStatus"];
}) {
  const { id } = useParams();
  return (
    <WorkspaceEditor
      key={`${currentTeam.id}:${id ?? "new"}`}
      team={currentTeam}
      workspaceId={id}
      onExpired={onExpired}
      onDraftStatus={onDraftStatus}
    />
  );
}
function Harness() {
  const [currentTeam, setCurrentTeam] = useState(team);
  useEffect(() => {
    changeTeam = setCurrentTeam;
  }, []);
  const { onDraftStatus, prompt } = useDraftNavigation();
  return (
    <>
      <Link to="/sessions">Sessions</Link>
      {prompt}
      <Routes>
        <Route
          path="/workspaces/new"
          element={
            <EditorRoute
              currentTeam={currentTeam}
              onDraftStatus={onDraftStatus}
            />
          }
        />
        <Route
          path="/workspaces/:id"
          element={
            <EditorRoute
              currentTeam={currentTeam}
              onDraftStatus={onDraftStatus}
            />
          }
        />
        <Route path="/workspaces" element={<h1>Workspaces</h1>} />
        <Route path="/sessions" element={<h1>Sessions</h1>} />
      </Routes>
    </>
  );
}

function ShellHarness({ initialTeam = team }: { initialTeam?: Team }) {
  const [currentTeam, setCurrentTeam] = useState(initialTeam);
  useEffect(() => {
    changeTeam = setCurrentTeam;
  }, []);
  const me: MeResponse = {
    user: {
      id: "d321b7d5-a114-4b7d-ac6b-42063c0650c4",
      name: "Test member",
      email: "member@example.test",
    },
    organization: {
      id: "a09c833b-b529-4e5f-9800-bb5bc610b006",
      name: "Test organization",
      role: "member",
    },
    teams: [
      currentTeam,
      {
        id: "1b91fb07-5d97-4514-84ad-d9c2f2d148e1",
        name: "Second team",
        role: "viewer",
      },
    ],
  };
  return (
    <Shell
      me={me}
      onExpired={onExpired}
      onLogout={onExpired}
      onRefresh={onExpired}
    />
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

describe("workspace editor recovery and access", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(workspaceApi, "get").mockResolvedValue(saved());
    vi.spyOn(workspaceApi, "create").mockImplementation(async (_team, input) =>
      saved({
        id: input.id,
        name: input.definition.name,
        definition: input.definition,
      }),
    );
    vi.spyOn(workspaceApi, "update").mockImplementation(
      async (_team, id, input) =>
        saved({
          id,
          name: input.definition.name,
          revision: input.revision + 1,
          definition: input.definition,
        }),
    );
    vi.spyOn(window, "confirm").mockReturnValue(false);
    onExpired.mockClear();
    localStorage.clear();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    router?.dispose();
    container.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  async function open(path = `/workspaces/${workspaceId}`) {
    router = createMemoryRouter([{ path: "*", element: <Harness /> }], {
      initialEntries: [path],
    });
    await act(() => root.render(<RouterProvider router={router} />));
  }
  async function openShell(fetchedTeam = team, initialTeam = team) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      })),
    );
    vi.spyOn(api, "team").mockResolvedValue(fetchedTeam);
    router = createMemoryRouter(
      [{ path: "*", element: <ShellHarness initialTeam={initialTeam} /> }],
      {
        initialEntries: [`/workspaces/${workspaceId}`],
      },
    );
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

  it("keeps every field after a failed save and retries only when asked", async () => {
    vi.mocked(workspaceApi.update).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Cannot reach Ark."),
    );
    await open();
    await fill("description", "A draft with a new description");
    await fill("actions.test", "pnpm test --run");
    await submit();
    expect(container.textContent).toContain("Cannot reach Ark.");
    expect(input("description").value).toBe("A draft with a new description");
    expect(input("actions.test").value).toBe("pnpm test --run");
    expect(input("sourceRef").value).toBe(definition.sourceRef);
    expect(input("sandboxImage").value).toBe(definition.sandboxImage);
    expect(workspaceApi.update).toHaveBeenCalledTimes(1);
    await submit();
    expect(vi.mocked(workspaceApi.update).mock.calls[1]?.[2]).toEqual({
      revision: 1,
      schemaVersion: 1,
      definition: {
        ...definition,
        description: "A draft with a new description",
        actions: { ...definition.actions, test: "pnpm test --run" },
      },
    });
    expect(container.textContent).toContain("Saved revision 2.");
  });

  it("keeps a stale draft until the user explicitly confirms loading latest", async () => {
    vi.mocked(workspaceApi.update).mockRejectedValueOnce(
      new ApiRequestError(
        409,
        "REVISION_CONFLICT",
        "This workspace has changed.",
      ),
    );
    await open();
    await fill("name", "My draft name");
    await submit();
    expect(input("name").value).toBe("My draft name");
    await click("Load latest");
    expect(workspaceApi.get).toHaveBeenCalledTimes(1);
    expect(input("name").value).toBe("My draft name");
    vi.mocked(window.confirm).mockReturnValue(true);
    vi.mocked(workspaceApi.get).mockResolvedValueOnce(
      saved({
        revision: 3,
        name: "Changed elsewhere",
        definition: { ...definition, name: "Changed elsewhere" },
      }),
    );
    await click("Load latest");
    expect(input("name").value).toBe("Changed elsewhere");
    expect(container.textContent).toContain("Revision 3");
  });

  it("keeps one creation ID across retries and offers recovery for an edited retry", async () => {
    vi.mocked(workspaceApi.create)
      .mockRejectedValueOnce(
        new ApiRequestError(0, "OFFLINE", "Response was lost."),
      )
      .mockRejectedValueOnce(
        new ApiRequestError(
          409,
          "ID_CONFLICT",
          "This request cannot be reused.",
        ),
      );
    await open("/workspaces/new");
    for (const [key, value] of Object.entries(definition)) {
      if (typeof value === "string") await fill(key, value);
      else
        for (const [action, command] of Object.entries(value))
          await fill(`actions.${action}`, command);
    }
    await submit();
    await fill("description", "Edited after the response was lost");
    await submit();
    const firstId = vi.mocked(workspaceApi.create).mock.calls[0]?.[1].id;
    expect(vi.mocked(workspaceApi.create).mock.calls[1]?.[1].id).toBe(firstId);
    expect(input("description").value).toBe(
      "Edited after the response was lost",
    );
    expect(container.textContent).toContain("Load saved workspace");
    await click("Keep draft as new");
    await fill("name", "Another workspace");
    await submit();
    expect(vi.mocked(workspaceApi.create).mock.calls[2]?.[1].id).not.toBe(
      firstId,
    );
  });

  it.each([
    [2, { futureField: "Preserve me" }],
    [1, { ...definition, futureField: "Preserve me" }],
  ])(
    "renders unsupported schema %s as read-only without a save form",
    async (schemaVersion, value) => {
      vi.mocked(workspaceApi.get).mockResolvedValueOnce(
        saved({ schemaVersion, definition: value }),
      );
      await open();
      expect(container.textContent).toContain("This definition is read-only");
      expect(container.querySelector("pre")?.textContent).toContain(
        "Preserve me",
      );
      expect(container.querySelector("form")).toBeNull();
      expect(workspaceApi.update).not.toHaveBeenCalled();
    },
  );

  it("preserves an unsaved draft but removes write controls when refreshed membership becomes read-only", async () => {
    await open();
    await fill("name", "Draft survives role refresh");
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(input("name").value).toBe("Draft survives role refresh");
    expect(input("name").readOnly).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    await submit();
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it("blocks navigation, allows cancellation, and leaves only on explicit discard", async () => {
    await open();
    await fill("name", "Unsaved name");
    await click("Sessions");
    expect(router.state.location.pathname).toBe(`/workspaces/${workspaceId}`);
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(document.activeElement?.textContent).toBe("Stay here");
    await click("Stay here");
    expect(input("name").value).toBe("Unsaved name");
    await click("Sessions");
    await click("Discard and leave");
    expect(router.state.location.pathname).toBe("/sessions");
    expect(container.querySelector("h1")?.textContent).toBe("Sessions");
  });

  it("ignores an old team's delayed response after the team changes", async () => {
    let resolveOld!: (workspace: Workspace) => void;
    vi.mocked(workspaceApi.get).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    await open();
    const otherTeam = {
      ...team,
      id: "52847e97-46bf-467a-b642-7c670f2855a6",
      name: "Other team",
    };
    vi.mocked(workspaceApi.get).mockResolvedValueOnce(
      saved({
        teamId: otherTeam.id,
        name: "Other team workspace",
        definition: { ...definition, name: "Other team workspace" },
      }),
    );
    await act(() => changeTeam(otherTeam));
    expect(input("name").value).toBe("Other team workspace");
    await act(() => resolveOld(saved()));
    expect(input("name").value).toBe("Other team workspace");
  });

  it("keeps the actual shell editor mounted while a refreshed team role is checked", async () => {
    await openShell();
    await fill("name", "Keep this draft on role refresh");
    let resolveTeam!: (value: Team) => void;
    vi.mocked(api.team).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTeam = resolve;
        }),
    );
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(input("name").value).toBe("Keep this draft on role refresh");
    expect(input("name").readOnly).toBe(true);
    await act(() => resolveTeam({ ...team, role: "viewer" }));
    expect(input("name").value).toBe("Keep this draft on role refresh");
    expect(workspaceApi.get).toHaveBeenCalledTimes(1);
  });

  it.each([0, 503])(
    "keeps a dirty draft through a failed team refresh (%s), then enables saving only after a successful retry",
    async (status) => {
      await openShell();
      await fill("name", "Keep my unsaved workspace");
      const renamedTeam = { ...team, name: "Engineering renamed" };
      vi.mocked(api.team).mockRejectedValueOnce(
        new ApiRequestError(
          status,
          "TEMPORARY_FAILURE",
          "Team access could not be checked.",
        ),
      );
      await act(() => changeTeam(renamedTeam));
      expect(input("name").value).toBe("Keep my unsaved workspace");
      expect(input("name").readOnly).toBe(true);
      expect(container.querySelector('button[type="submit"]')).toBeNull();
      expect(container.textContent).toContain(
        "Saving is paused until team access is checked.",
      );
      await submit();
      expect(workspaceApi.update).not.toHaveBeenCalled();
      vi.mocked(api.team).mockResolvedValueOnce(renamedTeam);
      await click("Retry team access");
      expect(input("name").value).toBe("Keep my unsaved workspace");
      expect(input("name").readOnly).toBe(false);
      expect(container.querySelector('button[type="submit"]')).not.toBeNull();
      expect(workspaceApi.get).toHaveBeenCalledTimes(1);
      await click("Sessions");
      expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    },
  );

  it("uses the fetched viewer role even when /me still reports team admin", async () => {
    await openShell({ ...team, role: "viewer" }, { ...team, role: "admin" });
    expect(input("name").readOnly).toBe(true);
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    await submit();
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it("removes the open editor when the refreshed team check definitively denies access", async () => {
    await openShell();
    await fill("name", "Draft before revocation");
    vi.mocked(api.team).mockRejectedValueOnce(
      new ApiRequestError(404, "NOT_FOUND", "Team not found."),
    );
    await act(() => changeTeam({ ...team, name: "Changed team" }));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Couldn’t open this team");
    expect(container.textContent).not.toContain("Draft before revocation");
  });

  it("keeps dirty protection after logout fails and honors canceled team changes", async () => {
    vi.spyOn(api, "logout").mockRejectedValue(
      new ApiRequestError(0, "OFFLINE", "Cannot sign out while offline."),
    );
    await openShell();
    await fill("name", "A draft worth keeping");
    const select = container.querySelector<HTMLSelectElement>("#active-team")!;
    await act(() => {
      select.value = "1b91fb07-5d97-4514-84ad-d9c2f2d148e1";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(select.value).toBe(team.id);
    expect(input("name").value).toBe("A draft worth keeping");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Sign out");
    expect(api.logout).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Cannot sign out while offline.");
    await click("Sessions");
    expect(container.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(input("name").value).toBe("A draft worth keeping");
  });
});
