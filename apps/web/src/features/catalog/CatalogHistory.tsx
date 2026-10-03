import { History, LoaderCircle } from "lucide-react";
import common from "../../App.module.css";
import type { CatalogRecord, VersionedEditor } from "./useVersionedEditor";
import styles from "./catalog.module.css";

export function CatalogHistory<Definition, RecordType extends CatalogRecord>({
  editor,
}: {
  editor: VersionedEditor<Definition, RecordType>;
}) {
  const {
    record,
    config,
    busy,
    writable,
    supported,
    conflict,
    historyOpen,
    versions,
    nextVersionCursor,
    selectedVersion,
    selectedVersionSupported,
    historyLoading,
    historyError,
    restoreFailed,
    restoring,
    loadHistory,
    previewVersion,
    closeHistory,
    restoreVersion,
    loadLatest,
  } = editor;
  if (!record) return null;
  return (
    <section
      className={styles.historyPanel}
      aria-labelledby="catalog-history-heading"
      aria-busy={historyLoading !== null || restoring}
    >
      <div className={styles.historyHeading}>
        <h2 id="catalog-history-heading">
          <History size={16} aria-hidden="true" />
          Revision history
        </h2>
        <button
          type="button"
          className={`${common.secondaryButton} ${styles.fitButton}`}
          disabled={busy}
          onClick={() => (historyOpen ? closeHistory() : void loadHistory())}
          aria-expanded={historyOpen}
          aria-controls="catalog-history-content"
        >
          {historyOpen ? "Hide history" : "Browse history"}
        </button>
      </div>
      {historyOpen && (
        <div id="catalog-history-content" className={styles.historyContent}>
          <p className={styles.sectionHint}>
            Select a saved revision to inspect its complete configuration.
            Restore creates a new revision from that snapshot.
          </p>
          {historyError && (
            <div className={styles.message} role="alert">
              <p>{historyError}</p>
              <button
                className={`${common.secondaryButton} ${styles.fitButton}`}
                type="button"
                disabled={busy}
                onClick={() => void loadHistory()}
              >
                Retry history
              </button>
            </div>
          )}
          {historyLoading && (
            <p role="status" className={styles.historyStatus}>
              <LoaderCircle
                size={16}
                className={common.spinner}
                aria-hidden="true"
              />
              {historyLoading === "list"
                ? "Loading revisions…"
                : "Loading revision preview…"}
            </p>
          )}
          <ol className={styles.versionList} aria-label="Saved revisions">
            {versions.map((version) => (
              <li key={version.versionId}>
                <button
                  type="button"
                  className={styles.versionButton}
                  aria-pressed={
                    selectedVersion?.versionId === version.versionId
                  }
                  disabled={busy}
                  onClick={() => void previewVersion(version.versionId)}
                >
                  <strong>Revision {version.revision}</strong>
                  <span>
                    Schema {version.schemaVersion}
                    {version.revision === record.revision ? " · Current" : ""}
                  </span>
                  <time dateTime={version.createdAt}>
                    {new Date(version.createdAt).toLocaleString()}
                  </time>
                </button>
              </li>
            ))}
          </ol>
          {nextVersionCursor !== null && (
            <button
              type="button"
              className={`${common.secondaryButton} ${styles.fitButton}`}
              disabled={busy}
              onClick={() => void loadHistory(nextVersionCursor)}
            >
              Load older revisions
            </button>
          )}
          {!historyLoading && !historyError && versions.length === 0 && (
            <p role="status">No saved revisions were returned.</p>
          )}
          {selectedVersion && (
            <section
              className={styles.versionPreview}
              aria-labelledby="catalog-preview-heading"
            >
              <h3 id="catalog-preview-heading">
                Revision {selectedVersion.revision} preview
              </h3>
              <p className={styles.sectionHint}>
                Schema {selectedVersion.schemaVersion} · Saved{" "}
                <time dateTime={selectedVersion.createdAt}>
                  {new Date(selectedVersion.createdAt).toLocaleString()}
                </time>
              </p>
              {!selectedVersionSupported && (
                <p className={styles.notice} role="status">
                  This revision is read-only because its schema or fields are
                  unsupported by this editor.
                </p>
              )}
              {!supported && (
                <p className={styles.notice} role="status">
                  The current definition is unsupported, so this editor cannot
                  restore a revision.
                </p>
              )}
              <pre
                className={styles.rawDefinition}
                aria-label={`Revision ${selectedVersion.revision} definition`}
              >
                {JSON.stringify(selectedVersion.definition, null, 2)}
              </pre>
              {writable && selectedVersionSupported && (
                <div className={styles.restoreActions}>
                  <p className={styles.sectionHint}>
                    Restoring replaces the editor draft and saves a new
                    immutable revision.
                    {config.kind === "flow" &&
                      " Flow dependencies are checked again before saving."}
                  </p>
                  <button
                    type="button"
                    className={`${common.secondaryButton} ${styles.fitButton}`}
                    disabled={busy || conflict !== null}
                    onClick={() => void restoreVersion()}
                  >
                    {restoring
                      ? "Restoring…"
                      : `Restore revision ${selectedVersion.revision}`}
                  </button>
                </div>
              )}
            </section>
          )}
          {restoreFailed && (
            <div className={styles.notice} role="status">
              <p>
                Your draft is still displayed. If the restore response was lost,
                load latest to check the saved revision before restoring again.
              </p>
              {!conflict && (
                <button
                  type="button"
                  className={`${common.secondaryButton} ${styles.fitButton}`}
                  disabled={busy}
                  onClick={() => void loadLatest()}
                >
                  Load latest
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
