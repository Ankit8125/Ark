import type { Team, WorkspaceListResponse } from "@ark/contracts";
import { FolderGit2, LoaderCircle, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { workspaceApi } from "./api";
import styles from "./workspaces.module.css";
import { canEditWorkspaces } from "./permissions";

export function WorkspaceList({
  team,
  onExpired,
}: {
  team: Team;
  onExpired: () => void;
}) {
  const [page, setPage] = useState<WorkspaceListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const loadingMore = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void workspaceApi
      .list(team.id, undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setPage(result);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 401)
          onExpired();
        else setMessage(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [team.id, attempt, onExpired]);

  async function more() {
    if (!page?.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const next = await workspaceApi.list(
        team.id,
        page.nextCursor,
        controller.signal,
      );
      if (!controller.signal.aborted)
        setPage(
          (current) =>
            current && {
              workspaces: [
                ...new Map(
                  [...current.workspaces, ...next.workspaces].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
              nextCursor: next.nextCursor,
            },
        );
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else setMessage(errorMessage(error));
    } finally {
      loadingMore.current = false;
      if (!controller.signal.aborted) setLoading(false);
    }
  }

  return (
    <>
      <div className={common.pageHeading}>
        <div>
          <div className={common.eyebrow}>Build</div>
          <h1>Workspaces</h1>
          <p>Repository, environment, and actions for your team’s work.</p>
        </div>
        {canEditWorkspaces(team) && (
          <Link
            className={`${common.primaryButton} ${styles.fitButton}`}
            to="/workspaces/new"
          >
            <Plus size={16} aria-hidden="true" />
            New workspace
          </Link>
        )}
      </div>
      {message && (
        <div className={styles.message} role="alert">
          <p>{message}</p>
          {!page && (
            <button
              className={common.secondaryButton}
              type="button"
              onClick={() => {
                setMessage("");
                setLoading(true);
                setAttempt((value) => value + 1);
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              Retry
            </button>
          )}
        </div>
      )}
      {!page && loading ? (
        <section className={common.statusPanel} role="status">
          <LoaderCircle
            className={common.spinner}
            size={24}
            aria-hidden="true"
          />
          <p>Loading workspaces…</p>
        </section>
      ) : page?.workspaces.length === 0 ? (
        <section className={common.statusPanel}>
          <FolderGit2 size={28} aria-hidden="true" />
          <h2>No workspaces yet</h2>
          <p>
            {canEditWorkspaces(team)
              ? "Create a workspace to save the repository and commands your team will use."
              : "A team admin or developer can create your first workspace."}
          </p>
        </section>
      ) : (
        page && (
          <section className={styles.listPanel} aria-label="Team workspaces">
            <div className={styles.listHeading}>
              <h2>{team.name}</h2>
              <span>{page.workspaces.length} loaded</span>
            </div>
            <ul className={styles.list}>
              {page.workspaces.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/workspaces/${item.id}`}
                    className={styles.workspaceRow}
                  >
                    <FolderGit2 size={19} aria-hidden="true" />
                    <span className={styles.workspaceName}>
                      <strong>{item.name}</strong>
                      <span>
                        Revision {item.revision} · Schema {item.schemaVersion}
                      </span>
                    </span>
                    <time dateTime={item.updatedAt}>
                      {new Intl.DateTimeFormat(undefined, {
                        dateStyle: "medium",
                      }).format(new Date(item.updatedAt))}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
            {page.nextCursor && (
              <div className={styles.listFooter}>
                <button
                  className={common.secondaryButton}
                  type="button"
                  disabled={loading}
                  onClick={() => void more()}
                >
                  {loading ? "Loading…" : "Load more"}
                </button>
              </div>
            )}
          </section>
        )
      )}
    </>
  );
}
