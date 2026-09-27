import { ArrowLeft, LoaderCircle, Save } from "lucide-react";
import type { ChangeEvent, ReactNode } from "react";
import { Link } from "react-router-dom";
import common from "../../App.module.css";
import { canEditCatalog } from "./permissions";
import type { CatalogRecord, VersionedEditor } from "./useVersionedEditor";
import styles from "./catalog.module.css";

export function CatalogEditor<Definition, RecordType extends CatalogRecord>({
  editor,
  children,
}: {
  editor: VersionedEditor<Definition, RecordType>;
  children: ReactNode;
}) {
  const {
    config,
    team,
    record,
    busy,
    dirty,
    loading,
    resourceId,
    loadError,
    retryLoad,
    supported,
    formRef,
    submit,
    writeDenied,
    message,
    errorRef,
    conflict,
    loadLatest,
    keepAsNew,
    saving,
    success,
    writable,
  } = editor;
  if (loading && !record && resourceId)
    return (
      <section className={common.statusPanel} role="status">
        <LoaderCircle size={24} className={common.spinner} aria-hidden="true" />
        <p>Loading {config.kind}…</p>
      </section>
    );
  if (loadError && !record)
    return (
      <section className={common.statusPanel}>
        <h1>Couldn’t open this {config.kind}</h1>
        <p role="alert">{loadError}</p>
        <div className={common.buttonRow}>
          <button
            type="button"
            className={common.secondaryButton}
            onClick={retryLoad}
          >
            Retry
          </button>
          <Link className={common.secondaryButton} to={`/${config.plural}`}>
            All {config.plural}
          </Link>
        </div>
      </section>
    );
  return (
    <>
      <Link className={styles.backLink} to={`/${config.plural}`}>
        <ArrowLeft size={15} aria-hidden="true" />
        All {config.plural}
      </Link>
      <div className={common.pageHeading}>
        <div>
          <div className={common.eyebrow}>Build · {team.name}</div>
          <h1>{record?.name ?? `New ${config.kind}`}</h1>
          <p>
            {record
              ? `Revision ${record.revision} · Saved configuration`
              : config.createDescription}
          </p>
        </div>
      </div>
      {!supported ? (
        <section className={styles.formPanel}>
          <h2>This definition is read-only</h2>
          <p className={styles.sectionHint}>
            Its schema is newer than this editor, or its saved fields are
            unsupported. The complete definition is shown below and will not be
            rewritten.
          </p>
          <pre className={styles.rawDefinition}>
            {JSON.stringify(record?.definition, null, 2)}
          </pre>
        </section>
      ) : (
        <form
          ref={formRef}
          className={styles.editor}
          onSubmit={(event) => void submit(event)}
          noValidate
          aria-busy={busy}
        >
          {(!canEditCatalog(team) || writeDenied) && (
            <div className={styles.notice} role="status">
              You have read-only access. A current team admin or developer can
              save {config.kind} changes.
              {dirty && " Your unsaved draft is still displayed."}
            </div>
          )}
          {message && (
            <div
              ref={errorRef}
              className={styles.message}
              role="alert"
              tabIndex={-1}
            >
              <p>{message}</p>
              {conflict && (
                <>
                  <p>
                    Your draft has been kept. Loading the saved version replaces
                    it.
                  </p>
                  <div className={common.buttonRow}>
                    <button
                      className={common.secondaryButton}
                      type="button"
                      disabled={busy}
                      onClick={() => void loadLatest()}
                    >
                      {conflict === "identity"
                        ? `Load saved ${config.kind}`
                        : "Load latest"}
                    </button>
                    {conflict === "identity" && (
                      <button
                        className={common.secondaryButton}
                        type="button"
                        disabled={busy}
                        onClick={keepAsNew}
                      >
                        Keep draft as new
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          {children}
          <div className={styles.saveBar}>
            <div role="status">
              {saving
                ? `Saving ${config.kind}…`
                : loading
                  ? `Loading saved ${config.kind}…`
                  : success ||
                    (dirty
                      ? "Unsaved changes"
                      : record
                        ? "All changes saved"
                        : "Not saved yet")}
            </div>
            {writable && (
              <button
                className={`${common.primaryButton} ${styles.fitButton}`}
                type="submit"
                disabled={busy}
              >
                {saving ? (
                  <LoaderCircle
                    className={common.spinner}
                    size={16}
                    aria-hidden="true"
                  />
                ) : (
                  <Save size={16} aria-hidden="true" />
                )}
                {saving
                  ? "Saving…"
                  : record
                    ? "Save changes"
                    : `Create ${config.kind}`}
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}

export function CatalogField({
  kind,
  name,
  label,
  value,
  error,
  writable,
  busy,
  onChange,
  hint,
  multiline,
  maxLength,
  required,
  placeholder,
  type = "text",
  rows = 3,
  code = false,
}: {
  kind: "workspace" | "agent";
  name: string;
  label: string;
  value: string;
  error?: string;
  writable: boolean;
  busy: boolean;
  onChange: (value: string) => void;
  hint?: string;
  multiline?: boolean;
  maxLength: number;
  required?: boolean;
  placeholder?: string;
  type?: string;
  rows?: number;
  code?: boolean;
}) {
  const id = `${kind}-${name.replaceAll(".", "-")}`;
  const props = {
    id,
    name,
    value,
    maxLength,
    required,
    readOnly: !writable,
    disabled: busy,
    autoComplete: "off",
    spellCheck: name === "description" || name === "instructions",
    placeholder,
    "aria-invalid": Boolean(error),
    "aria-describedby":
      [hint && `${id}-hint`, error && `${id}-error`]
        .filter(Boolean)
        .join(" ") || undefined,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(event.target.value),
  };
  return (
    <div className={styles.field}>
      <label htmlFor={id}>
        {label}
        {!required && <span>Optional</span>}
      </label>
      {multiline ? (
        <textarea
          {...props}
          rows={rows}
          className={code ? styles.codeInput : undefined}
        />
      ) : (
        <input {...props} type={type} />
      )}
      {hint && (
        <p id={`${id}-hint`} className={common.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} className={common.fieldError}>
          {error}
        </p>
      )}
    </div>
  );
}
