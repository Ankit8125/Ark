import type { Team } from "@ark/contracts";
import { LoaderCircle, Plus, RefreshCw, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { canEditCatalog } from "./permissions";
import styles from "./catalog.module.css";

type Summary = {
  id: string;
  name: string;
  revision: number;
  schemaVersion: number;
  updatedAt: string;
};
export type CatalogPage = { items: Summary[]; nextCursor: string | null };
export function CatalogList({
  team,
  onExpired,
  kind,
  plural,
  title,
  description,
  createDescription,
  icon: Icon,
  loadPage,
}: {
  team: Team;
  onExpired: () => void;
  kind: "workspace" | "agent" | "flow";
  plural: "workspaces" | "agents" | "flows";
  title: string;
  description: string;
  createDescription: string;
  icon: LucideIcon;
  loadPage: (
    teamId: string,
    cursor?: string,
    signal?: AbortSignal,
  ) => Promise<CatalogPage>;
}) {
  const [page, setPage] = useState<CatalogPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const loadingMore = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void loadPage(team.id, undefined, controller.signal)
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
  }, [team.id, attempt, onExpired, loadPage]);

  async function more() {
    if (!page?.nextCursor || loadingMore.current) return;
    loadingMore.current = true;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const next = await loadPage(team.id, page.nextCursor, controller.signal);
      if (!controller.signal.aborted)
        setPage(
          (current) =>
            current && {
              items: [
                ...new Map(
                  [...current.items, ...next.items].map((item) => [
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
          <h1>{title}</h1>
          <p>{description}</p>
        </div>
        {canEditCatalog(team) && (
          <Link
            className={`${common.primaryButton} ${styles.fitButton}`}
            to={`/${plural}/new`}
          >
            <Plus size={16} aria-hidden="true" />
            New {kind}
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
          <p>Loading {plural}…</p>
        </section>
      ) : page?.items.length === 0 ? (
        <section className={common.statusPanel}>
          <Icon size={28} aria-hidden="true" />
          <h2>No {plural} yet</h2>
          <p>
            {canEditCatalog(team)
              ? createDescription
              : `A team admin or developer can create your first ${kind}.`}
          </p>
        </section>
      ) : (
        page && (
          <section className={styles.listPanel} aria-label={`Team ${plural}`}>
            <div className={styles.listHeading}>
              <h2>{team.name}</h2>
              <span>{page.items.length} loaded</span>
            </div>
            <ul className={styles.list}>
              {page.items.map((item) => (
                <li key={item.id}>
                  <Link
                    to={`/${plural}/${item.id}`}
                    className={styles.resourceRow}
                  >
                    <Icon size={19} aria-hidden="true" />
                    <span className={styles.resourceName}>
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
