import {
  type ExecutionSession,
  type SessionEvent,
  type SessionEventLogResponse,
  type Team,
} from "@ark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "../../api";
import common from "../../App.module.css";
import { computeApi } from "../compute/api";
import {
  isTerminal,
  parseSessionEvent,
  sessionEventsUrl,
  sessionsApi,
} from "./api";
import styles from "./sessions.module.css";

type Props = {
  team: Team;
  userId: string;
  id: string;
  onChanged: (session: ExecutionSession) => void;
  onError: (error: unknown) => boolean;
};
const TERMINAL_EVENT_PAGE_LIMIT = 10;

export function SessionDetail({ team, userId, id, onChanged, onError }: Props) {
  const [session, setSession] = useState<ExecutionSession | null>(null);
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [nextAfter, setNextAfter] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [streamMessage, setStreamMessage] = useState(
    "Connecting to saved events…",
  );
  const [streamAttempt, setStreamAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const [action, setAction] = useState<"cancel" | "reconcile" | null>(null);
  const [confirmedStopped, setConfirmedStopped] = useState(false);
  const [runnerRevoked, setRunnerRevoked] = useState(false);
  const [runnerAttempt, setRunnerAttempt] = useState(0);
  const [terminalHistory, setTerminalHistory] = useState<
    "pending" | "complete" | "paused"
  >("pending");
  const controller = useRef<AbortController | null>(null);
  const cursor = useRef(0);
  const seen = useRef(new Map<number, string>());
  const source = useRef<EventSource | null>(null);
  const reading = useRef(false);
  const refreshQueued = useRef(false);
  const reconnects = useRef(0);
  const writing = useRef(false);
  const eventRead = useRef<Promise<SessionEventLogResponse | null> | null>(
    null,
  );
  const terminal = session ? isTerminal(session.state) : false;
  const runnerId = session?.runnerId;
  const revision = session?.revision;
  const hasSession = session !== null;
  const liveSupported = typeof EventSource !== "undefined";

  const accept = useCallback(
    (value: ExecutionSession) => {
      setSession((current) =>
        !current || value.revision >= current.revision ? value : current,
      );
      onChanged(value);
    },
    [onChanged],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    if (reading.current) {
      refreshQueued.current = true;
      return;
    }
    reading.current = true;
    try {
      const result = await sessionsApi.get(team.id, id, signal);
      if (!signal.aborted) {
        accept(result.session);
        setNeedsRefresh(false);
        setError("");
      }
    } catch (failure) {
      if (!signal.aborted && !onError(failure)) setError(errorMessage(failure));
    } finally {
      reading.current = false;
      if (refreshQueued.current && !signal.aborted) {
        refreshQueued.current = false;
        void refresh();
      }
    }
  }, [team.id, id, accept, onError]);

  const append = useCallback((batch: SessionEvent[]) => {
    const additions: SessionEvent[] = [];
    for (const event of batch) {
      const previousId = seen.current.get(event.sequence);
      if (previousId) {
        if (previousId !== event.id)
          throw new Error("Conflicting event replay");
        continue;
      }
      if (event.sequence !== cursor.current + 1)
        throw new Error("The event journal has a gap");
      seen.current.set(event.sequence, event.id);
      cursor.current = event.sequence;
      additions.push(event);
    }
    if (additions.length) setEvents((current) => [...current, ...additions]);
  }, []);

  // Manual reads, mutations, and terminal catch-up share one in-flight journal
  // page. Every response is checked by the API adapter and replay validator.
  const readEventPage =
    useCallback(async (): Promise<SessionEventLogResponse | null> => {
      const signal = controller.current?.signal;
      if (!signal || signal.aborted) return null;
      if (eventRead.current) return eventRead.current;
      const pending = sessionsApi
        .events(team.id, id, cursor.current, signal)
        .then((page) => {
          if (signal.aborted) return null;
          append(page.events);
          setNextAfter(page.nextAfter);
          return page;
        })
        .finally(() => {
          if (eventRead.current === pending) eventRead.current = null;
        });
      eventRead.current = pending;
      return pending;
    }, [team.id, id, append]);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void Promise.all([
      sessionsApi.get(team.id, id, request.signal),
      sessionsApi.events(team.id, id, 0, request.signal),
    ])
      .then(([detail, log]) => {
        if (request.signal.aborted) return;
        accept(detail.session);
        append(log.events);
        setNextAfter(log.nextAfter);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !onError(failure))
          setError(errorMessage(failure));
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => {
      request.abort();
      source.current?.close();
    };
  }, [team.id, id, accept, append, onError]);

  useEffect(() => {
    if (loading || !hasSession || !terminal) return;
    const signal = controller.current?.signal;
    if (!signal || signal.aborted) return;
    let active = true;
    // A terminal detail read can precede the last SSE batch. Catch up from the
    // verified cursor before claiming that saved history is current. The page
    // limit prevents malformed/endlessly growing journals from creating a loop.
    void (async () => {
      for (
        let pageIndex = 0;
        pageIndex < TERMINAL_EVENT_PAGE_LIMIT;
        pageIndex++
      ) {
        const before = cursor.current;
        const page = await readEventPage();
        if (!active || signal.aborted || !page) return;
        if (page.nextAfter === null) {
          setTerminalHistory("complete");
          return;
        }
        if (cursor.current <= before)
          throw new Error("The event journal did not advance.");
      }
      setTerminalHistory("paused");
      setError("More saved events remain. Load more events to continue.");
    })().catch((failure: unknown) => {
      if (!active || signal.aborted) return;
      setTerminalHistory("paused");
      if (!onError(failure))
        setError(
          `Saved event history could not be synchronized. ${errorMessage(failure)}`,
        );
    });
    return () => {
      active = false;
    };
  }, [loading, hasSession, terminal, readEventPage, onError]);

  useEffect(() => {
    if (!runnerId) return;
    const request = new AbortController();
    void computeApi
      .useAccess(team.id, runnerId, request.signal)
      .then((result) => {
        if (!request.signal.aborted)
          setRunnerRevoked(result.runner.revokedAt !== null);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !onError(failure))
          setError(errorMessage(failure));
      });
    return () => request.abort();
  }, [team.id, runnerId, revision, runnerAttempt, onError]);

  useEffect(() => {
    if (loading || !hasSession || terminal) return;
    if (!liveSupported) return;
    const stream = new EventSource(
      sessionEventsUrl(team.id, id, cursor.current),
    );
    source.current = stream;
    let active = true;
    let disposed = false;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    stream.onopen = () => {
      if (active) {
        reconnects.current = 0;
        setStreamMessage("Following saved events");
      }
    };
    stream.addEventListener("session", (message: MessageEvent<string>) => {
      if (!active) return;
      try {
        const event = parseSessionEvent(id, message.data, message.lastEventId);
        append([event]);
        if (refreshTimer) clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          if (active) void refresh();
        }, 100);
        if (isTerminal(event.state)) {
          stream.close();
          setStreamMessage("Session finished. Event stream closed.");
          void refresh();
        }
      } catch {
        stream.close();
        active = false;
        setStreamMessage(
          "An event could not be verified. Refresh the event log before reconnecting.",
        );
      }
    });
    stream.onerror = () => {
      if (!active) return;
      stream.close();
      active = false;
      setStreamMessage(
        "Live connection stopped. Checking current session access…",
      );
      // EventSource hides HTTP status. Reauthorize before bounded reconnects;
      // normal finite-stream closure must not leave a running session stale.
      const signal = controller.current?.signal;
      if (!signal || signal.aborted) return;
      void sessionsApi
        .get(team.id, id, signal)
        .then((result) => {
          if (!signal.aborted && !disposed) {
            accept(result.session);
            if (!isTerminal(result.session.state) && reconnects.current < 3) {
              const backoff = 1_000 * 2 ** reconnects.current++;
              setStreamMessage("Access checked. Reconnecting to saved events…");
              reconnectTimer = setTimeout(() => {
                if (!disposed && !signal.aborted)
                  setStreamAttempt((value) => value + 1);
              }, backoff);
            } else
              setStreamMessage(
                "Live connection paused. Refresh events or reconnect when ready.",
              );
          }
        })
        .catch((failure: unknown) => {
          if (!signal.aborted && !disposed && !onError(failure))
            setStreamMessage(
              `${errorMessage(failure)} Reconnect manually when the API is available.`,
            );
        });
    };
    return () => {
      disposed = true;
      active = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stream.close();
    };
    // A detail revision does not recreate the stream or reset its replay cursor.
  }, [
    team.id,
    id,
    loading,
    hasSession,
    terminal,
    streamAttempt,
    refresh,
    accept,
    append,
    onError,
    liveSupported,
  ]);

  async function loadEvents() {
    const signal = controller.current?.signal;
    if (!signal || signal.aborted || busy || writing.current) return;
    setBusy(true);
    setError("");
    if (terminal) setTerminalHistory("pending");
    try {
      const page = await readEventPage();
      if (signal.aborted || !page) return;
      if (terminal)
        setTerminalHistory(page.nextAfter === null ? "complete" : "paused");
      await refresh();
    } catch (failure) {
      if (!signal.aborted && terminal) setTerminalHistory("paused");
      if (!signal.aborted && !onError(failure)) setError(errorMessage(failure));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function mutate() {
    const signal = controller.current?.signal;
    if (
      !session ||
      !action ||
      !signal ||
      signal.aborted ||
      writing.current ||
      needsRefresh ||
      (action === "reconcile" && (!confirmedStopped || !runnerRevoked))
    )
      return;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result =
        action === "cancel"
          ? await sessionsApi.cancel(team.id, id, session.revision, signal)
          : await sessionsApi.reconcile(team.id, id, session.revision, signal);
      if (signal.aborted) return;
      accept(result.session);
      setAction(null);
      setConfirmedStopped(false);
      // Terminal transitions use the bounded catch-up effect; do not start a
      // second journal request from this mutation's response path.
      if (!isTerminal(result.session.state)) await readEventPage();
    } catch (failure) {
      if (!signal.aborted && !onError(failure)) {
        setError(
          `${errorMessage(failure)} Refresh the session before another change.`,
        );
        setNeedsRefresh(true);
        setAction(null);
      }
    } finally {
      writing.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  if (loading)
    return (
      <section className={styles.panel}>
        <p role="status">Loading saved session…</p>
      </section>
    );
  if (!session)
    return (
      <section className={styles.panel}>
        <p role="alert">{error || "This session could not be loaded."}</p>
        <button
          type="button"
          className={common.secondaryButton}
          onClick={() => {
            setRunnerAttempt((value) => value + 1);
            void refresh();
          }}
        >
          Retry session
        </button>
      </section>
    );
  const mayCancel =
    !terminal &&
    session.state !== "cancelling" &&
    (team.role === "admin" ||
      (session.startedBy === userId && team.role === "developer"));
  const mayReconcile =
    team.role === "admin" &&
    (session.state === "blocked" || session.state === "cancelling");
  return (
    <section className={styles.panel} aria-labelledby="session-detail-heading">
      <h2 id="session-detail-heading">{session.flowName}</h2>
      <span className={styles.state}>{session.state}</span>
      <code className={styles.code}>{session.id}</code>
      <p className={styles.hint}>
        Runtime: stub.v1 · quality: not_evaluated. Outputs are deterministic
        placeholders; they do not establish test success or completed agent
        work.
      </p>
      {error && (
        <p className={common.fieldError} role="alert">
          {error}
        </p>
      )}
      <dl className={styles.facts}>
        <div>
          <dt>Flow version</dt>
          <dd>{session.flowVersionId}</dd>
        </div>
        <div>
          <dt>Workspace version</dt>
          <dd>
            {session.snapshot.workspace.definition.name}
            <code className={styles.code}>
              {session.snapshot.workspace.versionId}
            </code>
          </dd>
        </div>
        <div>
          <dt>Runner</dt>
          <dd>{session.runnerId}</dd>
        </div>
        <div>
          <dt>Revision</dt>
          <dd>{session.revision}</dd>
        </div>
        <div>
          <dt>Started by</dt>
          <dd>{session.startedBy}</dd>
        </div>
        <div>
          <dt>Recovery reason</dt>
          <dd>{session.blockReason ?? "None"}</dd>
        </div>
      </dl>
      <div className={styles.actions}>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy}
          onClick={() => {
            setRunnerAttempt((value) => value + 1);
            void refresh();
          }}
        >
          Refresh session
        </button>
        {mayCancel && (
          <button
            type="button"
            className={common.secondaryButton}
            disabled={busy || needsRefresh}
            onClick={() => setAction("cancel")}
          >
            Cancel session
          </button>
        )}
        {mayReconcile && (
          <button
            type="button"
            className={common.secondaryButton}
            disabled={busy || needsRefresh}
            onClick={() => {
              setAction("reconcile");
              setConfirmedStopped(false);
            }}
          >
            Reconcile stopped stub
          </button>
        )}
      </div>
      {action && (
        <div
          className={styles.confirm}
          role="group"
          aria-label={
            action === "cancel"
              ? "Confirm cancellation"
              : "Confirm reconciliation"
          }
        >
          <p>
            {action === "cancel"
              ? `Cancel session ${session.id}? Queued work cancels immediately; a held lease remains reserved until stopped confirmation.`
              : `Reconcile session ${session.id}? First revoke its runner in Compute, then confirm the stub process has stopped. This releases its held reservation.`}
          </p>
          {action === "reconcile" && (
            <>
              <p className={styles.hint}>
                {runnerRevoked
                  ? "The runner is revoked."
                  : "The runner is not confirmed revoked. Revoke it in Compute, then refresh this session."}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={confirmedStopped}
                  onChange={(event) =>
                    setConfirmedStopped(event.target.checked)
                  }
                />
                I confirm the deterministic stub has stopped.
              </label>
            </>
          )}
          <div className={styles.actions}>
            <button
              type="button"
              className={common.secondaryButton}
              disabled={
                busy ||
                (action === "reconcile" &&
                  (!confirmedStopped || !runnerRevoked))
              }
              onClick={() => void mutate()}
            >
              {action === "cancel"
                ? "Confirm cancel"
                : "Confirm reconciliation"}
            </button>
            <button
              type="button"
              className={common.secondaryButton}
              disabled={busy}
              onClick={() => setAction(null)}
            >
              Keep session
            </button>
          </div>
        </div>
      )}
      <h3>
        Stage progress · {session.stageIndex}/
        {session.snapshot.flow.definition.stages.length}
      </h3>
      <ol className={styles.stages}>
        {session.snapshot.flow.definition.stages.map((stage, index) => (
          <li key={stage.id}>
            <strong>{stage.name}</strong> ·{" "}
            {Object.hasOwn(session.stageResults, stage.id)
              ? "completed"
              : index === session.stageIndex && session.state === "running"
                ? "running"
                : "pending"}
            <code className={styles.code}>
              Agent version {stage.agent.versionId}
            </code>
            {session.stageResults[stage.id] && (
              <pre className={styles.output}>
                {JSON.stringify(session.stageResults[stage.id], null, 2)}
              </pre>
            )}
          </li>
        ))}
      </ol>
      <details>
        <summary>Saved input values</summary>
        <pre className={styles.output}>
          {JSON.stringify(session.inputValues, null, 2)}
        </pre>
      </details>
      <h3>Final outputs</h3>
      {session.outputs ? (
        <pre className={styles.output}>
          {JSON.stringify(session.outputs, null, 2)}
        </pre>
      ) : (
        <p className={styles.hint}>No final outputs are saved.</p>
      )}
      <h3>Durable event log</h3>
      <p className={styles.hint} role="status">
        {terminal
          ? terminalHistory === "complete"
            ? "Session finished. Saved event history is up to date."
            : terminalHistory === "paused"
              ? "Session finished. Saved event history needs a refresh."
              : "Session finished. Synchronizing saved event history…"
          : !liveSupported
            ? "Live events are unavailable. Refresh the event log manually."
            : streamMessage}
      </p>
      {events.length ? (
        <ol className={styles.events}>
          {events.map((event) => (
            <li key={event.id} value={event.sequence}>
              {event.kind} · {event.state} · stage {event.stageIndex}
              <time className={styles.code} dateTime={event.createdAt}>
                {new Date(event.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.hint}>No events loaded.</p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || (terminal && terminalHistory === "pending")}
          onClick={() => void loadEvents()}
        >
          {nextAfter !== null ? "Load more events" : "Refresh event log"}
        </button>
        {!terminal && (
          <button
            type="button"
            className={common.secondaryButton}
            disabled={busy}
            onClick={() => setStreamAttempt((value) => value + 1)}
          >
            Reconnect live events
          </button>
        )}
      </div>
    </section>
  );
}
