import type { RootOptions } from "react-dom/client";

type UiErrorCode =
  "UI_RENDER_ERROR" | "UI_UNCAUGHT_ERROR" | "UI_RECOVERABLE_ERROR";

export type UiErrorEvent = Readonly<{
  source: "react";
  code: UiErrorCode;
}>;
export type UiErrorReporter = (event: UiErrorEvent) => void;

const consoleReporter: UiErrorReporter = (event) => {
  console.error("[Ark UI]", event);
};

type ErrorHandlers = Required<
  Pick<RootOptions, "onCaughtError" | "onUncaughtError" | "onRecoverableError">
>;

// React error arguments can contain application data. Only fixed event codes
// cross this reporting boundary, including when a custom reporter is installed.
export function createRootErrorHandlers(
  reporter: UiErrorReporter = consoleReporter,
): ErrorHandlers {
  function report(code: UiErrorCode) {
    try {
      reporter(Object.freeze({ source: "react", code }));
    } catch {
      // Reporting must never interfere with the recovery UI.
    }
  }

  return {
    onCaughtError: () => report("UI_RENDER_ERROR"),
    onUncaughtError: () => report("UI_UNCAUGHT_ERROR"),
    onRecoverableError: () => report("UI_RECOVERABLE_ERROR"),
  };
}
