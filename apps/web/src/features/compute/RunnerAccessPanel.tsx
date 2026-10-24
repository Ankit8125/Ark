import type {
  Runner,
  RunnerGrantMember,
  RunnerGrantsResponse,
  RunnerResponse,
  RunnerUseAccessResponse,
} from "@ark/contracts";
import { useEffect, useRef, useState } from "react";
import { ApiRequestError, errorMessage } from "../../api";
import common from "../../App.module.css";
import { computeApi } from "./api";
import styles from "./compute.module.css";

type Props = {
  runner: Runner;
  admin: boolean;
  disabled: boolean;
  onRunner: (response: RunnerResponse) => void;
  onBusy: (busy: boolean) => void;
  onUncertain: (uncertain: boolean) => void;
  onDenied: (adminOnly: boolean) => void;
  onExpired: () => void;
  onClose: () => void;
};
type Action =
  | { kind: "approval"; approved: boolean }
  | { kind: "grant"; member: RunnerGrantMember; granted: boolean };

export function RunnerAccessPanel(props: Props) {
  const { runner, admin, disabled } = props;
  const [roster, setRoster] = useState<RunnerGrantsResponse | null>(null);
  const [access, setAccess] = useState<RunnerUseAccessResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [writeUnconfirmed, setWriteUnconfirmed] = useState(false);
  const [notice, setNotice] = useState("");
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const request = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const callbacks = useRef(props);
  useEffect(() => {
    callbacks.current = props;
  });

  function failure(cause: unknown, adminOnly: boolean, write = false) {
    setAccess(null);
    if (
      write &&
      cause instanceof ApiRequestError &&
      cause.status === 403 &&
      cause.code === "GRANT_RECIPIENT_INELIGIBLE"
    ) {
      // Recipient eligibility can change without removing this actor's admin
      // authority. Reconcile the roster without discarding enrollment state.
      setRoster(null);
      setError(errorMessage(cause));
      setWriteUnconfirmed(false);
      setRequiresRefresh(true);
      callbacks.current.onUncertain(true);
      return;
    }
    if (cause instanceof ApiRequestError && cause.status === 401) {
      setRoster(null);
      setAccess(null);
      callbacks.current.onExpired();
      return;
    }
    if (
      cause instanceof ApiRequestError &&
      (cause.status === 403 || cause.status === 404)
    ) {
      setRoster(null);
      setAccess(null);
      callbacks.current.onDenied(adminOnly && cause.status === 403);
      return;
    }
    setError(errorMessage(cause));
    setWriteUnconfirmed(write);
    setRequiresRefresh(true);
    callbacks.current.onUncertain(true);
  }

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    callbacks.current.onBusy(true);
    // Both reads are independent. Do not retain a partial roster after denial.
    void Promise.all([
      computeApi
        .useAccess(runner.teamId, runner.id, controller.signal)
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) failure(cause, false);
          throw cause;
        }),
      admin
        ? computeApi
            .grants(runner.teamId, runner.id, undefined, controller.signal)
            .catch((cause: unknown) => {
              if (!controller.signal.aborted) failure(cause, true);
              throw cause;
            })
        : Promise.resolve(null),
    ])
      .then(([personal, members]) => {
        if (controller.signal.aborted) return;
        if (
          members &&
          personal.runner.lifecycleRevision !== members.runner.lifecycleRevision
        ) {
          setAccess(null);
          setError("Permissions changed while loading. Refresh access.");
          setRequiresRefresh(true);
          callbacks.current.onUncertain(true);
          return;
        }
        setAccess(personal);
        setRoster(members);
        setError("");
        setWriteUnconfirmed(false);
        setRequiresRefresh(false);
        callbacks.current.onUncertain(false);
        callbacks.current.onRunner(personal);
      })
      .catch(() => {
        // Each endpoint reports whether the denied data is admin-only.
      })
      .finally(() => {
        if (controller.signal.aborted) return;
        busy.current = false;
        setLoading(false);
        callbacks.current.onBusy(false);
      });
    return () => {
      controller.abort();
      request.current?.abort();
      callbacks.current.onBusy(false);
    };
  }, [runner.teamId, runner.id, admin, attempt]);

  function refresh() {
    if (busy.current || disabled) return;
    setLoading(true);
    setError("");
    setWriteUnconfirmed(false);
    setAccess(null);
    setNotice("");
    setAttempt((value) => value + 1);
  }

  async function more() {
    if (!roster?.nextCursor || busy.current || disabled || requiresRefresh)
      return;
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setLoading(true);
    callbacks.current.onBusy(true);
    try {
      const next = await computeApi.grants(
        runner.teamId,
        runner.id,
        roster.nextCursor,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      if (next.runner.lifecycleRevision !== roster.runner.lifecycleRevision) {
        setAccess(null);
        setError("Permissions changed while loading members. Refresh access.");
        setRequiresRefresh(true);
        callbacks.current.onUncertain(true);
        return;
      }
      setRoster({
        ...next,
        members: [
          ...new Map(
            [...roster.members, ...next.members].map((member) => [
              member.userId,
              member,
            ]),
          ).values(),
        ],
      });
      callbacks.current.onRunner(next);
    } catch (cause) {
      if (!controller.signal.aborted) failure(cause, true);
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setLoading(false);
        callbacks.current.onBusy(false);
      }
    }
  }

  async function change(action: Action) {
    if (!admin || !roster || busy.current || disabled || requiresRefresh)
      return;
    if (
      (action.kind === "approval" || action.granted) &&
      (!runner.enrolledAt || runner.revokedAt)
    )
      return;
    if (action.kind === "grant" && action.granted && !action.member.eligible)
      return;
    const question =
      action.kind === "approval"
        ? `${action.approved ? "Approve dispatch for" : "Withdraw dispatch approval from"} runner “${runner.name}” (${runner.id})? ${action.approved ? "Only explicitly granted, eligible members can use it. This does not start work." : "Use permission will be suspended; stored grants and heartbeats remain."}`
        : `${action.granted ? "Grant" : "Remove"} use permission ${action.granted ? "for" : "from"} “${action.member.displayName}” (${action.member.userId}) on runner “${runner.name}” (${runner.id})?`;
    if (!window.confirm(question)) return;
    const controller = new AbortController();
    request.current = controller;
    busy.current = true;
    setSaving(true);
    setError("");
    setNotice("");
    callbacks.current.onUncertain(true);
    callbacks.current.onBusy(true);
    try {
      const expectedLifecycleRevision = roster.runner.lifecycleRevision;
      const response =
        action.kind === "approval"
          ? await computeApi.setApproval(
              runner.teamId,
              runner.id,
              { expectedLifecycleRevision, approved: action.approved },
              controller.signal,
            )
          : await computeApi.setGrant(
              runner.teamId,
              runner.id,
              action.member.userId,
              { expectedLifecycleRevision, granted: action.granted },
              controller.signal,
            );
      if (controller.signal.aborted) return;
      callbacks.current.onRunner(response);
      // A write changes the shared revision and can change our own grant.
      // Read back both views before enabling another write.
      setAccess(null);
      setRoster(null);
      setRequiresRefresh(true);
      callbacks.current.onUncertain(true);
      setNotice(
        "Permission saved. Refresh access to check current permissions.",
      );
    } catch (cause) {
      if (!controller.signal.aborted) failure(cause, true, true);
    } finally {
      if (!controller.signal.aborted) {
        busy.current = false;
        setSaving(false);
        callbacks.current.onBusy(false);
      }
    }
  }

  const blocked = loading || saving || disabled || requiresRefresh;
  const configurable = Boolean(runner.enrolledAt) && !runner.revokedAt;
  return (
    <section
      id={`runner-access-${runner.id}`}
      className={styles.accessPanel}
      aria-label={`Access for ${runner.name}`}
      aria-busy={loading || saving}
    >
      <div className={styles.rowHeading}>
        <h4>{admin ? "Runner access" : "Your use permission"}</h4>
        <button
          type="button"
          className={common.secondaryButton}
          onClick={props.onClose}
        >
          Close access
        </button>
      </div>
      <p className={styles.hint}>
        Approval and use grants are separate from health. Permission does not
        promise an available runner or start work.
      </p>
      {loading && <p role="status">Loading runner access…</p>}
      {saving && <p role="status">Saving permission…</p>}
      {error && (
        <div className={common.error} role="alert">
          <p>{error}</p>
          <p>
            {writeUnconfirmed
              ? "Refresh access before another change. A failed response may still have saved the permission."
              : "Refresh access to check current members and permissions before another change."}
          </p>
        </div>
      )}
      {notice && (
        <p className={common.notice} role="status">
          {notice}
        </p>
      )}
      {access && (
        <>
          <dl className={styles.facts}>
            <div>
              <dt>Your stored use grant</dt>
              <dd>{access.hasUseGrant ? "Granted" : "Not granted"}</dd>
            </div>
            <div>
              <dt>Your current use permission</dt>
              <dd>{access.useAllowed ? "Allowed" : "Not allowed"}</dd>
            </div>
          </dl>
          <p className={styles.hint}>
            Last checked{" "}
            <time dateTime={access.observedAt}>
              {new Date(access.observedAt).toLocaleString()}
            </time>
            . Refresh access to check again.
          </p>
        </>
      )}
      {admin && roster && (
        <>
          <p className={styles.hint}>
            Every member, including admins, needs an explicit use grant. Only
            active admins and developers are eligible. A stored grant becomes
            effective again if a member regains eligibility.
          </p>
          {configurable ? (
            <button
              type="button"
              className={common.secondaryButton}
              disabled={blocked}
              onClick={() =>
                void change({
                  kind: "approval",
                  approved: !roster.runner.dispatchApproved,
                })
              }
            >
              {roster.runner.dispatchApproved
                ? "Withdraw dispatch approval"
                : "Approve dispatch"}
            </button>
          ) : (
            <p className={styles.hint}>
              {runner.revokedAt
                ? "This runner is revoked. Its stored grants grant no use permission and may be removed."
                : "Enroll this runner before approving dispatch or adding grants."}
            </p>
          )}
          <h4 className={styles.memberHeading}>Member use grants</h4>
          {roster.members.length ? (
            <ul className={styles.memberList}>
              {roster.members.map((member) => (
                <li key={member.userId}>
                  <div>
                    <strong>{member.displayName}</strong>
                    <p className={styles.identifier}>{member.userId}</p>
                    <p className={styles.hint}>
                      {member.role} ·{" "}
                      {member.eligible ? "Eligible" : "Currently ineligible"} ·{" "}
                      {member.granted ? "Grant stored" : "No grant"}
                    </p>
                  </div>
                  {(member.granted || (configurable && member.eligible)) && (
                    <button
                      type="button"
                      className={common.secondaryButton}
                      aria-label={`${member.granted ? "Remove grant from" : "Grant use to"} ${member.displayName} (${member.userId})`}
                      disabled={blocked}
                      onClick={() =>
                        void change({
                          kind: "grant",
                          member,
                          granted: !member.granted,
                        })
                      }
                    >
                      {member.granted ? "Remove grant" : "Grant use"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>No eligible members or stored grants.</p>
          )}
          {roster.nextCursor && (
            <button
              type="button"
              className={common.secondaryButton}
              disabled={blocked}
              onClick={() => void more()}
            >
              Load more members
            </button>
          )}
        </>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={common.secondaryButton}
          disabled={loading || saving || disabled}
          onClick={refresh}
        >
          Refresh access
        </button>
      </div>
    </section>
  );
}
