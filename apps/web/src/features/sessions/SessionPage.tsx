import {
  type ExecutionSession,
  type SessionListResponse,
  type Team,
} from "@ark/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { sessionsApi } from "./api";
import { NewSessionForm } from "./NewSessionForm";
import { SessionDetail } from "./SessionDetail";
import styles from "./sessions.module.css";
import type { DraftStatus } from "../catalog/useVersionedEditor";

type Props = {
  team: Team;
  userId: string;
  onExpired: () => void;
  onDraftStatus?: (status: DraftStatus) => void;
};

export function SessionPage(props: Props) {
  return (
    <SessionContent
      key={`${props.team.id}:${props.team.role}:${props.userId}`}
      {...props}
    />
  );
}

function SessionContent({ team, userId, onExpired, onDraftStatus }: Props) {
  const [page, setPage] = useState<SessionListResponse | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [restricted, setRestricted] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const expiration = useRef(onExpired);
  useEffect(() => {
    expiration.current = onExpired;
  }, [onExpired]);

  const handleError = useCallback((failure: unknown) => {
    if (
      failure instanceof ApiRequestError &&
      [401, 403, 404].includes(failure.status)
    ) {
      controller.current?.abort();
      setPage(null);
      setSelected(null);
      setRestricted(true);
      setError(
        "Current session access was denied. Refresh your team access before continuing.",
      );
      if (failure.status === 401) expiration.current();
      return true;
    }
    return false;
  }, []);

  const changed = useCallback((session: ExecutionSession) => {
    setPage((current) =>
      current
        ? {
            ...current,
            sessions: current.sessions.some((item) => item.id === session.id)
              ? current.sessions.map((item) =>
                  item.id === session.id && item.revision <= session.revision
                    ? session
                    : item,
                )
              : [session, ...current.sessions],
          }
        : { sessions: [session], nextCursor: null },
    );
  }, []);

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void sessionsApi
      .list(team.id, undefined, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setPage(value);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !handleError(failure))
          setError(errorMessage(failure));
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [team.id, attempt, handleError]);

  async function more() {
    const signal = controller.current?.signal;
    if (!page?.nextCursor || !signal || signal.aborted || loading) return;
    setLoading(true);
    setError("");
    try {
      const result = await sessionsApi.list(team.id, page.nextCursor, signal);
      if (!signal.aborted)
        setPage(
          (current) =>
            current && {
              sessions: [
                ...current.sessions,
                ...result.sessions.filter(
                  (item) =>
                    !current.sessions.some(
                      (existing) => existing.id === item.id,
                    ),
                ),
              ],
              nextCursor: result.nextCursor,
            },
        );
    } catch (failure) {
      if (!signal.aborted && !handleError(failure))
        setError(errorMessage(failure));
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }

  return (
    <div className={styles.layout}>
      <div className={common.pageHeading}>
        <div>
          <div className={common.eyebrow}>Run</div>
          <h1>Sessions</h1>
          <p>Saved deterministic work and its durable event history.</p>
        </div>
      </div>
      {restricted ? (
        <section className={styles.panel}>
          <h2>Session access restricted</h2>
          <p role="alert">{error}</p>
        </section>
      ) : (
        <>
          {team.role === "admin" || team.role === "developer" ? (
            <NewSessionForm
              team={team}
              onDraftStatus={onDraftStatus}
              onStarted={(session) => {
                changed(session);
                setSelected(session.id);
              }}
              onError={handleError}
            />
          ) : (
            <p className={styles.hint}>
              Your team role can read saved sessions. Starting work requires an
              admin or developer role and an explicit runner use grant.
            </p>
          )}
          <div className={styles.columns}>
            <section
              className={styles.panel}
              aria-labelledby="session-list-heading"
            >
              <h2 id="session-list-heading">Team sessions · {team.name}</h2>
              <button
                type="button"
                className={common.secondaryButton}
                disabled={loading}
                onClick={() => {
                  setLoading(true);
                  setError("");
                  setAttempt((value) => value + 1);
                }}
              >
                Refresh sessions
              </button>
              {error && (
                <p className={common.fieldError} role="alert">
                  {error}
                </p>
              )}
              {loading && (
                <p className={styles.hint} role="status">
                  Loading sessions…
                </p>
              )}
              {page?.sessions.length ? (
                <ul className={styles.list}>
                  {page.sessions.map((session) => (
                    <li key={session.id}>
                      <button
                        type="button"
                        className={styles.row}
                        aria-pressed={selected === session.id}
                        onClick={() => setSelected(session.id)}
                      >
                        <strong>{session.flowName}</strong>
                        <span>
                          {session.state} · stage {session.stageIndex} ·
                          not_evaluated
                        </span>
                        <code className={styles.code}>{session.id}</code>
                        <time dateTime={session.createdAt}>
                          {new Date(session.createdAt).toLocaleString()}
                        </time>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                !loading && (
                  <p className={styles.hint}>
                    No sessions saved for this team.
                  </p>
                )
              )}
              {page?.nextCursor && (
                <button
                  type="button"
                  className={common.secondaryButton}
                  disabled={loading}
                  onClick={() => void more()}
                >
                  Load more sessions
                </button>
              )}
            </section>
            {selected ? (
              <SessionDetail
                key={selected}
                team={team}
                userId={userId}
                id={selected}
                onChanged={changed}
                onError={handleError}
              />
            ) : (
              <section className={styles.panel}>
                <h2>Follow a saved session</h2>
                <p className={styles.hint}>
                  Select a session to inspect its pinned versions, stage
                  outputs, recovery state, and event history.
                </p>
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
