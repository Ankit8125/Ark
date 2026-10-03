import type {
  ResourceVersion,
  ResourceVersionListResponse,
  ResourceVersionSummary,
  RestoreResourceRequest,
  Team,
} from "@ark/contracts";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ApiRequestError, errorMessage } from "../../api";
import { canEditCatalog } from "./permissions";

export type DraftStatus = { dirty: boolean; busy: boolean };
export type CatalogRecord = {
  id: string;
  name: string;
  revision: number;
  schemaVersion: number;
  definition: unknown;
};
export type EditorProps = {
  team: Team;
  resourceId?: string;
  onExpired: () => void;
  onDraftStatus: (status: DraftStatus) => void;
};
export type EditorConfig<Definition, RecordType extends CatalogRecord> = {
  kind: "workspace" | "agent" | "flow";
  plural: "workspaces" | "agents" | "flows";
  createDescription: string;
  emptyDefinition: () => Definition;
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: Definition }
      | {
          success: false;
          error: { issues: { path: PropertyKey[]; message: string }[] };
        };
  };
  api: {
    listVersions: (
      teamId: string,
      id: string,
      cursor?: number,
      signal?: AbortSignal,
    ) => Promise<ResourceVersionListResponse>;
    getVersion: (
      teamId: string,
      id: string,
      versionId: string,
      signal?: AbortSignal,
    ) => Promise<ResourceVersion>;
    restore: (
      teamId: string,
      id: string,
      input: RestoreResourceRequest,
      signal?: AbortSignal,
    ) => Promise<RecordType>;
    get: (
      teamId: string,
      id: string,
      signal?: AbortSignal,
    ) => Promise<RecordType>;
    create: (
      teamId: string,
      input: { id: string; schemaVersion: 1; definition: Definition },
      signal?: AbortSignal,
    ) => Promise<RecordType>;
    update: (
      teamId: string,
      id: string,
      input: { revision: number; schemaVersion: 1; definition: Definition },
      signal?: AbortSignal,
    ) => Promise<RecordType>;
  };
};

// Shared recovery for versioned catalog records; each feature owns its fields
// and contract. Keep configs at module scope so reads only restart on identity.
export function useVersionedEditor<
  Definition,
  RecordType extends CatalogRecord,
>(
  { team, resourceId, onExpired, onDraftStatus }: EditorProps,
  config: EditorConfig<Definition, RecordType>,
) {
  const navigate = useNavigate();
  const [creationId, setCreationId] = useState(() => crypto.randomUUID());
  const [record, setRecord] = useState<RecordType | null>(null);
  const [draft, setDraft] = useState(config.emptyDefinition);
  const [savedDefinition, setSavedDefinition] = useState(() =>
    JSON.stringify(draft),
  );
  const [loading, setLoading] = useState(Boolean(resourceId));
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<ResourceVersionSummary[]>([]);
  const [nextVersionCursor, setNextVersionCursor] = useState<number | null>(
    null,
  );
  const [selectedVersion, setSelectedVersion] =
    useState<ResourceVersion | null>(null);
  const [rejectedVersions, setRejectedVersions] = useState<string[]>([]);
  const [historyLoading, setHistoryLoading] = useState<
    "list" | "preview" | null
  >(null);
  const [historyError, setHistoryError] = useState("");
  const [restoreFailed, setRestoreFailed] = useState(false);
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
  const historyInFlight = useRef(false);
  const identity = useRef(`${team.id}:${resourceId ?? "new"}`);
  const mounted = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== savedDefinition;
  const busy = loading || saving || restoring || historyLoading !== null;
  const supported =
    !record ||
    (record.schemaVersion === 1 &&
      config.schema.safeParse(record.definition).success);
  const writable =
    canEditCatalog(team) && supported && !writeDenied && conflict !== "schema";
  const selectedVersionSupported =
    selectedVersion?.schemaVersion === 1 &&
    config.schema.safeParse(selectedVersion.definition).success &&
    !rejectedVersions.includes(selectedVersion.versionId);

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
    if (!dirty && !busy) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => {
    const nextIdentity = `${team.id}:${resourceId ?? "new"}`;
    if (identity.current !== nextIdentity) {
      identity.current = nextIdentity;
      request.current?.abort();
      saveInFlight.current = false;
      historyInFlight.current = false;
      setRecord(null);
      const empty = config.emptyDefinition();
      setDraft(empty);
      setSavedDefinition(JSON.stringify(empty));
      setCreationId(crypto.randomUUID());
      setLoading(Boolean(resourceId));
      setSaving(false);
      setRestoring(false);
      clearHistory();
      setLoadError("");
      setMessage("");
      setSuccess("");
      setErrors({});
      setConflict(null);
      setWriteDenied(false);
    }
    if (!resourceId) return;
    const controller = new AbortController();
    request.current = controller;
    void config.api
      .get(team.id, resourceId, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setRecord(value);
        const parsed =
          value.schemaVersion === 1
            ? config.schema.safeParse(value.definition)
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
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [team.id, resourceId, attempt, onExpired, config]);

  useEffect(() => {
    if (!message || busy) return;
    const frame = requestAnimationFrame(() => {
      if (!mounted.current) return;
      const path = Object.keys(errors)[0] ?? "";
      const field =
        formRef.current?.elements.namedItem(path) ??
        formRef.current?.elements.namedItem(
          path.replace(/\.(resourceId|versionId|port|stageId)$/, ""),
        );
      if (field instanceof HTMLElement) field.focus();
      else errorRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [message, errors, busy]);

  function changeDraft(next: Definition) {
    setDraft(next);
    setSuccess("");
    onDraftStatus({ dirty: JSON.stringify(next) !== savedDefinition, busy });
  }

  function clearHistory() {
    setHistoryOpen(false);
    setVersions([]);
    setNextVersionCursor(null);
    setSelectedVersion(null);
    setRejectedVersions([]);
    setHistoryLoading(null);
    setHistoryError("");
    setRestoreFailed(false);
  }

  function mutationError(error: unknown, fromRestore = false) {
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
      if (error.code === "UNSUPPORTED_SCHEMA_VERSION" && !fromRestore)
        setConflict("schema");
      if (error.status === 403) setWriteDenied(true);
    }
    setErrors(fields);
    setMessage(errorMessage(error));
  }

  async function loadHistory(cursor?: number) {
    if (!record || busy || historyInFlight.current || saveInFlight.current)
      return;
    const controller = new AbortController();
    request.current = controller;
    historyInFlight.current = true;
    setHistoryOpen(true);
    setHistoryLoading("list");
    setHistoryError("");
    onDraftStatus({ dirty, busy: true });
    try {
      const page = await config.api.listVersions(
        team.id,
        record.id,
        cursor,
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      setVersions((current) =>
        cursor === undefined ? page.versions : [...current, ...page.versions],
      );
      setNextVersionCursor(page.nextCursor);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else setHistoryError(errorMessage(error));
    } finally {
      if (request.current === controller) historyInFlight.current = false;
      if (!controller.signal.aborted && mounted.current)
        setHistoryLoading(null);
    }
  }

  async function previewVersion(versionId: string) {
    if (!record || busy || historyInFlight.current || saveInFlight.current)
      return;
    const controller = new AbortController();
    request.current = controller;
    historyInFlight.current = true;
    setSelectedVersion(null);
    setHistoryLoading("preview");
    setHistoryError("");
    onDraftStatus({ dirty, busy: true });
    try {
      const value = await config.api.getVersion(
        team.id,
        record.id,
        versionId,
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      setSelectedVersion(value);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else setHistoryError(errorMessage(error));
    } finally {
      if (request.current === controller) historyInFlight.current = false;
      if (!controller.signal.aborted && mounted.current)
        setHistoryLoading(null);
    }
  }

  function closeHistory() {
    if (busy || historyInFlight.current || saveInFlight.current) return;
    setHistoryOpen(false);
  }

  async function restoreVersion() {
    if (
      !record ||
      !selectedVersion ||
      !selectedVersionSupported ||
      !writable ||
      conflict ||
      busy ||
      saveInFlight.current ||
      historyInFlight.current
    )
      return;
    if (
      !window.confirm(
        `Restore revision ${selectedVersion.revision} as new revision ${record.revision + 1} of this ${config.kind}? This replaces your unsaved draft. Earlier revisions stay unchanged.`,
      )
    )
      return;
    const controller = new AbortController();
    request.current = controller;
    saveInFlight.current = true;
    setRestoring(true);
    setRestoreFailed(false);
    setMessage("");
    setSuccess("");
    setErrors({});
    onDraftStatus({ dirty, busy: true });
    try {
      const value = await config.api.restore(
        team.id,
        record.id,
        {
          versionId: selectedVersion.versionId,
          revision: record.revision,
        },
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      const parsed = config.schema.safeParse(value.definition);
      if (value.schemaVersion !== 1 || !parsed.success)
        throw new ApiRequestError(
          502,
          "INVALID_RESPONSE",
          `Ark returned an unexpected restored definition. Your draft is still here; load the saved ${config.kind} to check it.`,
        );
      setRecord(value);
      setDraft(parsed.data);
      setSavedDefinition(JSON.stringify(parsed.data));
      setConflict(null);
      setSuccess(
        `Restored revision ${selectedVersion.revision} as revision ${value.revision}.`,
      );
      clearHistory();
      onDraftStatus({ dirty: false, busy: false });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      setRestoreFailed(true);
      if (
        error instanceof ApiRequestError &&
        (error.code === "UNSUPPORTED_SCHEMA_VERSION" ||
          error.code === "INVALID_STORED_DEFINITION")
      ) {
        if (error.fieldErrors.versionId)
          setRejectedVersions((current) => [
            ...current,
            selectedVersion.versionId,
          ]);
        else setConflict("schema");
      }
      mutationError(error, true);
    } finally {
      if (request.current === controller) saveInFlight.current = false;
      if (!controller.signal.aborted && mounted.current) setRestoring(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || busy || saveInFlight.current) return;
    setErrors({});
    setMessage("");
    setSuccess("");
    const parsed = config.schema.safeParse(draft);
    if (!parsed.success) {
      const fields: Record<string, string[]> = {};
      for (const issue of parsed.error.issues)
        (fields[issue.path.map(String).join(".")] ??= []).push(issue.message);
      setErrors(fields);
      setMessage("Check the highlighted fields.");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    saveInFlight.current = true;
    setSaving(true);
    onDraftStatus({ dirty, busy: true });
    try {
      const value = record
        ? await config.api.update(
            team.id,
            record.id,
            {
              revision: record.revision,
              schemaVersion: 1,
              definition: parsed.data,
            },
            controller.signal,
          )
        : await config.api.create(
            team.id,
            { id: creationId, schemaVersion: 1, definition: parsed.data },
            controller.signal,
          );
      if (controller.signal.aborted || !mounted.current) return;
      const result = config.schema.safeParse(value.definition);
      if (value.schemaVersion !== 1 || !result.success)
        throw new ApiRequestError(
          502,
          "INVALID_RESPONSE",
          `Ark returned an unexpected saved definition. Your draft is still here; load the saved ${config.kind} to check it.`,
        );
      setRecord(value);
      setDraft(result.data);
      setSavedDefinition(JSON.stringify(result.data));
      setConflict(null);
      clearHistory();
      setSuccess(`Saved revision ${value.revision}.`);
      onDraftStatus({ dirty: false, busy: false });
      if (!resourceId)
        void navigate(`/${config.plural}/${value.id}`, { replace: true });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      mutationError(error);
    } finally {
      if (request.current === controller) saveInFlight.current = false;
      if (!controller.signal.aborted && mounted.current) setSaving(false);
    }
  }

  async function loadLatest() {
    if (
      busy ||
      !window.confirm(
        `Discard your unsaved changes and load the saved ${config.kind}?`,
      )
    )
      return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setLoading(true);
    setMessage("");
    try {
      const value = await config.api.get(
        team.id,
        record?.id ?? resourceId ?? creationId,
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      const parsed =
        value.schemaVersion === 1
          ? config.schema.safeParse(value.definition)
          : null;
      setRecord(value);
      const next = parsed?.success ? parsed.data : config.emptyDefinition();
      setDraft(next);
      setSavedDefinition(JSON.stringify(next));
      setErrors({});
      setConflict(null);
      setSuccess("");
      clearHistory();
      onDraftStatus({ dirty: false, busy: false });
      if (!resourceId)
        void navigate(`/${config.plural}/${value.id}`, { replace: true });
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401) onExpired();
      else {
        setMessage(errorMessage(error));
      }
    } finally {
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }

  function keepAsNew() {
    setCreationId(crypto.randomUUID());
    setConflict(null);
    setMessage(
      `Draft kept as a new ${config.kind}. Use a unique name, then save when ready.`,
    );
  }
  function retryLoad() {
    setLoadError("");
    setLoading(true);
    setAttempt((value) => value + 1);
  }

  return {
    config,
    team,
    resourceId,
    record,
    draft,
    loading,
    saving,
    restoring,
    historyOpen,
    versions,
    nextVersionCursor,
    selectedVersion,
    selectedVersionSupported,
    historyLoading,
    historyError,
    restoreFailed,
    loadError,
    message,
    success,
    errors,
    conflict,
    writeDenied,
    formRef,
    errorRef,
    dirty,
    busy,
    supported,
    writable,
    changeDraft,
    submit,
    loadLatest,
    keepAsNew,
    retryLoad,
    loadHistory,
    previewVersion,
    closeHistory,
    restoreVersion,
  };
}

export type VersionedEditor<
  Definition,
  RecordType extends CatalogRecord,
> = ReturnType<typeof useVersionedEditor<Definition, RecordType>>;
