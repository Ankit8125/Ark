import {
  AgentDefinitionSchema,
  WorkspaceDefinitionSchema,
  type ResourceVersion,
  type ResourceVersionReference,
} from "@ark/contracts";
import { useEffect, useState } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import styles from "../catalog/catalog.module.css";
import { flowApi } from "./api";
import type {
  DependencySummary,
  DependencyCatalog,
} from "./useDependencyCatalog";

function referenceKey(reference: ResourceVersionReference) {
  return `${reference.resourceId}:${reference.versionId}`;
}
function summaryReference(item: DependencySummary) {
  return { resourceId: item.id, versionId: item.versionId };
}

export function ResourceVersionPicker({
  kind,
  teamId,
  name,
  label,
  value,
  items,
  writable,
  busy,
  error,
  onChange,
  onExpired,
}: {
  kind: "workspace" | "agent";
  teamId: string;
  name: string;
  label: string;
  value: ResourceVersionReference;
  items: DependencySummary[];
  writable: boolean;
  busy: boolean;
  error?: string;
  onChange: (reference: ResourceVersionReference) => void;
  onExpired: () => void;
}) {
  const [result, setResult] = useState<{
    key: string;
    version?: ResourceVersion;
    error?: string;
  }>();
  const [attempt, setAttempt] = useState(0);
  const selected =
    value.resourceId && value.versionId ? referenceKey(value) : "";
  const key = `${teamId}:${kind}:${selected}`;
  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    void flowApi
      .version(
        teamId,
        kind,
        { resourceId: value.resourceId, versionId: value.versionId },
        controller.signal,
      )
      .then((version) => {
        if (!controller.signal.aborted) setResult({ key, version });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        if (reason instanceof ApiRequestError && reason.status === 401)
          onExpired();
        else setResult({ key, error: errorMessage(reason) });
      });
    return () => controller.abort();
  }, [
    teamId,
    kind,
    value.resourceId,
    value.versionId,
    selected,
    key,
    attempt,
    onExpired,
  ]);
  const current = result?.key === key ? result : undefined;
  const version = current?.version;
  const definition =
    version?.schemaVersion === 1
      ? (kind === "workspace"
          ? WorkspaceDefinitionSchema
          : AgentDefinitionSchema
        ).safeParse(version.definition)
      : null;
  const savedName = definition?.success
    ? definition.data.name
    : "Saved version";
  const retained =
    selected &&
    !items.some((item) => referenceKey(summaryReference(item)) === selected);
  const id = `flow-${name.replaceAll(".", "-")}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        name={name}
        value={selected}
        disabled={!writable || busy}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
        onChange={(event) => {
          const item = items.find(
            (candidate) =>
              referenceKey(summaryReference(candidate)) === event.target.value,
          );
          if (item) onChange(summaryReference(item));
          else if (!event.target.value)
            onChange({ resourceId: "", versionId: "" });
        }}
      >
        <option value="">
          Choose {kind === "agent" ? "an agent" : "a workspace"} version…
        </option>
        {retained && (
          <option value={selected}>
            {version
              ? `${savedName} · Revision ${version.revision} (pinned)`
              : "Pinned version (details below)"}
          </option>
        )}
        {items.map((item) => (
          <option
            key={item.id}
            value={referenceKey(summaryReference(item))}
            disabled={item.schemaVersion !== 1}
          >
            {item.name} · Revision {item.revision}
            {item.schemaVersion !== 1 ? " (unsupported schema)" : ""}
          </option>
        ))}
      </select>
      <div id={`${id}-hint`} className={common.hint}>
        {!selected ? (
          "Selecting a version pins it. Later catalog edits will not change this flow."
        ) : current?.error ? (
          <>
            <p>{current.error} The selected version is kept.</p>
            <button
              type="button"
              className={common.secondaryButton}
              disabled={busy}
              onClick={() => {
                setResult(undefined);
                setAttempt((count) => count + 1);
              }}
            >
              Retry {label.toLowerCase()}
            </button>
          </>
        ) : !version ? (
          "Checking the selected version…"
        ) : !definition?.success ? (
          "This version has unsupported fields. Choose a supported version before saving."
        ) : (
          `${savedName}, revision ${version.revision}, is pinned. Select another version explicitly to change it.`
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className={common.fieldError}>
          {error}
        </p>
      )}
    </div>
  );
}

export function DependencyCatalogStatus({
  kind,
  catalog,
  busy,
}: {
  kind: "workspace" | "agent";
  catalog: DependencyCatalog;
  busy: boolean;
}) {
  return (
    <div className={styles.notice}>
      <p role={catalog.error ? "alert" : "status"}>
        {catalog.loading
          ? `Loading ${kind} choices…`
          : catalog.error
            ? catalog.error
            : catalog.items.length
              ? `${catalog.items.length} ${kind} choices loaded. Each choice shows its current revision.`
              : `No ${kind}s in this team yet. Create one in the ${kind === "agent" ? "Agents" : "Workspaces"} catalog first.`}
      </p>
      {catalog.error && !catalog.nextCursor && (
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || catalog.loading}
          onClick={catalog.retry}
        >
          Retry {kind} choices
        </button>
      )}
      {catalog.nextCursor && (
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || catalog.loading}
          onClick={() => void catalog.more()}
        >
          {catalog.error ? `Retry more ${kind}s` : `Load more ${kind}s`}
        </button>
      )}
    </div>
  );
}
