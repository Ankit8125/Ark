import {
  FlowDefinitionSchema,
  SessionPreviewRequestSchema,
  type ExecutionSession,
  type FlowDefinition,
  type FlowSummary,
  type Runner,
  type SessionPreviewResponse,
  type StartSessionRequest,
  type Team,
} from "@ark/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { computeApi } from "../compute/api";
import { flowApi } from "../flows/api";
import { sessionsApi } from "./api";
import styles from "./sessions.module.css";
import type { DraftStatus } from "../catalog/useVersionedEditor";

type Props = {
  team: Team;
  onStarted: (session: ExecutionSession) => void;
  onError: (error: unknown) => boolean;
  onDraftStatus?: ((status: DraftStatus) => void) | undefined;
};

export function NewSessionForm({
  team,
  onStarted,
  onError,
  onDraftStatus,
}: Props) {
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [flowCursor, setFlowCursor] = useState<string | null>(null);
  const [runners, setRunners] = useState<Runner[]>([]);
  const [runnerCursor, setRunnerCursor] = useState<string | null>(null);
  const [flowId, setFlowId] = useState("");
  const [definition, setDefinition] = useState<FlowDefinition | null>(null);
  const [runnerId, setRunnerId] = useState("");
  const [useAllowed, setUseAllowed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<SessionPreviewResponse | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [pendingId, setPendingId] = useState("");
  const controller = useRef<AbortController | null>(null);
  const pending = useRef<StartSessionRequest | null>(null);
  const writing = useRef(false);
  const selectedFlow = flows.find((flow) => flow.id === flowId);
  const selectedRunner = runners.find((runner) => runner.id === runnerId);

  useEffect(() => {
    onDraftStatus?.({
      dirty: Boolean(flowId || runnerId || uncertain),
      busy: busy && writing.current,
    });
  }, [flowId, runnerId, uncertain, busy, onDraftStatus]);
  useEffect(
    () => () => onDraftStatus?.({ dirty: false, busy: false }),
    [onDraftStatus],
  );

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    void Promise.all([
      flowApi.list(team.id, undefined, request.signal),
      computeApi.list(team.id, undefined, request.signal),
    ])
      .then(([flowPage, runnerPage]) => {
        if (request.signal.aborted) return;
        setFlows(flowPage.flows);
        setFlowCursor(flowPage.nextCursor);
        setRunners(runnerPage.runners);
        setRunnerCursor(runnerPage.nextCursor);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !onError(failure))
          setError(errorMessage(failure));
      })
      .finally(() => {
        if (!request.signal.aborted) setBusy(false);
      });
    return () => {
      request.abort();
      pending.current = null;
    };
  }, [team.id, onError]);

  useEffect(() => {
    if (!selectedFlow) return;
    const request = new AbortController();
    void flowApi
      .get(team.id, selectedFlow.id, request.signal)
      .then((flow) => {
        if (request.signal.aborted) return;
        const parsed = FlowDefinitionSchema.safeParse(flow.definition);
        if (
          flow.archivedAt ||
          flow.versionId !== selectedFlow.versionId ||
          flow.schemaVersion !== 1 ||
          !parsed.success
        ) {
          setError(
            "This Flow version changed or is unsupported. Refresh choices and select it again.",
          );
          return;
        }
        setDefinition(parsed.data);
        setValues(
          Object.fromEntries(
            parsed.data.inputs.map((port) => [
              port.name,
              port.type === "json" ? "{}" : "",
            ]),
          ),
        );
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !onError(failure))
          setError(errorMessage(failure));
      });
    return () => request.abort();
  }, [team.id, selectedFlow, onError]);

  useEffect(() => {
    if (!runnerId) return;
    const request = new AbortController();
    void computeApi
      .useAccess(team.id, runnerId, request.signal)
      .then((access) => {
        if (!request.signal.aborted) setUseAllowed(access.useAllowed);
      })
      .catch((failure: unknown) => {
        if (!request.signal.aborted && !onError(failure))
          setError(errorMessage(failure));
      });
    return () => request.abort();
  }, [team.id, runnerId, onError]);

  function changed() {
    setPreview(null);
    setError("");
  }

  function admissionDenied(failure: unknown): boolean {
    const denied =
      failure instanceof ApiRequestError &&
      failure.status === 403 &&
      failure.code === "COMPUTE_FORBIDDEN";
    if (denied) {
      setUseAllowed(false);
      setPreview(null);
    }
    return denied;
  }

  async function more(kind: "flows" | "runners") {
    const signal = controller.current?.signal;
    if (busy || uncertain || !signal) return;
    setBusy(true);
    setError("");
    try {
      if (kind === "flows" && flowCursor) {
        const page = await flowApi.list(team.id, flowCursor, signal);
        if (signal.aborted) return;
        setFlows((current) => [
          ...current.filter(
            (item) => !page.flows.some((next) => next.id === item.id),
          ),
          ...page.flows,
        ]);
        setFlowCursor(page.nextCursor);
      } else if (kind === "runners" && runnerCursor) {
        const page = await computeApi.list(team.id, runnerCursor, signal);
        if (signal.aborted) return;
        setRunners((current) => [
          ...current.filter(
            (item) => !page.runners.some((next) => next.id === item.id),
          ),
          ...page.runners,
        ]);
        setRunnerCursor(page.nextCursor);
      }
    } catch (failure) {
      if (!signal.aborted && !onError(failure)) setError(errorMessage(failure));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function refreshChoices() {
    const signal = controller.current?.signal;
    if (!signal || busy || uncertain) return;
    changed();
    setFlowId("");
    setDefinition(null);
    setRunnerId("");
    setUseAllowed(false);
    setBusy(true);
    try {
      const [flowPage, runnerPage] = await Promise.all([
        flowApi.list(team.id, undefined, signal),
        computeApi.list(team.id, undefined, signal),
      ]);
      if (signal.aborted) return;
      setFlows(flowPage.flows);
      setFlowCursor(flowPage.nextCursor);
      setRunners(runnerPage.runners);
      setRunnerCursor(runnerPage.nextCursor);
    } catch (failure) {
      if (!signal.aborted && !onError(failure)) setError(errorMessage(failure));
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }

  async function inspect() {
    const signal = controller.current?.signal;
    if (
      writing.current ||
      busy ||
      uncertain ||
      !signal ||
      !definition ||
      !selectedFlow ||
      !useAllowed
    )
      return;
    let input;
    try {
      input = SessionPreviewRequestSchema.parse({
        flow: {
          resourceId: selectedFlow.id,
          versionId: selectedFlow.versionId,
        },
        runnerId,
        inputValues: Object.fromEntries(
          definition.inputs.map((port) => [
            port.name,
            {
              type: port.type,
              value:
                port.type === "json"
                  ? (JSON.parse(values[port.name] ?? "") as unknown)
                  : (values[port.name] ?? ""),
            },
          ]),
        ),
      });
    } catch {
      setError(
        "Supply every declared input with its text or valid bounded JSON value. Text allows 4096 characters, JSON allows 4096 bytes, and all values allow 8192 bytes in total.",
      );
      return;
    }
    writing.current = true;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const result = await sessionsApi.preview(team.id, input, signal);
      if (!signal.aborted) setPreview(result);
    } catch (failure) {
      if (!signal.aborted && (admissionDenied(failure) || !onError(failure)))
        setError(errorMessage(failure));
    } finally {
      writing.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  async function start() {
    const signal = controller.current?.signal;
    if (writing.current || busy || !signal || (!pending.current && !preview))
      return;
    if (!pending.current && preview)
      pending.current = {
        id: crypto.randomUUID(),
        flow: {
          resourceId: preview.snapshot.flow.resourceId,
          versionId: preview.snapshot.flow.versionId,
        },
        runnerId: preview.runnerId,
        inputValues: structuredClone(preview.inputValues),
      };
    const request = pending.current!;
    writing.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await sessionsApi.start(team.id, request, signal);
      if (signal.aborted) return;
      pending.current = null;
      setPendingId("");
      setUncertain(false);
      setPreview(null);
      setFlowId("");
      setRunnerId("");
      setDefinition(null);
      setValues({});
      setUseAllowed(false);
      onStarted(result.session);
    } catch (failure) {
      if (signal.aborted || (!admissionDenied(failure) && onError(failure)))
        return;
      const ambiguous =
        !(failure instanceof ApiRequestError) ||
        failure.status === 0 ||
        failure.status >= 500;
      setUncertain(ambiguous);
      setPendingId(ambiguous ? request.id : "");
      if (!ambiguous) {
        pending.current = null;
        setPreview(null);
      }
      setError(
        `${errorMessage(failure)} ${ambiguous ? "The outcome is uncertain. Keep this draft open and retry the same request; its identity and inputs are locked." : "Preview again after resolving the conflict or validation error."}`,
      );
    } finally {
      writing.current = false;
      if (!signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    if (!uncertain && !busy) return;
    const preventLoss = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", preventLoss);
    return () => window.removeEventListener("beforeunload", preventLoss);
  }, [uncertain, busy]);

  return (
    <section className={styles.panel} aria-labelledby="new-session-heading">
      <h2 id="new-session-heading">Queue a stub session</h2>
      <p className={styles.hint}>
        Choose a saved Flow version and your approved runner. Offline runners
        may queue work. This deterministic stub performs no file operations,
        commands, or model calls.
      </p>
      {error && (
        <p className={common.fieldError} role="alert">
          {error}
        </p>
      )}
      <fieldset
        className={styles.fields}
        disabled={busy || uncertain}
        style={{ border: 0, padding: 0, margin: 0 }}
      >
        <label className={styles.field}>
          Flow version
          <select
            value={flowId}
            onChange={(event) => {
              changed();
              setDefinition(null);
              setFlowId(event.target.value);
            }}
          >
            <option value="">Choose an active Flow version</option>
            {flows.map((flow) => (
              <option key={flow.id} value={flow.id}>
                {flow.name} · revision {flow.revision} · {flow.versionId}
              </option>
            ))}
          </select>
        </label>
        {flowCursor && (
          <button
            type="button"
            className={common.secondaryButton}
            onClick={() => void more("flows")}
          >
            Load more Flows
          </button>
        )}
        {selectedFlow && (
          <span className={styles.code}>
            Pinned Flow version: {selectedFlow.versionId}
          </span>
        )}
        <label className={styles.field}>
          Runner
          <select
            value={runnerId}
            onChange={(event) => {
              changed();
              setUseAllowed(false);
              setRunnerId(event.target.value);
            }}
          >
            <option value="">Choose a runner</option>
            {runners.map((runner) => (
              <option
                key={runner.id}
                value={runner.id}
                disabled={
                  !runner.enrolledAt ||
                  !!runner.revokedAt ||
                  !runner.dispatchApproved
                }
              >
                {runner.name} · {runner.health}
                {runner.revokedAt
                  ? " · revoked"
                  : !runner.enrolledAt
                    ? " · not enrolled"
                    : !runner.dispatchApproved
                      ? " · not approved"
                      : ""}
              </option>
            ))}
          </select>
        </label>
        {runnerCursor && (
          <button
            type="button"
            className={common.secondaryButton}
            onClick={() => void more("runners")}
          >
            Load more runners
          </button>
        )}
        {runnerId && (
          <p className={styles.hint}>
            {useAllowed
              ? "Your explicit runner use grant is currently allowed. Admission and claim recheck current permission."
              : "Your current runner use permission is unavailable or denied. An eligible member needs their own explicit grant in Compute."}{" "}
            {selectedRunner?.health === "offline"
              ? "This runner is offline; queued work waits for its foreground process."
              : ""}
          </p>
        )}
        {definition?.inputs.map((port) => (
          <label key={port.name} className={styles.field}>
            {port.name} ({port.type})
            <textarea
              value={values[port.name] ?? ""}
              maxLength={port.type === "text" ? 4096 : undefined}
              onChange={(event) => {
                changed();
                setValues((current) => ({
                  ...current,
                  [port.name]: event.target.value,
                }));
              }}
            />
          </label>
        ))}
      </fieldset>
      <div className={styles.actions}>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || uncertain || !definition || !useAllowed}
          onClick={() => void inspect()}
        >
          Preview
        </button>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || uncertain}
          onClick={() => void refreshChoices()}
        >
          Refresh choices
        </button>
        <button
          type="button"
          className={common.primaryButton}
          disabled={busy || (!preview && !uncertain)}
          onClick={() => void start()}
        >
          {busy
            ? "Please wait…"
            : uncertain
              ? "Retry same queue request"
              : "Queue stub session"}
        </button>
      </div>
      {uncertain && <p className={styles.code}>Creation ID: {pendingId}</p>}
      {preview && (
        <div aria-label="Session preview">
          <h3>Preview: {preview.snapshot.flow.definition.name}</h3>
          <p className={styles.hint}>
            {preview.snapshot.flow.definition.stages.length} ordered stages ·
            stub.v1 · quality: not_evaluated. Preview saves no session.
          </p>
          <dl className={styles.facts}>
            <div>
              <dt>Workspace version</dt>
              <dd>
                {preview.snapshot.workspace.definition.name}
                <code className={styles.code}>
                  {preview.snapshot.workspace.versionId}
                </code>
              </dd>
            </div>
            <div>
              <dt>Agent versions</dt>
              <dd>
                {preview.snapshot.agents.map((agent) => (
                  <span key={agent.versionId}>
                    {agent.definition.name}
                    <code className={styles.code}>{agent.versionId}</code>
                  </span>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </section>
  );
}
