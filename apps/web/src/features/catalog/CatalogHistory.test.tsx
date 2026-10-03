// @vitest-environment jsdom
import type {
  ResourceVersion,
  ResourceVersionSummary,
  Team,
  Workspace,
  WorkspaceDefinition,
} from "@ark/contracts";
import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createMemoryRouter, Link, RouterProvider } from "react-router-dom";
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
import { WorkspaceEditor } from "../workspaces/WorkspaceEditor";
import { workspaceApi } from "../workspaces/api";
import { useDraftNavigation } from "./useDraftNavigation";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "developer",
};
const id = "e954fe5a-ce79-498d-b185-1f7d4f5c1b28";
const oldVersionId = "799a26b5-b9c6-4e98-b37b-b5bbf8a24f60";
const headVersionId = "537bcb18-d56c-471b-bc59-2f38866049a7";
const timestamp = "2026-10-02T00:00:00.000Z";
const definition: WorkspaceDefinition = {
  name: "Portal",
  description: "Current saved definition",
  repositoryUrl: "https://example.com/team/portal",
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
};
const oldDefinition = {
  ...definition,
  description: "Earlier saved definition",
  actions: { ...definition.actions, test: "pnpm test --old" },
};
function saved(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id,
    teamId: team.id,
    name: definition.name,
    revision: 2,
    versionId: headVersionId,
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    definition: structuredClone(definition),
    ...overrides,
  };
}
function version(overrides: Partial<ResourceVersion> = {}): ResourceVersion {
  return {
    resourceId: id,
    teamId: team.id,
    versionId: oldVersionId,
    revision: 1,
    schemaVersion: 1,
    createdAt: timestamp,
    definition: structuredClone(oldDefinition),
    ...overrides,
  };
}
function summary(
  revision = 1,
  versionId = oldVersionId,
): ResourceVersionSummary {
  return {
    resourceId: id,
    teamId: team.id,
    versionId,
    revision,
    schemaVersion: 1,
    createdAt: timestamp,
  };
}
const onExpired = vi.fn();
let changeTeam: (value: Team) => void;
function Harness() {
  const [currentTeam, setTeam] = useState(team);
  useEffect(() => {
    changeTeam = setTeam;
  }, []);
  const { onDraftStatus, prompt } = useDraftNavigation();
  return (
    <>
      <Link to="/sessions">Sessions</Link>
      {prompt}
      <WorkspaceEditor
        team={currentTeam}
        workspaceId={id}
        onExpired={onExpired}
        onDraftStatus={onDraftStatus}
      />
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

describe("catalog revision history and restore recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(workspaceApi, "get").mockResolvedValue(saved());
    vi.spyOn(workspaceApi, "listVersions").mockResolvedValue({
      versions: [summary(2, headVersionId), summary()],
      nextCursor: null,
    });
    vi.spyOn(workspaceApi, "getVersion").mockResolvedValue(version());
    vi.spyOn(workspaceApi, "restore").mockResolvedValue(
      saved({ revision: 3, definition: oldDefinition }),
    );
    vi.spyOn(workspaceApi, "update").mockResolvedValue(saved({ revision: 3 }));
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
  async function open() {
    router = createMemoryRouter(
      [
        { path: `/workspaces/${id}`, element: <Harness /> },
        { path: "/sessions", element: <h1>Sessions</h1> },
      ],
      { initialEntries: [`/workspaces/${id}`] },
    );
    await act(() => root.render(<RouterProvider router={router} />));
  }
  function button(label: string) {
    const control = [
      ...container.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>(
        "button,a",
      ),
    ].find((item) => item.textContent === label);
    expect(control, `Control ${label} exists`).toBeDefined();
    return control!;
  }
  async function click(label: string) {
    await act(() => button(label).click());
  }
  async function selectRevision(revision = 1) {
    const control = [
      ...container.querySelectorAll<HTMLButtonElement>("button"),
    ].find(
      (item) =>
        item.querySelector("strong")?.textContent === `Revision ${revision}`,
    );
    expect(control).toBeDefined();
    await act(() => control!.click());
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
  async function browse() {
    await click("Browse history");
    await selectRevision();
  }

  it("loads history lazily and previews complete snapshots without changing the draft", async () => {
    await open();
    expect(workspaceApi.listVersions).not.toHaveBeenCalled();
    await fill("description", "Unsaved description");
    await browse();
    expect(
      container.querySelector('[aria-label="Revision 1 definition"]')
        ?.textContent,
    ).toBe(JSON.stringify(oldDefinition, null, 2));
    expect(input("description").value).toBe("Unsaved description");
    expect(input("actions.test").value).toBe("pnpm test");
    expect(workspaceApi.restore).not.toHaveBeenCalled();
    await click("Hide history");
    expect(input("description").value).toBe("Unsaved description");
  });

  it("appends older revisions using an exclusive numeric cursor", async () => {
    vi.mocked(workspaceApi.listVersions)
      .mockResolvedValueOnce({
        versions: [summary(2, headVersionId)],
        nextCursor: 2,
      })
      .mockResolvedValueOnce({ versions: [summary()], nextCursor: null });
    await open();
    await click("Browse history");
    await click("Load older revisions");
    expect(
      vi.mocked(workspaceApi.listVersions).mock.calls[1]?.slice(0, 3),
    ).toEqual([team.id, id, 2]);
    expect(
      container.querySelectorAll('[aria-label="Saved revisions"] li'),
    ).toHaveLength(2);
    expect(container.textContent).not.toContain("Load older revisions");
  });

  it("confirms a fresh revision and draft replacement before restoring", async () => {
    await open();
    await fill("description", "Unsaved description");
    await browse();
    await click("Restore revision 1");
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("new revision 3"),
    );
    expect(window.confirm).toHaveBeenCalledWith(
      expect.stringContaining("replaces your unsaved draft"),
    );
    expect(workspaceApi.restore).not.toHaveBeenCalled();
    expect(input("description").value).toBe("Unsaved description");
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Restore revision 1");
    expect(vi.mocked(workspaceApi.restore).mock.calls[0]?.slice(0, 3)).toEqual([
      team.id,
      id,
      { versionId: oldVersionId, revision: 2 },
    ]);
    expect(input("description").value).toBe(oldDefinition.description);
    expect(input("actions.test").value).toBe(oldDefinition.actions.test);
    expect(container.textContent).toContain(
      "Restored revision 1 as revision 3.",
    );
    expect(container.textContent).toContain("Browse history");
    await click("Sessions");
    expect(router.state.location.pathname).toBe("/sessions");
  });

  it("preserves all draft fields after a lost restore response and only reloads on explicit confirmation", async () => {
    vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Response was lost."),
    );
    await open();
    await fill("description", "Keep this description");
    await fill("actions.test", "pnpm test --draft");
    await browse();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Restore revision 1");
    expect(workspaceApi.restore).toHaveBeenCalledTimes(1);
    expect(input("description").value).toBe("Keep this description");
    expect(input("actions.test").value).toBe("pnpm test --draft");
    expect(container.textContent).toContain("If the restore response was lost");
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Load latest");
    expect(workspaceApi.get).toHaveBeenCalledTimes(1);
    vi.mocked(workspaceApi.get).mockResolvedValueOnce(
      saved({ revision: 3, definition: oldDefinition }),
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Load latest");
    expect(input("description").value).toBe(oldDefinition.description);
    expect(container.textContent).toContain("Revision 3");
    expect(workspaceApi.restore).toHaveBeenCalledTimes(1);
  });

  it("keeps a conflicted draft and prevents another restore until latest is loaded", async () => {
    vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
      new ApiRequestError(
        409,
        "REVISION_CONFLICT",
        "This workspace has changed.",
      ),
    );
    await open();
    await fill("description", "A stale draft");
    await browse();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Restore revision 1");
    expect(input("description").value).toBe("A stale draft");
    expect((button("Restore revision 1") as HTMLButtonElement).disabled).toBe(
      true,
    );
    vi.mocked(window.confirm).mockReturnValue(false);
    await click("Load latest");
    expect(workspaceApi.get).toHaveBeenCalledTimes(1);
    vi.mocked(workspaceApi.get).mockResolvedValueOnce(
      saved({
        revision: 4,
        definition: { ...definition, description: "Saved elsewhere" },
      }),
    );
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Load latest");
    expect(input("description").value).toBe("Saved elsewhere");
    expect(container.textContent).toContain("Revision 4");
  });

  it.each(["INVALID_DEPENDENCY", "UNSUPPORTED_DEPENDENCY"])(
    "preserves the draft after restore dependency validation fails (%s)",
    async (code) => {
      vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
        new ApiRequestError(400, code, "A pinned dependency cannot be used."),
      );
      await open();
      await fill("description", "Preserve my draft");
      await browse();
      vi.mocked(window.confirm).mockReturnValue(true);
      await click("Restore revision 1");
      expect(input("description").value).toBe("Preserve my draft");
      expect(container.textContent).toContain(
        "A pinned dependency cannot be used.",
      );
      expect(workspaceApi.restore).toHaveBeenCalledTimes(1);
      expect((button("Restore revision 1") as HTMLButtonElement).disabled).toBe(
        false,
      );
    },
  );

  it.each(["UNSUPPORTED_SCHEMA_VERSION", "INVALID_STORED_DEFINITION"])(
    "blocks only a rejected historical target (%s)",
    async (code) => {
      vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
        new ApiRequestError(409, code, "This stored snapshot is unsupported.", {
          versionId: ["This source snapshot is unsupported."],
        }),
      );
      await open();
      await fill("description", "My draft stays editable");
      await browse();
      vi.mocked(window.confirm).mockReturnValue(true);
      await click("Restore revision 1");
      expect(container.textContent).toContain("This revision is read-only");
      expect(container.textContent).not.toContain("Restore revision 1");
      expect(input("description").readOnly).toBe(false);
      expect(container.querySelector('button[type="submit"]')).not.toBeNull();
      expect(input("description").value).toBe("My draft stays editable");
    },
  );

  it.each(["UNSUPPORTED_SCHEMA_VERSION", "INVALID_STORED_DEFINITION"])(
    "requires explicit latest recovery when the current saved definition changes incompatibly (%s)",
    async (code) => {
      vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
        new ApiRequestError(
          409,
          code,
          "The current saved definition is unsupported.",
        ),
      );
      await open();
      await fill("description", "Keep my compatible draft");
      await browse();
      vi.mocked(window.confirm).mockReturnValue(true);
      await click("Restore revision 1");
      expect(input("description").value).toBe("Keep my compatible draft");
      expect(input("description").readOnly).toBe(true);
      expect(container.textContent).not.toContain("This revision is read-only");
      expect(container.textContent).toContain("Load latest");
      vi.mocked(workspaceApi.get).mockResolvedValueOnce(
        saved({
          revision: 4,
          schemaVersion: 2,
          definition: { customField: "Current changed definition" },
        }),
      );
      await click("Load latest");
      expect(container.querySelector("form")).toBeNull();
      expect(container.textContent).toContain("Current changed definition");
    },
  );

  it.each([1, 2])(
    "shows unsupported historical schema/fields %s without rewriting or restoring",
    async (schemaVersion) => {
      const value = { ...oldDefinition, customField: "Retain this field" };
      vi.mocked(workspaceApi.getVersion).mockResolvedValueOnce(
        version({ schemaVersion, definition: value }),
      );
      await open();
      await browse();
      expect(
        container.querySelector('[aria-label="Revision 1 definition"]')
          ?.textContent,
      ).toContain("Retain this field");
      expect(container.textContent).toContain("This revision is read-only");
      expect(container.textContent).not.toContain("Restore revision 1");
      expect(workspaceApi.restore).not.toHaveBeenCalled();
    },
  );

  it("permits history browsing on an unsupported current head and disables restore", async () => {
    vi.mocked(workspaceApi.get).mockResolvedValueOnce(
      saved({
        schemaVersion: 2,
        definition: { customField: "Current unknown definition" },
      }),
    );
    await open();
    await browse();
    expect(container.textContent).toContain("Current unknown definition");
    expect(container.textContent).toContain(
      "The current definition is unsupported",
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("Restore revision 1");
  });

  it("lets viewers read history and revokes restore controls after a role downgrade", async () => {
    await open();
    await fill("description", "Draft before access change");
    await browse();
    await act(() => changeTeam({ ...team, role: "viewer" }));
    expect(
      container.querySelector('[aria-label="Revision 1 definition"]'),
    ).not.toBeNull();
    expect(container.textContent).not.toContain("Restore revision 1");
    expect(input("description").value).toBe("Draft before access change");
    expect(input("description").readOnly).toBe(true);
    expect(workspaceApi.get).toHaveBeenCalledTimes(1);
  });

  it("keeps the draft and makes editing read-only when restore authorization is rejected", async () => {
    vi.mocked(workspaceApi.restore).mockRejectedValueOnce(
      new ApiRequestError(403, "FORBIDDEN", "Write access was revoked."),
    );
    await open();
    await fill("description", "Draft before server revocation");
    await browse();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Restore revision 1");
    expect(input("description").value).toBe("Draft before server revocation");
    expect(input("description").readOnly).toBe(true);
    expect(container.textContent).not.toContain("Restore revision 1");
  });

  it("retries history reads explicitly without mutating the catalog", async () => {
    vi.mocked(workspaceApi.listVersions).mockRejectedValueOnce(
      new ApiRequestError(0, "OFFLINE", "Cannot load revisions."),
    );
    await open();
    await click("Browse history");
    expect(container.textContent).toContain("Cannot load revisions.");
    expect(workspaceApi.listVersions).toHaveBeenCalledTimes(1);
    await click("Retry history");
    expect(workspaceApi.listVersions).toHaveBeenCalledTimes(2);
    expect(workspaceApi.restore).not.toHaveBeenCalled();
    expect(workspaceApi.update).not.toHaveBeenCalled();
  });

  it.each(["list", "preview", "restore"] as const)(
    "blocks page navigation, unload, and conflicting requests during %s",
    async (phase) => {
      let resolve!: () => void;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      if (phase === "list")
        vi.mocked(workspaceApi.listVersions).mockImplementationOnce(
          async () => {
            await pending;
            return { versions: [summary()], nextCursor: null };
          },
        );
      if (phase === "preview")
        vi.mocked(workspaceApi.getVersion).mockImplementationOnce(async () => {
          await pending;
          return version();
        });
      if (phase === "restore")
        vi.mocked(workspaceApi.restore).mockImplementationOnce(async () => {
          await pending;
          return saved({ revision: 3, definition: oldDefinition });
        });
      await open();
      await click("Browse history");
      if (phase !== "list") await selectRevision();
      if (phase === "restore") {
        vi.mocked(window.confirm).mockReturnValue(true);
        await click("Restore revision 1");
      }
      expect(input("description").disabled).toBe(true);
      const unloading = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(unloading);
      expect(unloading.defaultPrevented).toBe(true);
      await click("Sessions");
      expect(container.textContent).toContain("A request is still in progress");
      expect((button("Leave page") as HTMLButtonElement).disabled).toBe(true);
      await act(() =>
        container
          .querySelector("form")!
          .dispatchEvent(
            new Event("submit", { bubbles: true, cancelable: true }),
          ),
      );
      expect(workspaceApi.update).not.toHaveBeenCalled();
      await act(() => resolve());
      await click("Leave page");
      expect(router.state.location.pathname).toBe("/sessions");
    },
  );

  it.each(["list", "preview", "restore"] as const)(
    "ignores a delayed %s result after the editor's team identity changes",
    async (phase) => {
      let resolve!: () => void;
      let signal: AbortSignal | undefined;
      const pending = new Promise<void>((done) => {
        resolve = done;
      });
      if (phase === "list")
        vi.mocked(workspaceApi.listVersions).mockImplementationOnce(
          async (_team, _id, _cursor, requestSignal) => {
            signal = requestSignal;
            await pending;
            return { versions: [summary()], nextCursor: null };
          },
        );
      if (phase === "preview")
        vi.mocked(workspaceApi.getVersion).mockImplementationOnce(
          async (_team, _id, _version, requestSignal) => {
            signal = requestSignal;
            await pending;
            return version();
          },
        );
      if (phase === "restore")
        vi.mocked(workspaceApi.restore).mockImplementationOnce(
          async (_team, _id, _input, requestSignal) => {
            signal = requestSignal;
            await pending;
            return saved({ revision: 3, definition: oldDefinition });
          },
        );
      await open();
      await click("Browse history");
      if (phase !== "list") await selectRevision();
      if (phase === "restore") {
        vi.mocked(window.confirm).mockReturnValue(true);
        await click("Restore revision 1");
      }
      const otherTeam = {
        ...team,
        id: "52847e97-46bf-467a-b642-7c670f2855a6",
        name: "Other team",
      };
      vi.mocked(workspaceApi.get).mockResolvedValueOnce(
        saved({
          teamId: otherTeam.id,
          definition: {
            ...definition,
            description: "Other team configuration",
          },
        }),
      );
      await act(() => changeTeam(otherTeam));
      expect(signal?.aborted).toBe(true);
      await act(() => resolve());
      expect(input("description").value).toBe("Other team configuration");
      expect(container.textContent).not.toContain("Earlier saved definition");
      expect(container.textContent).toContain("Browse history");
    },
  );

  it("expires the session if a history read returns unauthorized", async () => {
    vi.mocked(workspaceApi.listVersions).mockRejectedValueOnce(
      new ApiRequestError(401, "UNAUTHENTICATED", "Sign in again."),
    );
    await open();
    await click("Browse history");
    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(workspaceApi.restore).not.toHaveBeenCalled();
  });

  it("retains the draft when a restore response contains unsupported fields", async () => {
    vi.mocked(workspaceApi.restore).mockResolvedValueOnce(
      saved({
        revision: 3,
        schemaVersion: 2,
        definition: { customField: "Unexpected restored result" },
      }),
    );
    await open();
    await fill("description", "Keep the draft after unexpected response");
    await browse();
    vi.mocked(window.confirm).mockReturnValue(true);
    await click("Restore revision 1");
    expect(input("description").value).toBe(
      "Keep the draft after unexpected response",
    );
    expect(container.textContent).toContain("unexpected restored definition");
    expect(container.textContent).toContain("Load latest");
  });
});
