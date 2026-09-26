// @vitest-environment jsdom
import { act, StrictMode } from "react";
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
import { ErrorBoundary } from "./ErrorBoundary";
import {
  createRootErrorHandlers,
  type UiErrorReporter,
} from "./error-reporting";

const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
const previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  if (previousActEnvironment === undefined)
    delete actEnvironment.IS_REACT_ACT_ENVIRONMENT;
  else actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
});

describe("root render recovery", () => {
  let container: HTMLDivElement;
  let root: Root;
  let report: ReturnType<typeof vi.fn<UiErrorReporter>>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    report = vi.fn<UiErrorReporter>();
    root = createRoot(container, createRootErrorHandlers(report));
  });
  afterEach(async () => {
    await act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("renders healthy children without reporting an error", async () => {
    await act(() => {
      root.render(
        <ErrorBoundary>
          <h1>Healthy application</h1>
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector("h1")?.textContent).toBe(
      "Healthy application",
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("recovers from a descendant render error and reports only one safe event", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const reload = vi.fn();
    const privateDetail = "PRIVATE_SENTINEL_NOT_FOR_LOGGING";
    function BrokenView(): never {
      throw new Error(privateDetail);
    }

    await act(() => {
      root.render(
        <StrictMode>
          <ErrorBoundary onReload={reload}>
            <BrokenView />
          </ErrorBoundary>
        </StrictMode>,
      );
    });

    expect(container.querySelector('[role="alert"] h1')?.textContent).toBe(
      "Ark couldn’t display this page",
    );
    expect(container.textContent).not.toContain(privateDetail);
    expect(report.mock.calls).toEqual([
      [{ source: "react", code: "UI_RENDER_ERROR" }],
    ]);
    expect(consoleError).not.toHaveBeenCalled();
    const reloadButton = container.querySelector("button");
    expect(reloadButton?.textContent).toBe("Reload Ark");
    await act(() => reloadButton?.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("keeps recovery available when the reporting hook fails", async () => {
    report.mockImplementation(() => {
      throw new Error("Reporting unavailable");
    });
    function BrokenView(): never {
      throw new Error("Render unavailable");
    }
    const reload = vi.fn();
    await act(() => {
      root.render(
        <ErrorBoundary onReload={reload}>
          <BrokenView />
        </ErrorBoundary>,
      );
    });
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await act(() => container.querySelector("button")?.click());
    expect(reload).toHaveBeenCalledOnce();
  });

  it("discards raw error details in every React root reporting hook", () => {
    const hooks = createRootErrorHandlers(report);
    const error = new Error("PRIVATE_SENTINEL_NOT_FOR_LOGGING");
    const details = { componentStack: "PRIVATE_COMPONENT_CONTEXT" };
    hooks.onCaughtError(error, details);
    hooks.onUncaughtError(error, details);
    hooks.onRecoverableError(error, details);
    expect(report.mock.calls).toEqual([
      [{ source: "react", code: "UI_RENDER_ERROR" }],
      [{ source: "react", code: "UI_UNCAUGHT_ERROR" }],
      [{ source: "react", code: "UI_RECOVERABLE_ERROR" }],
    ]);
  });
});
