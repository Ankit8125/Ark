import { randomBytes, randomUUID } from "node:crypto";
import {
  SESSION_STUB_RUNTIME,
  SessionClaimResponseSchema,
  SessionJobSchema,
  stubStageOutputs,
  type SessionAdvanceRequest,
  type SessionClaimRequest,
  type SessionJob,
} from "@ark/contracts";

export class RunnerRequestError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(
      status === 401 || status === 403
        ? "Runner authentication was rejected. Revoke the old record and issue a new enrollment code if needed."
        : status === 0
          ? "Cannot reach the local API."
          : "The local API rejected the runner request.",
    );
    this.status = status;
  }
  get retryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

export type RunnerSleep = (
  milliseconds: number,
  signal: AbortSignal,
) => Promise<void>;
export type SessionRunnerOptions = {
  runnerId: string;
  signal: AbortSignal;
  onStatus: (message: string) => void;
  request: (
    path: string,
    body: SessionClaimRequest | SessionAdvanceRequest,
    signal: AbortSignal,
  ) => Promise<unknown>;
  sleep: RunnerSleep;
};

const claimPath = "/api/runner/sessions/claim";
const advancePath = "/api/runner/sessions/advance";
const terminal = new Set(["cancelled", "failed", "completed"]);

// This worker evaluates only the shared, pure stub. It never reads a repository,
// launches a process, or interprets saved Agent instructions as executable work.
export async function runStubSessions(
  options: SessionRunnerOptions,
): Promise<void> {
  let candidate: SessionClaimRequest | undefined;
  let job: SessionJob | undefined;
  let pending: SessionAdvanceRequest | undefined;
  let claimUncertain = false;
  let reconcile = false;
  let mustStop = false;
  let failures = 0;
  let lastStatus = "";
  const status = (message: string) => {
    if (lastStatus === message) return;
    lastStatus = message;
    options.onStatus(message);
  };
  function assigned(value: unknown, previous?: SessionJob): SessionJob {
    const parsed = SessionJobSchema.safeParse(value);
    if (
      !parsed.success ||
      parsed.data.session.runnerId !== options.runnerId ||
      parsed.data.lease.id !== candidate?.claimId ||
      parsed.data.session.stageIndex >
        parsed.data.session.snapshot.flow.definition.stages.length ||
      parsed.data.lease.generation !== 1 ||
      (parsed.data.lease.status === "released" &&
        !terminal.has(parsed.data.session.state)) ||
      (previous &&
        (parsed.data.session.id !== previous.session.id ||
          parsed.data.lease.id !== previous.lease.id ||
          parsed.data.lease.generation !== previous.lease.generation))
    )
      throw new RunnerRequestError(502);
    return parsed.data;
  }
  async function claim(signal: AbortSignal): Promise<SessionJob | null> {
    claimUncertain = true;
    const response = SessionClaimResponseSchema.safeParse(
      await options.request(claimPath, candidate!, signal),
    );
    if (!response.success || (job && response.data.job === null))
      throw new RunnerRequestError(502);
    const result = response.data.job ? assigned(response.data.job, job) : null;
    claimUncertain = false;
    return result;
  }
  function stopped(current: SessionJob): SessionAdvanceRequest {
    return {
      eventId: randomUUID(),
      leaseId: current.lease.id,
      leaseToken: candidate!.leaseToken,
      generation: current.lease.generation,
      expectedRevision: current.session.revision,
      kind: "stopped",
      confirmedStopped: true,
    };
  }
  function released(current: SessionJob): boolean {
    if (current.lease.status !== "released") return false;
    status(
      current.session.state === "completed"
        ? "Stub session completed; quality remains not evaluated."
        : "Stub session stopped; ownership released by the API.",
    );
    candidate = undefined;
    job = undefined;
    pending = undefined;
    reconcile = false;
    mustStop = false;
    failures = 0;
    return true;
  }
  async function shutdown(): Promise<void> {
    if (!job || !candidate) {
      if (claimUncertain)
        status(
          "Session assignment is uncertain. Ownership may remain reserved; administrator reconciliation may be required.",
        );
      return;
    }
    // Abort cancels the pure evaluator before this point. Reconcile a possibly
    // committed pending event before acknowledging stop, with one bounded cleanup
    // window independent of the already-aborted foreground signal.
    const cleanup = AbortSignal.timeout(5_000);
    let stop: SessionAdvanceRequest | undefined;
    let needsClaim = true;
    for (let attempt = 0; attempt < 3 && !cleanup.aborted; attempt++) {
      try {
        if (needsClaim) {
          const current = await claim(cleanup);
          if (!current) break;
          job = current;
          if (released(current)) return;
          stop = stopped(current);
          needsClaim = false;
        }
        const result = assigned(
          await options.request(advancePath, stop!, cleanup),
          job,
        );
        job = result;
        if (released(result)) return;
        needsClaim = true;
      } catch (error) {
        if (error instanceof RunnerRequestError && error.status === 409) {
          needsClaim = true;
          continue;
        }
        if (!(error instanceof RunnerRequestError) || !error.retryable) break;
        // A lost stop response repeats the exact stop UUID and payload.
      }
    }
    status(
      "Stub stopped locally. API ownership is unconfirmed and remains reserved until recovery or administrator reconciliation.",
    );
  }

  try {
    while (!options.signal.aborted) {
      try {
        candidate ??= {
          claimId: randomUUID(),
          leaseToken: randomBytes(32).toString("hex"),
          runtime: SESSION_STUB_RUNTIME,
        };
        if (!job || reconcile) {
          const current = await claim(options.signal);
          if (!current) {
            candidate = undefined;
            failures = 0;
            await options.sleep(1_000, options.signal);
            continue;
          }
          job = current;
          pending = undefined;
          reconcile = false;
          if (released(current)) continue;
          status(
            "Stub session assigned. Only deterministic stub values execute.",
          );
        }
        if (job.session.state !== "running" || job.lease.status !== "active")
          mustStop = true;
        if (!pending) {
          if (mustStop) {
            status("Stub session stopping; awaiting API ownership release.");
            pending = stopped(job);
          } else {
            const common = {
              eventId: randomUUID(),
              leaseId: job.lease.id,
              leaseToken: candidate!.leaseToken,
              generation: job.lease.generation,
              expectedRevision: job.session.revision,
            };
            const stage =
              job.session.snapshot.flow.definition.stages[
                job.session.stageIndex
              ];
            if (stage) {
              await options.sleep(1_000, options.signal);
              if (options.signal.aborted) break;
              pending = {
                ...common,
                kind: "stage_completed",
                stageId: stage.id,
                outputs: stubStageOutputs(job.session),
              };
            } else {
              pending = {
                ...common,
                kind: "completed",
                confirmedStopped: true,
              };
            }
          }
        }
        const current = assigned(
          await options.request(advancePath, pending, options.signal),
          job,
        );
        job = current;
        pending = undefined;
        failures = 0;
        if (released(current)) continue;
      } catch (error) {
        if (options.signal.aborted) break;
        const conflict =
          error instanceof RunnerRequestError && error.status === 409;
        if (conflict) {
          // A stale revision may mean cancellation or expiry. Discover it using
          // the original claim and then stop; never rebase ordinary work.
          reconcile = true;
          mustStop = true;
        } else if (!(error instanceof RunnerRequestError) || !error.retryable) {
          throw error instanceof RunnerRequestError
            ? error
            : new Error("The deterministic stub runner could not continue.");
        }
        if (++failures >= 10)
          throw new Error(
            "Session connection did not recover after ten attempts. Ownership remains reserved until recovery or administrator reconciliation.",
          );
        status(
          conflict
            ? "Session changed. Reconciling the same claim before stopping."
            : "Session API unavailable. Retrying the same claim or event.",
        );
        try {
          await options.sleep(
            Math.min(1_000 * 2 ** (failures - 1), 15_000),
            options.signal,
          );
        } catch {
          if (options.signal.aborted) break;
          throw new Error("The deterministic stub runner could not continue.");
        }
      }
    }
  } finally {
    if (options.signal.aborted) await shutdown();
  }
}
