import { describe, expect, it, vi } from "vitest";
import {
  SessionAdvanceRequestSchema,
  SessionClaimRequestSchema,
  stubFinalOutputs,
  stubStageOutputs,
  type SessionAdvanceRequest,
  type SessionClaimRequest,
  type SessionJob,
} from "@ark/contracts";
import {
  RunnerRequestError,
  runStubSessions,
  type SessionRunnerOptions,
} from "../../apps/runner/src/sessions.js";

const runnerId = "0a374857-e74b-4b4e-9fea-ab0866566055";
const sessionId = "1a374857-e74b-4b4e-9fea-ab0866566055";
const leaseId = "2a374857-e74b-4b4e-9fea-ab0866566055";
const firstStage = "3a374857-e74b-4b4e-9fea-ab0866566055";
const secondStage = "4a374857-e74b-4b4e-9fea-ab0866566055";
const reference = {
  resourceId: "5a374857-e74b-4b4e-9fea-ab0866566055",
  versionId: "6a374857-e74b-4b4e-9fea-ab0866566055",
};
const timestamp = "2026-10-25T00:00:00.000Z";

function initialJob(): SessionJob {
  return {
    session: {
      id: sessionId,
      organizationId: runnerId,
      teamId: runnerId,
      startedBy: runnerId,
      runnerId,
      flowResourceId: reference.resourceId,
      flowVersionId: reference.versionId,
      flowName: "Stub sequence",
      state: "running",
      revision: 2,
      stageIndex: 0,
      blockReason: null,
      runtime: "stub.v1",
      quality: "not_evaluated",
      createdAt: timestamp,
      updatedAt: timestamp,
      inputValues: { task: { type: "text", value: "A request" } },
      stageResults: {},
      outputs: null,
      snapshot: {
        flow: {
          ...reference,
          definition: {
            name: "Stub sequence",
            description: "",
            workspace: reference,
            inputs: [{ name: "task", type: "text" }],
            stages: [
              {
                id: firstStage,
                name: "Prepare",
                agent: reference,
                inputs: [
                  {
                    name: "request",
                    type: "text",
                    source: { kind: "flow_input", port: "task" },
                  },
                ],
                outputs: [{ name: "plan", type: "json" }],
              },
              {
                id: secondStage,
                name: "Review",
                agent: reference,
                inputs: [
                  {
                    name: "proposal",
                    type: "json",
                    source: {
                      kind: "stage_output",
                      stageId: firstStage,
                      port: "plan",
                    },
                  },
                ],
                outputs: [{ name: "report", type: "text" }],
              },
            ],
            outputs: [
              {
                name: "result",
                type: "text",
                source: {
                  kind: "stage_output",
                  stageId: secondStage,
                  port: "report",
                },
              },
            ],
          },
        },
        workspace: {
          ...reference,
          definition: {
            name: "Unused repository configuration",
            description: "",
            repositoryUrl: "https://example.com/unused/repository",
            sourceRef: "main",
            defaultBranch: "main",
            sandboxImage: "node:24",
            workingDirectory: ".",
            actions: { install: "", test: "", lint: "", build: "" },
          },
        },
        agents: [
          {
            ...reference,
            definition: {
              name: "Stub",
              description: "",
              instructions: "Saved configuration only.",
              runtime: "stub",
              modelPreference: null,
              capabilities: [],
            },
          },
        ],
      },
    },
    lease: {
      id: leaseId,
      generation: 1,
      status: "active",
      expiresAt: "2026-10-25T00:00:45.000Z",
    },
  };
}

function harness() {
  const controller = new AbortController();
  const onStatus = vi.fn<(message: string) => void>();
  const state = { job: initialJob(), released: false };
  const receipts = new Map<string, string>();
  let assignedClaim: SessionClaimRequest | undefined;
  const serve: SessionRunnerOptions["request"] = async (path, body) => {
    if (path.endsWith("/claim")) {
      const candidate = SessionClaimRequestSchema.parse(body);
      if (!assignedClaim && !state.released) {
        assignedClaim = structuredClone(candidate);
        state.job.lease.id = candidate.claimId;
      }
      if (candidate.claimId === assignedClaim?.claimId) {
        expect(candidate).toEqual(assignedClaim);
        return { job: structuredClone(state.job) };
      }
      return { job: null };
    }
    expect(path).toBe("/api/runner/sessions/advance");
    const event = SessionAdvanceRequestSchema.parse(body);
    const prior = receipts.get(event.eventId);
    if (prior) {
      expect(JSON.stringify(event)).toBe(prior);
      return structuredClone(state.job);
    }
    expect(event.expectedRevision).toBe(state.job.session.revision);
    receipts.set(event.eventId, JSON.stringify(event));
    if (event.kind === "stage_completed") {
      expect(event.outputs).toEqual(stubStageOutputs(state.job.session));
      state.job.session.stageResults[event.stageId] = event.outputs;
      state.job.session.stageIndex++;
    } else {
      expect(event.confirmedStopped).toBe(true);
      if (event.kind === "completed") {
        expect(state.job.session.stageIndex).toBe(2);
        state.job.session.outputs = stubFinalOutputs(state.job.session);
        state.job.session.state = "completed";
      } else {
        state.job.session.state =
          state.job.session.state === "cancelling" ? "cancelled" : "failed";
      }
      state.job.lease.status = "released";
      state.released = true;
    }
    state.job.session.revision++;
    return structuredClone(state.job);
  };
  const request = vi.fn<SessionRunnerOptions["request"]>(serve);
  const sleep = vi.fn<SessionRunnerOptions["sleep"]>(async () => {
    if (state.released) controller.abort();
  });
  const options: SessionRunnerOptions = {
    runnerId,
    signal: controller.signal,
    onStatus,
    request,
    sleep,
  };
  const advances = () =>
    request.mock.calls
      .filter(([path]) => path.endsWith("/advance"))
      .map(([, body]) => body as SessionAdvanceRequest);
  const claims = () =>
    request.mock.calls
      .filter(([path]) => path.endsWith("/claim"))
      .map(([, body]) => body as SessionClaimRequest);
  return {
    options,
    request,
    sleep,
    controller,
    onStatus,
    state,
    serve,
    advances,
    claims,
  };
}

describe("opt-in deterministic session worker", () => {
  it("resolves ordered saved bindings, then completes only after every stage and explicit stop confirmation", async () => {
    const h = harness();
    await runStubSessions(h.options);
    expect(h.advances().map((event) => event.kind)).toEqual([
      "stage_completed",
      "stage_completed",
      "completed",
    ]);
    expect(h.state.job.session.outputs).toEqual({
      result: { type: "text", value: "[stub.v1] Review.report (proposal)" },
    });
    expect(h.state.job.session.quality).toBe("not_evaluated");
    expect(h.sleep.mock.calls.slice(0, 2).map(([ms]) => ms)).toEqual([
      1_000, 1_000,
    ]);
    expect(h.claims()[0]).toMatchObject({
      runtime: "stub.v1",
      leaseToken: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(new Set(h.advances().map((event) => event.eventId)).size).toBe(3);
    expect(JSON.stringify(h.onStatus.mock.calls)).not.toContain(
      h.claims()[0]!.leaseToken,
    );
  });

  it("retains the same generated claim UUID and lease token after a lost assignment response", async () => {
    const h = harness();
    h.request.mockRejectedValueOnce(new RunnerRequestError(0));
    await runStubSessions(h.options);
    expect(h.claims()[1]).toEqual(h.claims()[0]);
    expect(h.claims()[2]!.claimId).not.toBe(h.claims()[0]!.claimId);
    expect(h.advances()[0]!.leaseToken).toBe(h.claims()[0]!.leaseToken);
  });

  it.each(["stage_completed", "completed"] as const)(
    "repeats the exact %s event after the API committed but its response was lost",
    async (kind) => {
      const h = harness();
      let dropped = false;
      h.sleep.mockImplementation(async () => {
        // Keep the client alive during backoff after a committed-but-lost
        // completion. Stop the fake clock only after its retry is observed.
        if (
          h.state.released &&
          h.advances().filter((event) => event.kind === kind).length >= 2
        )
          h.controller.abort();
      });
      h.request.mockImplementation(async (path, body, signal) => {
        const result = await h.serve(path, body, signal);
        if ("kind" in body && body.kind === kind && !dropped) {
          dropped = true;
          throw new RunnerRequestError(0);
        }
        return result;
      });
      await runStubSessions(h.options);
      const events = h.advances().filter((event) => event.kind === kind);
      expect(events[1]).toEqual(events[0]);
      expect(h.state.job.session.stageIndex).toBe(2);
      expect(h.state.job.session.revision).toBe(5);
    },
  );

  it("reconciles cancellation with the original claim and acknowledges stopped without rebasing stage work", async () => {
    const h = harness();
    let cancelled = false;
    h.request.mockImplementation(async (path, body, signal) => {
      if ("kind" in body && body.kind === "stage_completed" && !cancelled) {
        cancelled = true;
        h.state.job.session.state = "cancelling";
        h.state.job.session.revision++;
        throw new RunnerRequestError(409);
      }
      return h.serve(path, body, signal);
    });
    await runStubSessions(h.options);
    expect(h.claims()[1]).toEqual(h.claims()[0]);
    expect(h.advances().map((event) => event.kind)).toEqual([
      "stage_completed",
      "stopped",
    ]);
    expect(h.advances()[1]!.expectedRevision).toBe(3);
    expect(h.state.job.session.state).toBe("cancelled");
    expect(h.state.job.session.stageIndex).toBe(0);
  });

  it("stops after a progress response reports permission loss instead of claiming success", async () => {
    const h = harness();
    let blocked = false;
    h.request.mockImplementation(async (path, body, signal) => {
      if ("kind" in body && body.kind === "stage_completed" && !blocked) {
        blocked = true;
        h.state.job.session.state = "blocked";
        h.state.job.session.blockReason = "permission_changed";
        h.state.job.session.revision++;
        h.state.job.lease.status = "uncertain";
        return structuredClone(h.state.job);
      }
      return h.serve(path, body, signal);
    });
    await runStubSessions(h.options);
    expect(h.advances().map((event) => event.kind)).toEqual([
      "stage_completed",
      "stopped",
    ]);
    expect(h.state.job.session.stageResults).toEqual({});
    expect(h.state.job.session.outputs).toBeNull();
    expect(h.state.job.session.state).toBe("failed");
  });

  it("acknowledges an expired assignment without evaluating another stage", async () => {
    const h = harness();
    h.state.job.lease.status = "uncertain";
    h.state.job.session.state = "blocked";
    h.state.job.session.blockReason = "lease_expired";
    await runStubSessions(h.options);
    expect(h.advances().map((event) => event.kind)).toEqual(["stopped"]);
    expect(h.state.job.session.stageIndex).toBe(0);
  });

  it("bounds connection errors, retains the claim, and suppresses repeated identical status lines", async () => {
    const h = harness();
    h.request.mockRejectedValue(new RunnerRequestError(503));
    await expect(runStubSessions(h.options)).rejects.toThrow("ten attempts");
    expect(h.request).toHaveBeenCalledTimes(10);
    expect(h.sleep).toHaveBeenCalledTimes(9);
    expect(Math.max(...h.sleep.mock.calls.map(([ms]) => ms))).toBe(15_000);
    expect(h.claims().every((candidate) => candidate === h.claims()[0])).toBe(
      true,
    );
    expect(h.onStatus).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated revision conflicts even when every claim replay succeeds", async () => {
    const h = harness();
    h.request.mockImplementation(async (path, body, signal) => {
      if (path.endsWith("/advance")) throw new RunnerRequestError(409);
      return h.serve(path, body, signal);
    });
    await expect(runStubSessions(h.options)).rejects.toThrow("ten attempts");
    expect(h.advances()).toHaveLength(10);
    expect(
      h
        .advances()
        .slice(1)
        .every((event) => event.kind === "stopped"),
    ).toBe(true);
    expect(h.claims().every((candidate) => candidate === h.claims()[0])).toBe(
      true,
    );
  });

  it("rejects a response for another runner and never executes its stages", async () => {
    const h = harness();
    h.state.job.session.runnerId = sessionId;
    await expect(runStubSessions(h.options)).rejects.toThrow("ten attempts");
    expect(h.advances()).toEqual([]);
  });

  it("rejects an assignment whose lease does not match the generated claim identity", async () => {
    const h = harness();
    h.request.mockResolvedValue({ job: initialJob() });
    await expect(runStubSessions(h.options)).rejects.toThrow("ten attempts");
    expect(h.advances()).toEqual([]);
    expect(h.claims().every((candidate) => candidate === h.claims()[0])).toBe(
      true,
    );
  });

  it("stops immediately on rejected machine authentication", async () => {
    const h = harness();
    h.request.mockRejectedValue(new RunnerRequestError(401));
    await expect(runStubSessions(h.options)).rejects.toThrow(
      "Runner authentication was rejected",
    );
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.sleep).not.toHaveBeenCalled();
  });

  it("makes no claim when already stopped", async () => {
    const h = harness();
    h.controller.abort();
    await runStubSessions(h.options);
    expect(h.request).not.toHaveBeenCalled();
  });

  it("aborts stage delay, reconciles the claim, and confirms pure-stub stop during shutdown", async () => {
    const h = harness();
    h.sleep.mockImplementation(async (_ms, signal) => {
      h.controller.abort();
      signal.throwIfAborted();
    });
    await runStubSessions(h.options);
    expect(h.claims()[1]).toEqual(h.claims()[0]);
    expect(h.advances().map((event) => event.kind)).toEqual(["stopped"]);
    expect(h.request.mock.calls.at(-1)![2].aborted).toBe(false);
    expect(h.state.job.lease.status).toBe("released");
  });

  it("reconciles a lost in-flight stage result before shutdown stop acknowledgement", async () => {
    const h = harness();
    h.request.mockImplementation(async (path, body, signal) => {
      const result = await h.serve(path, body, signal);
      if ("kind" in body && body.kind === "stage_completed") {
        h.controller.abort();
        throw new RunnerRequestError(0);
      }
      return result;
    });
    await runStubSessions(h.options);
    expect(h.advances().map((event) => event.kind)).toEqual([
      "stage_completed",
      "stopped",
    ]);
    expect(h.advances()[1]!.expectedRevision).toBe(3);
    expect(h.state.job.session.state).toBe("failed");
    expect(h.state.job.session.outputs).toBeNull();
  });

  it("repeats an identical stopped event if its shutdown acknowledgement response is lost", async () => {
    const h = harness();
    h.sleep.mockImplementation(async () => h.controller.abort());
    let dropped = false;
    h.request.mockImplementation(async (path, body, signal) => {
      const result = await h.serve(path, body, signal);
      if ("kind" in body && body.kind === "stopped" && !dropped) {
        dropped = true;
        throw new RunnerRequestError(0);
      }
      return result;
    });
    await runStubSessions(h.options);
    expect(h.advances()).toHaveLength(2);
    expect(h.advances()[1]).toEqual(h.advances()[0]);
  });

  it("does not claim another job or imply release when shutdown cannot reach the API", async () => {
    const h = harness();
    h.sleep.mockImplementation(async () => h.controller.abort());
    h.request.mockImplementation(async (path, body, signal) => {
      if (h.controller.signal.aborted) throw new RunnerRequestError(503);
      return h.serve(path, body, signal);
    });
    await runStubSessions(h.options);
    expect(h.claims()).toHaveLength(4);
    expect(h.claims().every((candidate) => candidate === h.claims()[0])).toBe(
      true,
    );
    expect(h.advances()).toEqual([]);
    expect(h.state.job.lease.status).toBe("active");
    expect(h.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("ownership is unconfirmed"),
    );
  });

  it("retains an uncertain claim conservatively when shutdown loses the initial assignment response", async () => {
    const h = harness();
    h.request.mockImplementation(async () => {
      h.controller.abort();
      throw new RunnerRequestError(0);
    });
    await runStubSessions(h.options);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect(h.onStatus).toHaveBeenLastCalledWith(
      expect.stringContaining("assignment is uncertain"),
    );
  });
});
