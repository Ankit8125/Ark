import {
  WorkspaceDefinitionSchema,
  type Team,
  type Workspace,
  type WorkspaceDefinition,
} from "@ark/contracts";
import { ArrowLeft, LoaderCircle, Save } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { workspaceApi } from "./api";
import { canEditWorkspaces } from "./permissions";
import styles from "./workspaces.module.css";

export type DraftStatus = { dirty: boolean; busy: boolean };
type Props = {
  team: Team;
  workspaceId?: string;
  onExpired: () => void;
  onDraftStatus: (status: DraftStatus) => void;
};
type FieldName =
  | Exclude<keyof WorkspaceDefinition, "actions">
  | `actions.${keyof WorkspaceDefinition["actions"]}`;
const emptyDefinition = (): WorkspaceDefinition => ({
  name: "",
  description: "",
  repositoryUrl: "",
  sourceRef: "main",
  defaultBranch: "main",
  sandboxImage: "",
  workingDirectory: ".",
  actions: { install: "", test: "", lint: "", build: "" },
});

export function WorkspaceEditor({
  team,
  workspaceId,
  onExpired,
  onDraftStatus,
}: Props) {
  const navigate = useNavigate();
  const [creationId, setCreationId] = useState(() => crypto.randomUUID());
  const [record, setRecord] = useState<Workspace | null>(null);
  const [draft, setDraft] = useState(emptyDefinition);
  const [savedDefinition, setSavedDefinition] = useState(() =>
    JSON.stringify(emptyDefinition()),
  );
  const [loading, setLoading] = useState(Boolean(workspaceId));
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [message, setMessage] = useState("");
  const [success, setSuccess] = useState("");
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [conflict, setConflict] = useState<
    "revision" | "identity" | "schema" | null
  >(null);
  const [writeDenied, setWriteDenied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const saveInFlight = useRef(false);
  const mounted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== savedDefinition;
  const busy = loading || saving;
  const supported =
    !record ||
    (record.schemaVersion === 1 &&
      WorkspaceDefinitionSchema.safeParse(record.definition).success);
  const writable =
    canEditWorkspaces(team) &&
    supported &&
    !writeDenied &&
    conflict !== "schema";

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current?.abort();
      onDraftStatus({ dirty: false, busy: false });
    };
  }, [onDraftStatus]);

  useEffect(() => {
    onDraftStatus({ dirty, busy });
  }, [dirty, busy, onDraftStatus]);
  useEffect(() => {
    if (!dirty && !saving) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, saving]);

  useEffect(() => {
    if (!workspaceId) return;
    const controller = new AbortController();
    request.current = controller;
    void workspaceApi
      .get(team.id, workspaceId, controller.signal)
      .then((workspace) => {
        if (controller.signal.aborted) return;
        setRecord(workspace);
        const parsed =
          workspace.schemaVersion === 1
            ? WorkspaceDefinitionSchema.safeParse(workspace.definition)
            : null;
        if (parsed?.success) {
          setDraft(parsed.data);
          setSavedDefinition(JSON.stringify(parsed.data));
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ApiRequestError && error.status === 401)
          onExpired();
        else setLoadError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [team.id, workspaceId, attempt, onExpired]);

  function focusError(fields: Record<string, string[]>) {
    requestAnimationFrame(() => {
      if (!mounted.current) return;
      const field = formRef.current?.elements.namedItem(
        Object.keys(fields)[0] ?? "",
      );
      if (field instanceof HTMLElement) field.focus();
      else errorRef.current?.focus();
    });
  }

  function change(name: FieldName, value: string) {
    const next = name.startsWith("actions.")
      ? { ...draft, actions: { ...draft.actions, [name.slice(8)]: value } }
      : { ...draft, [name]: value };
    setDraft(next);
    setSuccess("");
    onDraftStatus({ dirty: JSON.stringify(next) !== savedDefinition, busy });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || busy || saveInFlight.current) return;
    setErrors({});
    setMessage("");
    setSuccess("");
    const parsed = WorkspaceDefinitionSchema.safeParse(draft);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues)
        (fields[issue.path.join(".")] ??= []).push(issue.message);
      setErrors(fields);
      setMessage("Check the highlighted fields.");
      focusError(fields);
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    saveInFlight.current = true;
    setSaving(true);
    onDraftStatus({ dirty, busy: true });
    try {
      const workspace = record
        ? await workspaceApi.update(
            team.id,
            record.id,
            {
              revision: record.revision,
              schemaVersion: 1,
              definition: parsed.data,
            },
            controller.signal,
          )
        : await workspaceApi.create(
            team.id,
            { id: creationId, schemaVersion: 1, definition: parsed.data },
            controller.signal,
          );
      if (controller.signal.aborted || !mounted.current) return;
      const result = WorkspaceDefinitionSchema.safeParse(workspace.definition);
      if (workspace.schemaVersion !== 1 || !result.success)
        throw new ApiRequestError(
          502,
          "INVALID_RESPONSE",
          "Ark returned an unexpected saved definition. Your draft is still here; load the saved workspace to check it.",
        );
      setRecord(workspace);
      setDraft(result.data);
      setSavedDefinition(JSON.stringify(result.data));
      setConflict(null);
      setSuccess(`Saved revision ${workspace.revision}.`);
      onDraftStatus({ dirty: false, busy: false });
      if (!workspaceId)
        void navigate(`/workspaces/${workspace.id}`, { replace: true });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401) {
        onExpired();
        return;
      }
      const fields: Record<string, string[]> = {};
      if (error instanceof ApiRequestError) {
        for (const [key, value] of Object.entries(error.fieldErrors))
          fields[key.replace(/^definition\./, "")] = value;
        if (error.code === "REVISION_CONFLICT") setConflict("revision");
        if (error.code === "ID_CONFLICT") setConflict("identity");
        if (error.code === "UNSUPPORTED_SCHEMA_VERSION") setConflict("schema");
        if (error.status === 403) setWriteDenied(true);
      }
      setErrors(fields);
      setMessage(errorMessage(error));
      focusError(fields);
    } finally {
      saveInFlight.current = false;
      if (!controller.signal.aborted && mounted.current) setSaving(false);
    }
  }

  async function loadLatest() {
    if (
      busy ||
      !window.confirm(
        "Discard your unsaved changes and load the saved workspace?",
      )
    )
      return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const workspace = await workspaceApi.get(
        team.id,
        record?.id ?? workspaceId ?? creationId,
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      const parsed =
        workspace.schemaVersion === 1
          ? WorkspaceDefinitionSchema.safeParse(workspace.definition)
          : null;
      setRecord(workspace);
      const value = parsed?.success ? parsed.data : emptyDefinition();
      setDraft(value);
      setSavedDefinition(JSON.stringify(value));
      setErrors({});
      setConflict(null);
      setSuccess("");
      onDraftStatus({ dirty: false, busy: false });
      if (!workspaceId)
        void navigate(`/workspaces/${workspace.id}`, { replace: true });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else {
        setMessage(errorMessage(error));
        focusError({});
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }

  function field(
    name: FieldName,
    label: string,
    options: {
      hint?: string;
      multiline?: boolean;
      maxLength: number;
      required?: boolean;
      placeholder?: string;
      type?: string;
    },
  ) {
    const error = errors[name]?.[0];
    const value = name.startsWith("actions.")
      ? draft.actions[name.slice(8) as keyof WorkspaceDefinition["actions"]]
      : draft[name as Exclude<keyof WorkspaceDefinition, "actions">];
    const id = `workspace-${name.replace(".", "-")}`;
    const props = {
      id,
      name,
      value,
      maxLength: options.maxLength,
      required: options.required,
      readOnly: !writable,
      disabled: busy,
      autoComplete: "off",
      spellCheck: name === "description",
      placeholder: options.placeholder,
      "aria-invalid": Boolean(error),
      "aria-describedby":
        [options.hint && `${id}-hint`, error && `${id}-error`]
          .filter(Boolean)
          .join(" ") || undefined,
      onChange: (
        event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
      ) => change(name, event.target.value),
    };
    return (
      <div className={styles.field} key={name}>
        <label htmlFor={id}>
          {label}
          {!options.required && <span>Optional</span>}
        </label>
        {options.multiline ? (
          <textarea
            {...props}
            rows={name === "description" ? 3 : 2}
            className={
              name.startsWith("actions.") ? styles.codeInput : undefined
            }
          />
        ) : (
          <input {...props} type={options.type ?? "text"} />
        )}
        {options.hint && (
          <p id={`${id}-hint`} className={common.hint}>
            {options.hint}
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

  if (loading && !record && workspaceId)
    return (
      <section className={common.statusPanel} role="status">
        <LoaderCircle size={24} className={common.spinner} aria-hidden="true" />
        <p>Loading workspace…</p>
      </section>
    );
  if (loadError && !record)
    return (
      <section className={common.statusPanel}>
        <h1>Couldn’t open this workspace</h1>
        <p role="alert">{loadError}</p>
        <div className={common.buttonRow}>
          <button
            type="button"
            className={common.secondaryButton}
            onClick={() => {
              setLoadError("");
              setLoading(true);
              setAttempt((value) => value + 1);
            }}
          >
            Retry
          </button>
          <Link className={common.secondaryButton} to="/workspaces">
            All workspaces
          </Link>
        </div>
      </section>
    );

  return (
    <>
      <Link className={styles.backLink} to="/workspaces">
        <ArrowLeft size={15} aria-hidden="true" />
        All workspaces
      </Link>
      <div className={common.pageHeading}>
        <div>
          <div className={common.eyebrow}>Build · {team.name}</div>
          <h1>{record?.name ?? "New workspace"}</h1>
          <p>
            {record
              ? `Revision ${record.revision} · Saved configuration`
              : "Save the repository and actions your team will use."}
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
          {(!canEditWorkspaces(team) || writeDenied) && (
            <div className={styles.notice} role="status">
              You have read-only access. A current team admin or developer can
              save workspace changes.
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
                        ? "Load saved workspace"
                        : "Load latest"}
                    </button>
                    {conflict === "identity" && (
                      <button
                        className={common.secondaryButton}
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setCreationId(crypto.randomUUID());
                          setConflict(null);
                          setMessage(
                            "Draft kept as a new workspace. Use a unique name, then save when ready.",
                          );
                        }}
                      >
                        Keep draft as new
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
          <section
            className={styles.formPanel}
            aria-labelledby="workspace-details-heading"
          >
            <h2 id="workspace-details-heading">Workspace details</h2>
            {field("name", "Name", {
              required: true,
              maxLength: 80,
              placeholder: "Customer portal…",
            })}
            {field("description", "Description", {
              maxLength: 2000,
              multiline: true,
            })}
          </section>
          <section
            className={styles.formPanel}
            aria-labelledby="workspace-source-heading"
          >
            <h2 id="workspace-source-heading">Source</h2>
            {field("repositoryUrl", "Repository URL", {
              required: true,
              maxLength: 2048,
              type: "url",
              placeholder: "https://github.com/your-team/project…",
              hint: "HTTPS URL without embedded credentials, query parameters, or fragments.",
            })}
            <div className={styles.fieldGrid}>
              {field("sourceRef", "Source revision", {
                required: true,
                maxLength: 200,
                hint: "Branch, tag, or commit to start from.",
              })}
              {field("defaultBranch", "Default branch", {
                required: true,
                maxLength: 200,
                hint: "The repository’s usual target branch.",
              })}
            </div>
          </section>
          <section
            className={styles.formPanel}
            aria-labelledby="workspace-environment-heading"
          >
            <h2 id="workspace-environment-heading">Environment</h2>
            <div className={styles.fieldGrid}>
              {field("sandboxImage", "Container image", {
                required: true,
                maxLength: 200,
                placeholder: "node:24-bookworm…",
                hint: "Image reference for a future isolated run.",
              })}
              {field("workingDirectory", "Working directory", {
                required: true,
                maxLength: 200,
                hint: "Relative to the repository, for example . or apps/web.",
              })}
            </div>
          </section>
          <section
            className={styles.formPanel}
            aria-labelledby="workspace-actions-heading"
          >
            <h2 id="workspace-actions-heading">Actions</h2>
            <p className={styles.sectionHint}>
              Saving stores configuration only. It does not clone a repository,
              pull an image, or run these commands. Keep credentials out of
              commands and other fields.
            </p>
            <div className={styles.fieldGrid}>
              {(["install", "test", "lint", "build"] as const).map((action) =>
                field(
                  `actions.${action}`,
                  `${action[0].toUpperCase()}${action.slice(1)} command`,
                  { maxLength: 1000, multiline: true },
                ),
              )}
            </div>
          </section>
          <div className={styles.saveBar}>
            <div role="status">
              {saving
                ? "Saving workspace…"
                : loading
                  ? "Loading saved workspace…"
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
                    : "Create workspace"}
              </button>
            )}
          </div>
        </form>
      )}
    </>
  );
}
