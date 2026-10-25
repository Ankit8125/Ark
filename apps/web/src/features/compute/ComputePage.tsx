import {
  type CreateRunnerEnrollmentRequest,
  type Runner,
  type RunnerListResponse,
  type RunnerResponse,
  type Team,
} from "@ark/contracts";
import { LoaderCircle, RefreshCw, Server } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { computeApi, createEnrollment } from "./api";
import { registrationStatus } from "./registration";
import { RunnerAccessPanel } from "./RunnerAccessPanel";
import styles from "./compute.module.css";

type Props = { team: Team; onExpired: () => void };
type ConfirmedEnrollment = RunnerResponse & { token: string | null };

function date(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

// Changing teams or losing admin access discards request credentials.
export function ComputePage(props: Props) {
  return (
    <ComputeContent key={`${props.team.id}:${props.team.role}`} {...props} />
  );
}

function ComputeContent({ team, onExpired }: Props) {
  const [page, setPage] = useState<RunnerListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [readDenied, setReadDenied] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [name, setName] = useState("");
  const [nameError, setNameError] = useState("");
  const [issueError, setIssueError] = useState("");
  const [issuePending, setIssuePending] = useState(false);
  const [confirmed, setConfirmed] = useState<ConfirmedEnrollment | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [mutation, setMutation] = useState<string | null>(null);
  const [writeDenied, setWriteDenied] = useState(false);
  const [revokeError, setRevokeError] = useState<{
    id: string;
    message: string;
    stale: boolean;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [accessRunner, setAccessRunner] = useState<string | null>(null);
  const [accessBusy, setAccessBusy] = useState(false);
  const [accessUncertain, setAccessUncertain] = useState<string[]>([]);
  const enrollment = useRef<CreateRunnerEnrollmentRequest | null>(null);
  const readRequest = useRef<AbortController | null>(null);
  const writeRequest = useRef<AbortController | null>(null);
  const reading = useRef(false);
  const writing = useRef(false);
  const mounted = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const onExpiredRef = useRef(onExpired);
  const writable = team.role === "admin" && !writeDenied;
  const busy = loading || mutation !== null || accessBusy;

  function clearEnrollment() {
    enrollment.current = null;
    setConfirmed(null);
    setRevealed(false);
    setIssuePending(false);
    setIssueError("");
    setName("");
    setNameError("");
  }

  function expireSession() {
    clearEnrollment();
    setPage(null);
    setWriteDenied(true);
    setNotice("");
    setRevokeError(null);
    setAccessRunner(null);
    onExpiredRef.current();
  }

  function acceptRunner(response: RunnerResponse) {
    setRevokeError((current) =>
      current?.id === response.runner.id ? null : current,
    );
    setPage(
      (current) =>
        current && {
          ...current,
          observedAt: response.observedAt,
          runners: current.runners.map((runner) =>
            runner.id === response.runner.id ? response.runner : runner,
          ),
        },
    );
    if (response.runner.enrolledAt || response.runner.revokedAt) {
      setConfirmed((current) =>
        current?.runner.id === response.runner.id
          ? { ...current, token: null }
          : current,
      );
    }
  }

  function accessDenied(adminOnly: boolean) {
    clearEnrollment();
    setAccessRunner(null);
    setWriteDenied(true);
    setRevokeError(null);
    setNotice("");
    if (!adminOnly) {
      setPage(null);
      setReadDenied(true);
      setListError("Team access was denied.");
    }
  }

  function acceptRead(value: RunnerListResponse, replacesPage = false) {
    setReadDenied(false);
    setAccessUncertain((current) =>
      replacesPage
        ? []
        : current.filter(
            (id) => !value.runners.some((runner) => runner.id === id),
          ),
    );
    setRevealed(false);
    setConfirmed((current) => {
      const latest = value.runners.find(
        (runner) => runner.id === current?.runner.id,
      );
      return current &&
        latest &&
        registrationStatus(latest, value.observedAt) !== "Pending"
        ? { ...current, token: null }
        : current;
    });
    setRevokeError((current) =>
      current?.stale &&
      !replacesPage &&
      !value.runners.some((runner) => runner.id === current.id)
        ? current
        : null,
    );
  }

  function readFailure(error: unknown) {
    if (error instanceof ApiRequestError && error.status === 401) {
      expireSession();
      return;
    }
    if (
      error instanceof ApiRequestError &&
      (error.status === 403 || error.status === 404)
    ) {
      clearEnrollment();
      writeRequest.current?.abort();
      writing.current = false;
      setMutation(null);
      setNotice("");
      setRevokeError(null);
      setPage(null);
      setReadDenied(true);
      setWriteDenied(true);
      setAccessRunner(null);
    }
    setListError(errorMessage(error));
  }

  useEffect(() => {
    onExpiredRef.current = onExpired;
  }, [onExpired]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      enrollment.current = null;
      readRequest.current?.abort();
      writeRequest.current?.abort();
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    readRequest.current = controller;
    reading.current = true;
    void computeApi
      .list(team.id, undefined, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted && mounted.current) {
          setPage(value);
          acceptRead(value, true);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || !mounted.current) return;
        readFailure(error);
      })
      .finally(() => {
        if (readRequest.current === controller) reading.current = false;
        if (!controller.signal.aborted && mounted.current) setLoading(false);
      });
    return () => {
      controller.abort();
      readRequest.current?.abort();
    };
  }, [team.id, attempt]);

  function refresh() {
    if (writing.current) return;
    setAccessRunner(null);
    readRequest.current?.abort();
    setLoading(true);
    setListError("");
    setAttempt((value) => value + 1);
  }

  async function more() {
    if (!page?.nextCursor || reading.current || writing.current) return;
    const controller = new AbortController();
    readRequest.current = controller;
    reading.current = true;
    setLoading(true);
    setListError("");
    try {
      const next = await computeApi.list(
        team.id,
        page.nextCursor,
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      acceptRead(next);
      setPage(
        (current) =>
          current && {
            ...next,
            runners: [
              ...new Map(
                [...current.runners, ...next.runners].map((runner) => [
                  runner.id,
                  runner,
                ]),
              ).values(),
            ],
          },
      );
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      readFailure(error);
    } finally {
      if (readRequest.current === controller) reading.current = false;
      if (!controller.signal.aborted && mounted.current) setLoading(false);
    }
  }

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writable || busy || reading.current || writing.current || confirmed)
      return;
    const trimmedName = name.trim();
    if (!trimmedName || trimmedName.length > 80) {
      setNameError(
        !trimmedName ? "Enter a runner name." : "Use 80 characters or fewer.",
      );
      nameRef.current?.focus();
      return;
    }
    setNameError("");
    setIssueError("");
    setNotice("");
    setAccessRunner(null);
    let input = enrollment.current;
    if (!input) {
      try {
        input = createEnrollment(trimmedName);
      } catch {
        setIssueError(
          "This browser could not generate a secure enrollment code. Reload in a browser with Web Crypto support.",
        );
        return;
      }
      enrollment.current = input;
    }
    const controller = new AbortController();
    writeRequest.current = controller;
    writing.current = true;
    setMutation("issue");
    setIssuePending(true);
    try {
      const result = await computeApi.issue(team.id, input, controller.signal);
      if (controller.signal.aborted || !mounted.current) return;
      const usable =
        registrationStatus(result.runner, result.observedAt) === "Pending";
      setConfirmed({ ...result, token: usable ? input.enrollmentToken : null });
      enrollment.current = null;
      setIssuePending(false);
      setRevealed(false);
      setPage((current) => ({
        runners: current
          ? [
              result.runner,
              ...current.runners.filter(
                (runner) => runner.id !== result.runner.id,
              ),
            ]
          : [result.runner],
        nextCursor: current?.nextCursor ?? null,
        observedAt: result.observedAt,
      }));
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401)
        expireSession();
      else {
        if (
          error instanceof ApiRequestError &&
          (error.status === 403 || error.status === 404)
        ) {
          clearEnrollment();
          setWriteDenied(true);
        }
        if (error instanceof ApiRequestError && error.status === 400) {
          enrollment.current = null;
          setIssuePending(false);
          if (error.fieldErrors.name?.[0]) {
            setNameError(
              error.fieldErrors.name[0]
                .split(input.enrollmentToken)
                .join("[redacted]"),
            );
            nameRef.current?.focus();
          }
        }
        setIssueError(
          errorMessage(error).split(input.enrollmentToken).join("[redacted]"),
        );
      }
    } finally {
      if (writeRequest.current === controller) writing.current = false;
      if (!controller.signal.aborted && mounted.current) setMutation(null);
    }
  }

  async function revoke(runner: Runner) {
    if (
      !writable ||
      busy ||
      reading.current ||
      writing.current ||
      runner.revokedAt ||
      revokeError?.stale ||
      accessUncertain.includes(runner.id)
    )
      return;
    if (
      !window.confirm(
        `Revoke runner “${runner.name}” (${runner.id})? This permanently invalidates its enrollment code and runner credential. The foreground process will lose access.`,
      )
    )
      return;
    setAccessRunner(null);
    const controller = new AbortController();
    writeRequest.current = controller;
    writing.current = true;
    setMutation(runner.id);
    setRevokeError(null);
    setNotice("");
    try {
      const result = await computeApi.revoke(
        team.id,
        runner.id,
        { expectedLifecycleRevision: runner.lifecycleRevision },
        controller.signal,
      );
      if (controller.signal.aborted || !mounted.current) return;
      setPage(
        (current) =>
          current && {
            ...current,
            observedAt: result.observedAt,
            runners: current.runners.map((item) =>
              item.id === runner.id ? result.runner : item,
            ),
          },
      );
      setNotice(`Revoked ${runner.name}. Its registration remains visible.`);
      setConfirmed((current) =>
        current?.runner.id === runner.id
          ? { ...current, token: null }
          : current,
      );
      setRevealed(false);
    } catch (error) {
      if (controller.signal.aborted || !mounted.current) return;
      if (error instanceof ApiRequestError && error.status === 401)
        expireSession();
      else {
        if (
          error instanceof ApiRequestError &&
          (error.status === 403 || error.status === 404)
        ) {
          clearEnrollment();
          setWriteDenied(true);
        }
        setRevokeError({
          id: runner.id,
          message: errorMessage(error),
          stale: true,
        });
      }
    } finally {
      if (writeRequest.current === controller) writing.current = false;
      if (!controller.signal.aborted && mounted.current) setMutation(null);
    }
  }

  const currentEnrollment =
    confirmed &&
    page?.runners.find((runner) => runner.id === confirmed.runner.id);
  const enrollmentStatus =
    currentEnrollment &&
    registrationStatus(currentEnrollment, page!.observedAt);
  const visibleCode =
    confirmed?.token && enrollmentStatus === "Pending" ? confirmed.token : null;
  return (
    <>
      <div className={common.pageHeading}>
        <div>
          <div className={common.eyebrow}>Operate · {team.name}</div>
          <h1>Compute</h1>
          <p>Connect a local foreground runner and check its heartbeat.</p>
        </div>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy}
          onClick={refresh}
        >
          <RefreshCw size={16} aria-hidden="true" /> Refresh runners
        </button>
      </div>
      <div className={styles.layout}>
        <p className={common.notice}>
          Enrollment, health, dispatch approval, and use grants are separate.
          Deterministic Sessions require a runner started with stub sessions enabled.
        </p>
        {!writable && (
          <p className={common.notice} role="status">
            You have read-only Compute access. A current team admin can issue
            enrollment codes, revoke runners, and manage approval and use
            grants.
          </p>
        )}
        {writable && (
          <section
            className={styles.panel}
            aria-labelledby="runner-enrollment-heading"
            aria-busy={mutation === "issue"}
          >
            <h2 id="runner-enrollment-heading">Enroll a runner</h2>
            <p>
              Name the local process, then issue a code valid for 10 minutes.
              Leaving this page loses the code; it stays in memory and is never
              saved to browser storage.
            </p>
            {!confirmed ? (
              <form onSubmit={(event) => void issue(event)} noValidate>
                <div className={common.field}>
                  <label htmlFor="runner-name">Runner name</label>
                  <input
                    id="runner-name"
                    name="runnerName"
                    ref={nameRef}
                    value={name}
                    maxLength={80}
                    autoComplete="off"
                    placeholder="Local workstation…"
                    readOnly={issuePending}
                    disabled={busy}
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={
                      nameError ? "runner-name-error" : undefined
                    }
                    onChange={(event) => setName(event.target.value)}
                  />
                  {nameError && (
                    <p
                      id="runner-name-error"
                      className={common.fieldError}
                      role="alert"
                    >
                      {nameError}
                    </p>
                  )}
                </div>
                {issueError && (
                  <p className={common.error} role="alert">
                    {issueError}
                  </p>
                )}
                {issuePending && mutation !== "issue" && (
                  <p className={styles.hint}>
                    The response was not confirmed. Retry sends the same runner
                    identity, name, and code. Refresh the list to inspect the
                    registration; revoke it if you no longer need it.
                  </p>
                )}
                <button
                  type="submit"
                  className={`${common.primaryButton} ${styles.fitButton}`}
                  disabled={busy}
                >
                  {mutation === "issue"
                    ? "Issuing enrollment…"
                    : issuePending
                      ? "Retry same enrollment"
                      : "Issue enrollment code"}
                </button>
              </form>
            ) : (
              <div className={styles.codePanel}>
                <p role="status">
                  Enrollment confirmed for{" "}
                  <strong>{confirmed.runner.name}</strong>. Registration:{" "}
                  {enrollmentStatus ?? "Not loaded"}.
                </p>
                {visibleCode ? (
                  <>
                    <div className={common.field}>
                      <label htmlFor="runner-enrollment-code">
                        Enrollment code
                      </label>
                      <input
                        id="runner-enrollment-code"
                        name="enrollmentCode"
                        className={styles.code}
                        type={revealed ? "text" : "password"}
                        value={visibleCode}
                        readOnly
                        autoComplete="off"
                        spellCheck={false}
                        aria-describedby="runner-enrollment-help"
                      />
                    </div>
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={common.secondaryButton}
                        aria-pressed={revealed}
                        onClick={() => setRevealed((value) => !value)}
                      >
                        {revealed ? "Hide code" : "Reveal code"}
                      </button>
                    </div>
                    <p id="runner-enrollment-help" className={styles.hint}>
                      From the Ark project folder, run{" "}
                      <code>pnpm.cmd runner:local</code> and enter this code at
                      its hidden prompt. Expires{" "}
                      {date(confirmed.runner.enrollmentExpiresAt)}. Keep that
                      process open; restarting it needs a new enrollment.
                    </p>
                  </>
                ) : (
                  <p className={styles.hint}>
                    {currentEnrollment
                      ? "This code is no longer available for enrollment."
                      : "This registration is not in the loaded runner list, so its code is hidden."}{" "}
                    Refresh the runner list or load more runners to check its
                    current registration.
                  </p>
                )}
                <button
                  type="button"
                  className={`${common.secondaryButton} ${styles.fitButton}`}
                  disabled={busy}
                  onClick={() => {
                    if (
                      visibleCode &&
                      !window.confirm(
                        "Discard this code and prepare another enrollment? The existing registration remains in the list; revoke it if it is no longer needed.",
                      )
                    )
                      return;
                    enrollment.current = null;
                    setConfirmed(null);
                    setRevealed(false);
                    setName("");
                    setIssueError("");
                    setIssuePending(false);
                  }}
                >
                  Prepare another enrollment
                </button>
              </div>
            )}
          </section>
        )}
        {notice && (
          <p className={common.notice} role="status">
            {notice}
          </p>
        )}
        {listError && (
          <div className={common.error} role="alert">
            <p>{listError}</p>
            <p>
              {readDenied
                ? "Team access was denied. Private runner data and enrollment codes have been cleared."
                : "Any loaded registrations are retained. Refresh retries the first page."}
            </p>
            <button
              type="button"
              className={common.secondaryButton}
              disabled={busy}
              onClick={refresh}
            >
              Retry runner list
            </button>
          </div>
        )}
        {loading && (
          <p className={styles.loading} role="status">
            <LoaderCircle
              size={18}
              className={common.spinner}
              aria-hidden="true"
            />{" "}
            Loading runners…
          </p>
        )}
        {page && (
          <section
            className={styles.listPanel}
            aria-labelledby="runner-list-heading"
            aria-busy={loading}
          >
            <div className={styles.listHeading}>
              <h2 id="runner-list-heading">Team runners</h2>
              <span>
                {page.runners.length} loaded · Last response{" "}
                {date(page.observedAt)}
              </span>
            </div>
            {!page.runners.length ? (
              <div className={styles.empty}>
                <Server size={24} aria-hidden="true" />
                <h3>No runners registered</h3>
                <p>
                  {writable
                    ? "Issue a code above to connect your first local runner."
                    : "A team admin can enroll a local runner."}
                </p>
              </div>
            ) : (
              <ul className={styles.list}>
                {page.runners.map((runner) => (
                  <li key={runner.id}>
                    <div className={styles.rowHeading}>
                      <h3>{runner.name}</h3>
                      <span className={styles.registration}>
                        {registrationStatus(runner, page.observedAt)}
                      </span>
                    </div>
                    <p className={styles.identifier}>{runner.id}</p>
                    <dl className={styles.facts}>
                      <div>
                        <dt>Health</dt>
                        <dd>
                          {runner.health[0]!.toUpperCase() +
                            runner.health.slice(1)}
                        </dd>
                      </div>
                      <div>
                        <dt>Last heartbeat</dt>
                        <dd>
                          {runner.lastHeartbeatAt ? (
                            <time dateTime={runner.lastHeartbeatAt}>
                              {date(runner.lastHeartbeatAt)}
                            </time>
                          ) : (
                            "Not received"
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Dispatch approval</dt>
                        <dd>
                          {runner.dispatchApproved ? "Approved" : "Unapproved"}
                        </dd>
                      </div>
                      {!runner.enrolledAt && !runner.revokedAt && (
                        <div>
                          <dt>Code expires</dt>
                          <dd>
                            <time dateTime={runner.enrollmentExpiresAt}>
                              {date(runner.enrollmentExpiresAt)}
                            </time>
                          </dd>
                        </div>
                      )}
                    </dl>
                    {runner.revokedAt && (
                      <p className={styles.hint}>
                        Revoked {date(runner.revokedAt)}. Last heartbeat is
                        historical; revocation does not describe the host's
                        current availability.
                      </p>
                    )}
                    {revokeError?.id === runner.id && (
                      <div className={common.error} role="alert">
                        <p>{revokeError.message}</p>
                        <p>
                          {revokeError.stale
                            ? "Refresh runners before confirming revocation again. The registration may have changed or the previous request may have succeeded."
                            : "The response was not confirmed. Refresh runners to check whether revocation succeeded, or retry the same action."}
                        </p>
                      </div>
                    )}
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={common.secondaryButton}
                        aria-expanded={accessRunner === runner.id}
                        aria-controls={
                          accessRunner === runner.id
                            ? `runner-access-${runner.id}`
                            : undefined
                        }
                        aria-label={`${writable ? "Manage access for" : "Check my access to"} ${runner.name} (${runner.id})`}
                        disabled={busy || Boolean(listError)}
                        onClick={() =>
                          setAccessRunner((current) =>
                            current === runner.id ? null : runner.id,
                          )
                        }
                      >
                        {writable ? "Manage access" : "Check my access"}
                      </button>
                      {writable && !runner.revokedAt && (
                        <button
                          type="button"
                          className={common.secondaryButton}
                          aria-label={`Revoke ${runner.name} (${runner.id})`}
                          disabled={
                            busy ||
                            Boolean(listError) ||
                            Boolean(revokeError?.stale) ||
                            accessUncertain.includes(runner.id)
                          }
                          onClick={() => void revoke(runner)}
                        >
                          {mutation === runner.id
                            ? "Revoking…"
                            : "Revoke runner"}
                        </button>
                      )}
                    </div>
                    {accessUncertain.includes(runner.id) &&
                      accessRunner !== runner.id && (
                        <p className={styles.hint}>
                          Refresh runners or reopen access before another
                          permission or revocation change.
                        </p>
                      )}
                    {accessRunner === runner.id && (
                      <RunnerAccessPanel
                        runner={runner}
                        admin={writable}
                        disabled={loading || mutation !== null}
                        onRunner={acceptRunner}
                        onBusy={setAccessBusy}
                        onUncertain={(uncertain) =>
                          setAccessUncertain((current) =>
                            uncertain
                              ? [...new Set([...current, runner.id])]
                              : current.filter((id) => id !== runner.id),
                          )
                        }
                        onDenied={accessDenied}
                        onExpired={expireSession}
                        onClose={() => setAccessRunner(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {page.nextCursor && (
              <div className={styles.listFooter}>
                <button
                  type="button"
                  className={common.secondaryButton}
                  disabled={busy}
                  onClick={() => void more()}
                >
                  {listError ? "Retry more runners" : "Load more runners"}
                </button>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}
