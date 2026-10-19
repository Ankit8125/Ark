import { PassThrough } from "node:stream";
import type { ReadStream } from "node:tty";
import { describe, expect, it, vi } from "vitest";
import {
  CreateRunnerEnrollmentRequestSchema,
  EnrollmentTokenSchema,
  RunnerCredentialSchema,
  RunnerHeartbeatRequestSchema,
  RevokeRunnerRequestSchema,
  type RunnerResponse,
} from "@ark/contracts";
import {
  localRunnerUrl,
  runnerOptions,
  runRunner,
} from "../../apps/runner/src/client.js";
import { readEnrollmentCode } from "../../apps/runner/src/input.js";

const id = "0a374857-e74b-4b4e-9fea-ab0866566055";
const code = `ark_enroll_${id}_${"a".repeat(64)}`;
const response: RunnerResponse = {
  observedAt: "2026-10-14T00:00:01.000Z",
  runner: {
    id,
    organizationId: id,
    teamId: id,
    name: "Local heartbeat",
    lifecycleRevision: 2,
    createdAt: "2026-10-14T00:00:00.000Z",
    enrollmentExpiresAt: "2026-10-14T00:10:00.000Z",
    enrolledAt: "2026-10-14T00:00:01.000Z",
    lastHeartbeatAt: null,
    revokedAt: null,
    health: "unknown",
    dispatchApproved: false,
  },
};
const ok = () =>
  new Response(JSON.stringify(response), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
function harness() {
  const controller = new AbortController();
  const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => ok());
  const onStatus = vi.fn<(message: string) => void>();
  const sleep = vi
    .fn<(ms: number, signal: AbortSignal) => Promise<void>>()
    .mockImplementation(async () => controller.abort());
  const options = {
    api: localRunnerUrl("http://127.0.0.1:3001"),
    origin: "http://127.0.0.1:3001",
    enrollmentToken: code,
    signal: controller.signal,
    onStatus,
    fetcher,
    sleep,
  };
  return { controller, fetcher, onStatus, sleep, options };
}
describe("runner contracts and local endpoints", () => {
  it("validates realm, embedded UUID, name text, pairing, and strict empty heartbeats", () => {
    expect(EnrollmentTokenSchema.parse(code)).toBe(code);
    const credential = `ark_runner_${id}_${"b".repeat(64)}`;
    expect(RunnerCredentialSchema.parse(credential)).toBe(credential);
    for (const bad of [
      credential,
      `ark_enroll_${"-".repeat(36)}_${"a".repeat(64)}`,
      code + "extra",
      code.toUpperCase(),
    ])
      expect(EnrollmentTokenSchema.safeParse(bad).success).toBe(false);
    for (const name of ["", "\u0000", "\ud800", "a".repeat(81)])
      expect(
        CreateRunnerEnrollmentRequestSchema.safeParse({
          id,
          name,
          enrollmentToken: code,
        }).success,
      ).toBe(false);
    expect(
      CreateRunnerEnrollmentRequestSchema.safeParse({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Node",
        enrollmentToken: code,
      }).success,
    ).toBe(false);
    expect(
      RunnerHeartbeatRequestSchema.safeParse({ timestamp: Date.now() }).success,
    ).toBe(false);
    expect(
      RevokeRunnerRequestSchema.safeParse({ expectedLifecycleRevision: 0 })
        .success,
    ).toBe(false);
  });
  it.each([
    "https://127.0.0.1:3001",
    "http://example.test:3001",
    "http://localhost:3001/api",
    "http://localhost:3001?token=withheld",
    "http://localhost:3001#fragment",
    "http://user:REPLACE_PASSWORD@localhost:3001",
    "file:///tmp/local",
    "not a URL",
  ])("rejects unsafe endpoint without echoing it: %s", (value) => {
    expect(() => localRunnerUrl(value)).toThrow();
    try {
      localRunnerUrl(value);
    } catch (error) {
      expect(String(error)).not.toContain(value);
    }
  });
  it("validates flags and defaults without accepting a credential argument", () => {
    expect(runnerOptions([]).api.origin).toBe("http://127.0.0.1:3001");
    expect(
      runnerOptions([
        "--api",
        "http://localhost:3002",
        "--origin",
        "http://localhost:5184",
      ]).origin,
    ).toBe("http://localhost:5184");
    expect(runnerOptions(["--help"]).help).toBe(true);
    for (const args of [["--token", code], ["--api"], ["--unknown", "value"]])
      expect(() => runnerOptions(args)).toThrow();
  });
});
describe("foreground heartbeat client", () => {
  it("enrolls then heartbeats with distinct credentials and no redirects or secret output", async () => {
    const { options, fetcher, onStatus } = harness();
    await runRunner(options);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(String(url)).toBe("http://127.0.0.1:3001/api/runner/enroll");
    expect(init!.redirect).toBe("error");
    expect(init!.headers).toMatchObject({
      Origin: options.origin,
      Authorization: `Bearer ${code}`,
    });
    const credential = JSON.parse(String(init!.body)).runnerCredential;
    expect(RunnerCredentialSchema.safeParse(credential).success).toBe(true);
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({
      Authorization: `Bearer ${credential}`,
    });
    expect(fetcher.mock.calls[1]![1]!.body).toBe("{}");
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain(code);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain(credential);
  });
  it("reconciles a lost enrollment response through the same candidate credential", async () => {
    const { options, fetcher } = harness();
    fetcher.mockRejectedValueOnce(
      new Error("Lost response containing private details"),
    );
    await runRunner(options);
    expect(
      fetcher.mock.calls.map((call) => new URL(String(call[0])).pathname),
    ).toEqual([
      "/api/runner/enroll",
      "/api/runner/heartbeat",
      "/api/runner/heartbeat",
    ]);
    const credential = JSON.parse(
      String(fetcher.mock.calls[0]![1]!.body),
    ).runnerCredential;
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({
      Authorization: `Bearer ${credential}`,
    });
  });
  it("retries an uncommitted enrollment with the identical code and candidate", async () => {
    const { options, fetcher, sleep, controller } = harness();
    fetcher
      .mockRejectedValueOnce(new Error("Dropped before commit"))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    sleep.mockImplementation(async (ms) => {
      if (ms === 15_000) controller.abort();
    });
    await runRunner(options);
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[2]![1]!.body).toBe(
      fetcher.mock.calls[0]![1]!.body,
    );
    expect(sleep.mock.calls[0]![0]).toBe(1000);
  });
  it("retains an uncertain identity when its code expires while the API recovers", async () => {
    const { options, fetcher, sleep, controller } = harness();
    fetcher
      .mockRejectedValueOnce(new Error("Response lost after commit"))
      .mockRejectedValueOnce(new Error("API offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockRejectedValueOnce(new Error("Heartbeat endpoint unavailable"))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    sleep.mockImplementation(async (ms) => {
      if (ms === 15_000) controller.abort();
    });
    await runRunner(options);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 15_000]);
    expect(
      fetcher.mock.calls.map(([url]) => new URL(String(url)).pathname),
    ).toEqual([
      "/api/runner/enroll",
      "/api/runner/heartbeat",
      "/api/runner/enroll",
      "/api/runner/heartbeat",
      "/api/runner/enroll",
      "/api/runner/heartbeat",
      "/api/runner/heartbeat",
    ]);
    const candidateBody = fetcher.mock.calls[0]![1]!.body;
    expect(fetcher.mock.calls[2]![1]!.body).toBe(candidateBody);
    expect(fetcher.mock.calls[4]![1]!.body).toBe(candidateBody);
  });
  it("stops after code and candidate authentication reject an uncertain exchange", async () => {
    const { options, fetcher, sleep } = harness();
    fetcher
      .mockRejectedValueOnce(new Error("Response lost"))
      .mockRejectedValueOnce(new Error("API offline"))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockResolvedValueOnce(new Response("{}", { status: 401 }));
    sleep.mockResolvedValue();
    await expect(runRunner(options)).rejects.toThrow(
      "authentication was rejected",
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(4);
  });
  it("does not retry an invalid enrollment merely because reconciliation is unavailable", async () => {
    const { options, fetcher, sleep } = harness();
    fetcher
      .mockResolvedValueOnce(new Response("{}", { status: 401 }))
      .mockRejectedValueOnce(new Error("API offline"));
    await expect(runRunner(options)).rejects.toThrow(
      "authentication was rejected",
    );
    expect(sleep).not.toHaveBeenCalled();
  });
  it.each([401, 403])(
    "stops immediately when an enrolled runner is rejected with %s",
    async (status) => {
      const { options, fetcher, sleep } = harness();
      fetcher
        .mockResolvedValueOnce(ok())
        .mockResolvedValueOnce(
          new Response("private server details", { status }),
        );
      await expect(runRunner(options)).rejects.toThrow(
        "Runner authentication was rejected",
      );
      expect(sleep).not.toHaveBeenCalled();
    },
  );
  it("bounds repeated connection failures and never logs raw errors or secrets", async () => {
    const { options, fetcher, sleep, onStatus } = harness();
    fetcher.mockRejectedValue(new Error(code));
    sleep.mockResolvedValue();
    await expect(runRunner(options)).rejects.toThrow("ten attempts");
    expect(sleep).toHaveBeenCalledTimes(9);
    expect(Math.max(...sleep.mock.calls.map((call) => call[0]))).toBe(15_000);
    expect(JSON.stringify(onStatus.mock.calls)).not.toContain(code);
  });
  it("resets heartbeat backoff after the API recovers without reenrolling", async () => {
    const { options, fetcher, sleep, controller, onStatus } = harness();
    fetcher
      .mockResolvedValueOnce(ok())
      .mockRejectedValueOnce(new Error("Offline"))
      .mockRejectedValueOnce(new Error("Still offline"))
      .mockResolvedValueOnce(ok())
      .mockRejectedValueOnce(new Error("Offline again"))
      .mockResolvedValueOnce(ok());
    let successfulHeartbeats = 0;
    sleep.mockImplementation(async (ms) => {
      if (ms === 15_000 && ++successfulHeartbeats === 2) controller.abort();
    });
    await runRunner(options);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      1000, 2000, 15_000, 1000, 15_000,
    ]);
    expect(
      fetcher.mock.calls
        .slice(1)
        .every(
          ([url]) => new URL(String(url)).pathname === "/api/runner/heartbeat",
        ),
    ).toBe(true);
    expect(
      onStatus.mock.calls.filter(
        ([message]) => message === "Connection restored.",
      ),
    ).toHaveLength(2);
  });
  it("does not send requests when shutdown already happened", async () => {
    const { options, controller, fetcher, sleep } = harness();
    controller.abort();
    await runRunner(options);
    expect(fetcher).not.toHaveBeenCalled();
    expect(sleep).not.toHaveBeenCalled();
  });
  it("aborts a pending real request timeout and backoff when stopped", async () => {
    const { options, fetcher, controller, sleep } = harness();
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("Aborted")),
            { once: true },
          ),
        ),
    );
    const running = runRunner(options);
    controller.abort();
    await running;
    expect(sleep).not.toHaveBeenCalled();
    const second = harness();
    second.fetcher.mockRejectedValue(new Error("Offline"));
    second.sleep.mockImplementation(async (_ms, signal) => {
      second.controller.abort();
      if (signal.aborted) throw new Error("Aborted");
    });
    await runRunner(second.options);
  });
  it("times out an unresponsive fetch with no raw network detail in its status", async () => {
    const { options, fetcher, sleep, controller } = harness();
    fetcher.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init!.signal!.addEventListener(
            "abort",
            () => reject(new Error("Timeout with private fields")),
            { once: true },
          ),
        ),
    );
    sleep.mockImplementation(async () => controller.abort());
    await runRunner({ ...options, timeoutMilliseconds: 5 });
    expect(sleep).toHaveBeenCalledTimes(1);
  });
  it("refuses a successful response for another identity", async () => {
    const { options, fetcher, sleep, controller } = harness();
    fetcher.mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            ...response,
            runner: {
              ...response.runner,
              id: "00000000-0000-4000-8000-000000000001",
            },
          }),
        ),
    );
    sleep.mockImplementation(async () => controller.abort());
    await runRunner(options);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});
describe("hidden enrollment input", () => {
  function input(hidden = true) {
    const stream = new PassThrough() as unknown as ReadStream;
    const output = new PassThrough();
    Object.defineProperties(stream, {
      isTTY: { value: hidden },
      isRaw: { value: false },
    });
    stream.setRawMode = vi.fn().mockReturnValue(stream);
    let printed = "";
    output.on("data", (chunk) => {
      printed += String(chunk);
    });
    return { stream, output, printed: () => printed };
  }
  it("never echoes typed code and restores terminal mode", async () => {
    const { stream, output, printed } = input();
    const controller = new AbortController();
    const pending = readEnrollmentCode(stream, output, controller.signal);
    stream.emit("data", code + "\r");
    expect(await pending).toBe(code);
    expect(printed()).not.toContain(code);
    expect(stream.setRawMode).toHaveBeenLastCalledWith(false);
  });
  it("reads a noninteractive pipe through EOF without writing its contents or changing terminal mode", async () => {
    const { stream, output, printed } = input(false);
    const pending = readEnrollmentCode(
      stream,
      output,
      new AbortController().signal,
    );
    stream.emit("data", code.slice(0, 40));
    stream.emit("data", code.slice(40));
    stream.emit("end");
    expect(await pending).toBe(code);
    expect(printed()).toBe("");
    expect(stream.setRawMode).not.toHaveBeenCalled();
  });
  it("handles backspace without echoing secret input", async () => {
    const { stream, output, printed } = input();
    const pending = readEnrollmentCode(
      stream,
      output,
      new AbortController().signal,
    );
    stream.emit("data", `${code}x\b\r`);
    expect(await pending).toBe(code);
    expect(printed()).not.toContain(code);
  });
  it("rejects a pipe closed before EOF and removes its input listeners", async () => {
    const { stream, output } = input(false);
    const pending = readEnrollmentCode(
      stream,
      output,
      new AbortController().signal,
    );
    const assertion = expect(pending).rejects.toThrow("Could not read");
    stream.destroy();
    await assertion;
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("end")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(stream.listenerCount("close")).toBe(0);
  });
  it("rejects already destroyed input without entering raw mode", async () => {
    const { stream, output } = input();
    stream.destroy();
    await expect(
      readEnrollmentCode(stream, output, new AbortController().signal),
    ).rejects.toThrow("Could not read");
    expect(stream.setRawMode).not.toHaveBeenCalled();
  });
  it("settles with a safe error when restoring terminal mode fails", async () => {
    const { stream, output, printed } = input();
    vi.mocked(stream.setRawMode)
      .mockImplementationOnce(() => stream)
      .mockImplementationOnce(() => {
        throw new Error(code);
      });
    const pending = readEnrollmentCode(
      stream,
      output,
      new AbortController().signal,
    );
    const assertion = expect(pending).rejects.toThrow("Could not read");
    expect(() => stream.emit("data", code + "\r")).not.toThrow();
    await assertion;
    expect(printed()).not.toContain(code);
    expect(stream.listenerCount("data")).toBe(0);
  });
  it("does not touch the terminal when input was cancelled before reading", async () => {
    const { stream, output, printed } = input();
    const controller = new AbortController();
    controller.abort();
    await expect(
      readEnrollmentCode(stream, output, controller.signal),
    ).rejects.toThrow("Runner stopped");
    expect(stream.setRawMode).not.toHaveBeenCalled();
    expect(printed()).toBe("");
  });
  it.each(["ctrlc", "abort", "error", "oversized"])(
    "restores terminal mode on %s",
    async (kind) => {
      const { stream, output, printed } = input();
      const controller = new AbortController();
      const pending = readEnrollmentCode(stream, output, controller.signal);
      const assertion = expect(pending).rejects.toThrow();
      if (kind === "ctrlc") stream.emit("data", "\u0003");
      else if (kind === "abort") controller.abort();
      else if (kind === "error") stream.emit("error", new Error(code));
      else stream.emit("data", "a".repeat(129));
      await assertion;
      expect(stream.setRawMode).toHaveBeenLastCalledWith(false);
      expect(printed()).not.toContain(code);
    },
  );
});
