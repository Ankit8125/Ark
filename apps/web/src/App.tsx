import type { MeResponse } from "@ark/contracts";
import { Box, LoaderCircle, RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { api, ApiRequestError, errorMessage } from "./api";
import { AuthPage } from "./AuthPage";
import { Shell } from "./Shell";
import styles from "./App.module.css";

type State =
  | { kind: "loading" }
  | { kind: "setup" }
  | { kind: "anonymous"; notice?: string }
  | { kind: "authenticated"; me: MeResponse }
  | { kind: "offline"; message: string };

function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const sessionVersion = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    const version = ++sessionVersion.current;
    async function load() {
      setState({ kind: "loading" });
      try {
        const required = await api.bootstrapStatus(controller.signal);
        if (controller.signal.aborted || version !== sessionVersion.current)
          return;
        if (required) setState({ kind: "setup" });
        else {
          const me = await api.me(controller.signal);
          if (!controller.signal.aborted && version === sessionVersion.current)
            setState({ kind: "authenticated", me });
        }
      } catch (error) {
        if (controller.signal.aborted || version !== sessionVersion.current)
          return;
        setState(
          error instanceof ApiRequestError && error.status === 401
            ? { kind: "anonymous" }
            : { kind: "offline", message: errorMessage(error) },
        );
      }
    }
    void load();
    return () => controller.abort();
  }, [attempt]);

  const expired = useCallback(() => {
    sessionVersion.current += 1;
    setState({
      kind: "anonymous",
      notice: "Your session has ended. Sign in again to continue.",
    });
  }, []);
  const authenticated = state.kind === "authenticated";
  useEffect(() => {
    if (!authenticated) return;
    const controller = new AbortController();
    let refreshing = false;
    async function recheck() {
      if (document.visibilityState !== "visible" || refreshing) return;
      refreshing = true;
      const version = sessionVersion.current;
      try {
        const me = await api.me(controller.signal);
        if (!controller.signal.aborted && version === sessionVersion.current)
          setState((current) =>
            current.kind === "authenticated"
              ? { kind: "authenticated", me }
              : current,
          );
      } catch (error) {
        if (
          !controller.signal.aborted &&
          version === sessionVersion.current &&
          error instanceof ApiRequestError &&
          error.status === 401
        )
          expired();
      } finally {
        refreshing = false;
      }
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      controller.abort();
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [authenticated, expired]);

  if (state.kind === "loading" || state.kind === "offline") {
    return (
      <main className={styles.connectionPage}>
        <div className={styles.brand}>
          <Box size={23} aria-hidden="true" />
          <span>ark</span>
        </div>
        {state.kind === "loading" ? (
          <div role="status" className={styles.connectionStatus}>
            <LoaderCircle
              size={22}
              className={styles.spinner}
              aria-hidden="true"
            />
            <h1>Opening your workspace…</h1>
          </div>
        ) : (
          <div className={styles.connectionStatus}>
            <WifiOff size={28} aria-hidden="true" />
            <h1>Can’t connect to Ark</h1>
            <p role="alert">{state.message}</p>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Retry connection
            </button>
          </div>
        )}
      </main>
    );
  }

  const accept = (me: MeResponse) => {
    sessionVersion.current += 1;
    setState({ kind: "authenticated", me });
  };
  const logout = () => {
    sessionVersion.current += 1;
    setState({ kind: "anonymous" });
  };
  return (
    <Routes>
      <Route
        path="/setup"
        element={
          state.kind === "setup" ? (
            <AuthPage
              key="setup"
              mode="setup"
              onSuccess={accept}
              onSetupComplete={() =>
                setState({
                  kind: "anonymous",
                  notice:
                    "This organization has already been set up. Sign in to continue.",
                })
              }
            />
          ) : (
            <Navigate
              to={state.kind === "authenticated" ? "/sessions" : "/login"}
              replace
            />
          )
        }
      />
      <Route
        path="/login"
        element={
          state.kind === "anonymous" ? (
            <AuthPage
              key="login"
              mode="login"
              notice={state.notice}
              onSuccess={accept}
              onSetupComplete={() => undefined}
            />
          ) : (
            <Navigate
              to={state.kind === "setup" ? "/setup" : "/sessions"}
              replace
            />
          )
        }
      />
      <Route
        path="/*"
        element={
          state.kind === "authenticated" ? (
            <Shell
              me={state.me}
              onExpired={expired}
              onLogout={logout}
              onRefresh={() => setAttempt((value) => value + 1)}
            />
          ) : (
            <Navigate
              to={state.kind === "setup" ? "/setup" : "/login"}
              replace
            />
          )
        }
      />
    </Routes>
  );
}

export default App;
