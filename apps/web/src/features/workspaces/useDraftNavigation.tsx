import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import type { DraftStatus } from "./WorkspaceEditor";
import common from "../../App.module.css";
import styles from "./workspaces.module.css";

export function useDraftNavigation() {
  const draftRef = useRef<DraftStatus>({ dirty: false, busy: false });
  const [draftStatus, setDraftStatus] = useState<DraftStatus>({
    dirty: false,
    busy: false,
  });
  const stayRef = useRef<HTMLButtonElement>(null);
  const onDraftStatus = useCallback((status: DraftStatus) => {
    draftRef.current = status;
    setDraftStatus((current) =>
      current.dirty === status.dirty && current.busy === status.busy
        ? current
        : status,
    );
  }, []);
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        (draftRef.current.dirty || draftRef.current.busy) &&
        `${currentLocation.pathname}${currentLocation.search}` !==
          `${nextLocation.pathname}${nextLocation.search}`,
      [],
    ),
  );
  useEffect(() => {
    if (blocker.state === "blocked") stayRef.current?.focus();
  }, [blocker.state]);

  function confirmLeave() {
    if (draftRef.current.busy) return false;
    if (
      draftRef.current.dirty &&
      !window.confirm("Discard your unsaved workspace changes and leave?")
    )
      return false;
    return true;
  }

  const prompt =
    blocker.state === "blocked" ? (
      <section
        className={styles.notice}
        role="alertdialog"
        aria-labelledby="leave-workspace-heading"
        aria-describedby="leave-workspace-description"
      >
        <h2 id="leave-workspace-heading">
          {draftStatus.busy
            ? "A request is still in progress"
            : "Leave this workspace?"}
        </h2>
        <p id="leave-workspace-description">
          {draftStatus.busy
            ? "Wait for the request to finish before leaving this page."
            : draftStatus.dirty
              ? "Your unsaved changes will be discarded."
              : "Your changes are saved. You can leave this page."}
        </p>
        <div className={common.buttonRow}>
          <button
            ref={stayRef}
            type="button"
            className={common.secondaryButton}
            onClick={() => blocker.reset()}
          >
            Stay here
          </button>
          <button
            type="button"
            className={common.secondaryButton}
            disabled={draftStatus.busy}
            onClick={() => {
              onDraftStatus({ dirty: false, busy: false });
              blocker.proceed();
            }}
          >
            {draftStatus.dirty ? "Discard and leave" : "Leave page"}
          </button>
        </div>
      </section>
    ) : null;
  return { onDraftStatus, confirmLeave, prompt, draftStatus };
}
