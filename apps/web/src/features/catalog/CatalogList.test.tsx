// @vitest-environment jsdom
import type { Team } from "@ark/contracts";
import { FolderGit2 } from "lucide-react";
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
import { CatalogList, type CatalogPage } from "./CatalogList";

const team: Team = {
  id: "b8f983e4-8bfe-4c11-8302-d050c258d883",
  name: "Engineering",
  role: "developer",
};
const timestamp = "2026-10-03T00:00:00.000Z";
function page(name: string, nextCursor: string | null = null): CatalogPage {
  return {
    items: [
      {
        id: name,
        name,
        revision: 1,
        schemaVersion: 1,
        updatedAt: timestamp,
        lifecycleRevision: 1,
        archivedAt: name.includes("Archived") ? timestamp : null,
      },
    ],
    nextCursor,
  };
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

describe("catalog status filtering", () => {
  let container: HTMLDivElement;
  let root: Root;
  let router: ReturnType<typeof createMemoryRouter>;
  const loadPage =
    vi.fn<
      (
        teamId: string,
        cursor?: string,
        signal?: AbortSignal,
        status?: "active" | "archived",
      ) => Promise<CatalogPage>
    >();
  const onExpired = vi.fn();
  let changeTeam: (value: Team) => void;
  beforeEach(() => {
    loadPage
      .mockReset()
      .mockResolvedValue(page("Active workspace", "next-active"));
    onExpired.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(() => root.unmount());
    router?.dispose();
    container.remove();
  });
  function list(currentTeam = team) {
    return (
      <CatalogList
        team={currentTeam}
        onExpired={onExpired}
        kind="workspace"
        plural="workspaces"
        title="Workspaces"
        description="Team workspaces"
        createDescription="Create a workspace"
        icon={FolderGit2}
        loadPage={loadPage}
      />
    );
  }
  async function open(url = "/workspaces") {
    function Harness() {
      const [currentTeam, setTeam] = useState(team);
      useEffect(() => {
        changeTeam = setTeam;
      }, []);
      return list(currentTeam);
    }
    router = createMemoryRouter(
      [{ path: "/workspaces", element: <Harness /> }],
      { initialEntries: [url] },
    );
    await act(() => root.render(<RouterProvider router={router} />));
  }
  async function filter(value: string) {
    const control = container.querySelector("select")!;
    await act(() => {
      control.value = value;
      control.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }
  async function more() {
    const control = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Load more",
    )!;
    await act(() => control.click());
  }

  it("uses active by default, starts archived pagination fresh, and keeps the filter in the URL", async () => {
    await open();
    expect(loadPage).toHaveBeenLastCalledWith(
      team.id,
      undefined,
      expect.any(AbortSignal),
      "active",
    );
    loadPage.mockResolvedValueOnce(page("Archived workspace", "next-archived"));
    await filter("archived");
    expect(router.state.location.search).toBe("?status=archived");
    expect(loadPage).toHaveBeenLastCalledWith(
      team.id,
      undefined,
      expect.any(AbortSignal),
      "archived",
    );
    expect(container.textContent).not.toContain("Active workspace");
    expect(container.textContent).toContain("Archived workspace");
    loadPage.mockResolvedValueOnce(page("Archived second"));
    await more();
    expect(loadPage).toHaveBeenLastCalledWith(
      team.id,
      "next-archived",
      expect.any(AbortSignal),
      "archived",
    );
    expect(container.textContent).toContain("Archived second");
    loadPage.mockResolvedValueOnce(page("Active workspace"));
    await filter("active");
    expect(router.state.location.search).toBe("");
    expect(container.textContent).not.toContain("Archived second");
  });

  it("honors the archived filter on a fresh page load", async () => {
    loadPage.mockResolvedValueOnce({ items: [], nextCursor: null });
    await open("/workspaces?status=archived");
    expect(container.querySelector("select")?.value).toBe("archived");
    expect(container.textContent).toContain("No archived workspaces");
    expect(loadPage).toHaveBeenLastCalledWith(
      team.id,
      undefined,
      expect.any(AbortSignal),
      "archived",
    );
  });

  it("aborts delayed active pagination and ignores its response after switching filters", async () => {
    let resolve!: (value: CatalogPage) => void;
    await open();
    loadPage.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await more();
    const signal = loadPage.mock.calls.at(-1)![2];
    loadPage.mockResolvedValueOnce(page("Archived workspace"));
    await filter("archived");
    expect(signal?.aborted).toBe(true);
    await act(() => resolve(page("Stale active page")));
    expect(container.textContent).not.toContain("Stale active page");
    expect(container.textContent).toContain("Archived workspace");
  });

  it("resets items and pagination when the team changes", async () => {
    let resolve!: (value: CatalogPage) => void;
    await open();
    loadPage.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await more();
    const signal = loadPage.mock.calls.at(-1)![2];
    const otherTeam = {
      ...team,
      id: "52847e97-46bf-467a-b642-7c670f2855a6",
      name: "Other team",
    };
    loadPage.mockResolvedValueOnce(page("Other team workspace"));
    await act(() => changeTeam(otherTeam));
    expect(loadPage).toHaveBeenLastCalledWith(
      otherTeam.id,
      undefined,
      expect.any(AbortSignal),
      "active",
    );
    expect(signal?.aborted).toBe(true);
    await act(() => resolve(page("Stale other page")));
    expect(container.textContent).not.toContain("Active workspace");
    expect(container.textContent).not.toContain("Stale other page");
    expect(container.textContent).toContain("Other team workspace");
  });

  it("expires the session on an unauthorized filtered read", async () => {
    loadPage.mockRejectedValueOnce(
      new ApiRequestError(401, "UNAUTHENTICATED", "Sign in again"),
    );
    await open("/workspaces?status=archived");
    expect(onExpired).toHaveBeenCalledTimes(1);
  });
});
