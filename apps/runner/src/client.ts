import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import {
  EnrollmentTokenSchema,
  RUNNER_HEARTBEAT_INTERVAL_SECONDS,
  RunnerResponseSchema,
} from "@ark/contracts";

export function localRunnerUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Use a local HTTP endpoint; its value is withheld.");
  }
  if (
    url.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Use loopback HTTP without credentials, paths, queries, or fragments.",
    );
  return url;
}

export function runnerOptions(args: string[]): {
  api: URL;
  origin: string;
  help: boolean;
} {
  let api = "http://127.0.0.1:3001";
  let origin: string | undefined;
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === "--help" && args.length === 1)
      return { api: localRunnerUrl(api), origin: api, help: true };
    const value = args[++index];
    if (!value || (flag !== "--api" && flag !== "--origin"))
      throw new Error(
        "Use --api and optional --origin, or --help. Enter the enrollment code through stdin.",
      );
    if (flag === "--api") api = value;
    else origin = value;
  }
  const endpoint = localRunnerUrl(api);
  return {
    api: endpoint,
    origin: localRunnerUrl(origin ?? endpoint.origin).origin,
    help: false,
  };
}

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

type Fetch = typeof fetch;
type Sleep = (milliseconds: number, signal: AbortSignal) => Promise<void>;
export type RunnerOptions = {
  api: URL;
  origin: string;
  enrollmentToken: string;
  signal: AbortSignal;
  onStatus: (message: string) => void;
  fetcher?: Fetch;
  sleep?: Sleep;
  timeoutMilliseconds?: number;
};

export async function runRunner(options: RunnerOptions): Promise<void> {
  const api = localRunnerUrl(options.api.toString());
  const origin = localRunnerUrl(options.origin).origin;
  const parsed = EnrollmentTokenSchema.safeParse(options.enrollmentToken);
  if (!parsed.success)
    throw new Error("Enrollment code is invalid; its value is withheld.");
  const id = parsed.data.split("_")[2]!;
  const credential = `ark_runner_${id}_${randomBytes(32).toString("hex")}`;
  const fetcher = options.fetcher ?? fetch;
  const sleep: Sleep =
    options.sleep ??
    (async (milliseconds, signal) => {
      await delay(milliseconds, undefined, { signal });
    });
  const timeout = options.timeoutMilliseconds ?? 5_000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30_000)
    throw new Error(
      "Request timeout must be between 1 and 30000 milliseconds.",
    );
  async function request(path: string, token: string, body: object) {
    if (options.signal.aborted) throw new Error("Runner stopped.");
    try {
      const response = await fetcher(new URL(path, api), {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]),
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new RunnerRequestError(response.status);
      const value = RunnerResponseSchema.safeParse(await response.json());
      if (
        !value.success ||
        value.data.runner.id !== id ||
        value.data.runner.enrolledAt === null ||
        value.data.runner.revokedAt !== null
      )
        throw new RunnerRequestError(502);
      return value.data;
    } catch (error) {
      if (options.signal.aborted) throw error;
      if (error instanceof RunnerRequestError) throw error;
      throw new RunnerRequestError(0);
    }
  }
  let connected = false;
  let enrollmentUncertain = false;
  let failures = 0;
  while (!options.signal.aborted) {
    try {
      if (!connected) {
        try {
          await request("/api/runner/enroll", parsed.data, {
            runnerCredential: credential,
          });
        } catch (error) {
          if (options.signal.aborted) throw error;
          if (error instanceof RunnerRequestError && error.retryable)
            enrollmentUncertain = true;
          // A lost enrollment response may already have committed. Prove possession
          // of the candidate credential before retrying the same exchange.
          try {
            await request("/api/runner/heartbeat", credential, {});
          } catch (recoveryError) {
            // The code may have expired after a committed exchange whose response
            // was lost. An unavailable heartbeat does not disprove the candidate
            // identity; keep it until recovery succeeds or authentication rejects it.
            if (
              enrollmentUncertain &&
              recoveryError instanceof RunnerRequestError &&
              recoveryError.retryable
            )
              throw recoveryError;
            throw error;
          }
        }
        connected = true;
        options.onStatus(
          "Runner enrolled. Heartbeats only; execution is unavailable.",
        );
      }
      await request("/api/runner/heartbeat", credential, {});
      if (failures > 0) options.onStatus("Connection restored.");
      else if (connected) options.onStatus("Heartbeat accepted.");
      failures = 0;
      await sleep(RUNNER_HEARTBEAT_INTERVAL_SECONDS * 1000, options.signal);
    } catch (error) {
      if (options.signal.aborted) return;
      if (!(error instanceof RunnerRequestError) || !error.retryable)
        throw error;
      failures++;
      if (failures >= 10)
        throw new Error(
          "Connection did not recover after ten attempts. The foreground runner stopped.",
        );
      options.onStatus(
        "Local API unavailable. Retrying the same runner identity.",
      );
      try {
        await sleep(
          Math.min(1000 * 2 ** (failures - 1), 15_000),
          options.signal,
        );
      } catch (error) {
        if (options.signal.aborted) return;
        throw error;
      }
    }
  }
}
