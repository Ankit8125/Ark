import { describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import {
  CreateRunnerEnrollmentRequestSchema,
  EnrollmentTokenSchema,
  EnrollRunnerRequestSchema,
  RevokeRunnerRequestSchema,
  RunnerCredentialSchema,
  RunnerHeartbeatRequestSchema,
  RunnerListQuerySchema,
  RunnerListResponseSchema,
  RunnerParamsSchema,
  RunnerResponseSchema,
  RunnerTeamParamsSchema,
} from "@ark/contracts";
import { IdentityService } from "../../apps/api/src/identity.js";
import { RunnerService } from "../../apps/api/src/runners.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const enrollmentToken = `ark_enroll_${id}_${"a".repeat(64)}`;
const runnerCredential = `ark_runner_${id}_${"b".repeat(64)}`;
const request = { id, name: "Local runner", enrollmentToken };
const runner = {
  id,
  organizationId: otherId,
  teamId: otherId,
  name: "Local runner",
  lifecycleRevision: 1,
  createdAt: "2026-10-15T08:00:00.000Z",
  enrollmentExpiresAt: "2026-10-15T08:10:00.000Z",
  enrolledAt: null,
  lastHeartbeatAt: null,
  revokedAt: null,
  health: "unknown",
  dispatchApproved: false,
};
const response = { runner, observedAt: runner.createdAt };

describe("local runner contracts", () => {
  it("separates credential realms and requires a complete UUID and 32-byte lowercase hex secret", () => {
    expect(EnrollmentTokenSchema.parse(enrollmentToken)).toBe(enrollmentToken);
    expect(RunnerCredentialSchema.parse(runnerCredential)).toBe(
      runnerCredential,
    );
    for (const [schema, value, otherRealm] of [
      [EnrollmentTokenSchema, enrollmentToken, runnerCredential],
      [RunnerCredentialSchema, runnerCredential, enrollmentToken],
    ] as const) {
      for (const invalid of [
        otherRealm,
        value.slice(0, -1),
        `${value}a`,
        ` ${value}`,
        `${value}\n`,
        value.toUpperCase(),
        value.replace(id, "-".repeat(36)),
        value.replace(id, "00000000-0000-0000-0000-000000000001"),
        value.replace(/.$/, "g"),
        "a".repeat(64),
      ])
        expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("pairs enrollment identity with its token and normalizes only the display label", () => {
    expect(
      CreateRunnerEnrollmentRequestSchema.parse({
        ...request,
        name: "  My laptop 🚀  ",
      }),
    ).toEqual({ ...request, name: "My laptop 🚀" });
    for (const patch of [
      { id: otherId },
      { enrollmentToken: runnerCredential },
      { name: " " },
      { name: "a".repeat(81) },
      { name: "bad\u0000name" },
      { name: "bad\ud800name" },
      { teamId: otherId },
      { dispatchApproved: true },
    ])
      expect(
        CreateRunnerEnrollmentRequestSchema.safeParse({ ...request, ...patch })
          .success,
      ).toBe(false);
  });

  it("accepts only a runner credential at exchange and no client-controlled heartbeat fields", () => {
    expect(EnrollRunnerRequestSchema.parse({ runnerCredential })).toEqual({
      runnerCredential,
    });
    for (const invalid of [
      { runnerCredential: enrollmentToken },
      { runnerCredential, teamId: otherId },
      { runnerCredential, dispatchApproved: true },
      {},
    ])
      expect(EnrollRunnerRequestSchema.safeParse(invalid).success).toBe(false);
    expect(RunnerHeartbeatRequestSchema.parse({})).toEqual({});
    for (const invalid of [
      { timestamp: runner.createdAt },
      { health: "online" },
      { dispatchApproved: true },
      null,
      [],
    ])
      expect(RunnerHeartbeatRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
  });

  it("bounds lifecycle revisions without coercion or unknown mutation controls", () => {
    for (const expectedLifecycleRevision of [1, 2_147_483_647])
      expect(
        RevokeRunnerRequestSchema.parse({ expectedLifecycleRevision }),
      ).toEqual({ expectedLifecycleRevision });
    for (const expectedLifecycleRevision of [
      0,
      -1,
      1.5,
      2_147_483_648,
      "1",
      null,
      undefined,
    ])
      expect(
        RevokeRunnerRequestSchema.safeParse({ expectedLifecycleRevision })
          .success,
      ).toBe(false);
    expect(
      RevokeRunnerRequestSchema.safeParse({
        expectedLifecycleRevision: 1,
        force: true,
      }).success,
    ).toBe(false);
  });

  it("validates strict team, runner, and cursor identifiers", () => {
    expect(RunnerTeamParamsSchema.parse({ teamId: id })).toEqual({
      teamId: id,
    });
    expect(RunnerParamsSchema.parse({ teamId: id, runnerId: otherId })).toEqual(
      {
        teamId: id,
        runnerId: otherId,
      },
    );
    expect(RunnerListQuerySchema.parse({})).toEqual({});
    expect(RunnerListQuerySchema.parse({ cursor: id })).toEqual({ cursor: id });
    for (const invalid of [
      { cursor: "" },
      { cursor: "invalid" },
      { limit: 100 },
    ])
      expect(RunnerListQuerySchema.safeParse(invalid).success).toBe(false);
    expect(
      RunnerTeamParamsSchema.safeParse({ teamId: "invalid" }).success,
    ).toBe(false);
    expect(
      RunnerParamsSchema.safeParse({
        teamId: id,
        runnerId: otherId,
        force: true,
      }).success,
    ).toBe(false);
  });

  it("keeps response metadata bounded and excludes credentials or execution approval", () => {
    expect(RunnerResponseSchema.parse(response)).toEqual(response);
    for (const patch of [
      { enrollmentToken },
      { credentialHash: "a".repeat(64) },
      { runnerCredential },
      { dispatchApproved: true },
      { health: "ready" },
      { lastHeartbeatAt: "yesterday" },
      { lifecycleRevision: 0 },
    ])
      expect(
        RunnerResponseSchema.safeParse({
          ...response,
          runner: { ...runner, ...patch },
        }).success,
      ).toBe(false);
    const page = {
      runners: Array.from({ length: 50 }, () => runner),
      nextCursor: id,
      observedAt: response.observedAt,
    };
    expect(RunnerListResponseSchema.parse(page)).toEqual(page);
    expect(
      RunnerListResponseSchema.safeParse({
        ...page,
        runners: [...page.runners, runner],
      }).success,
    ).toBe(false);
    expect(
      RunnerListResponseSchema.safeParse({ ...page, nextCursor: "bad-cursor" })
        .success,
    ).toBe(false);
  });
});

describe("machine authorization boundaries", () => {
  it("rejects malformed or wrong-realm bearer headers before accessing the database", async () => {
    const pool = new Pool();
    const connect = vi
      .spyOn(pool, "connect")
      .mockRejectedValue(new Error("Unexpected database access."));
    const service = new RunnerService(pool, new IdentityService(pool, 60));
    try {
      for (const [realm, token, otherToken] of [
        ["enroll", enrollmentToken, runnerCredential],
        ["runner", runnerCredential, enrollmentToken],
      ] as const) {
        for (const authorization of [
          undefined,
          "",
          token,
          `Basic ${token}`,
          `Bearer ${otherToken}`,
          `Bearer  ${token}`,
          `Bearer ${token} `,
          `Bearer ${token}\n`,
          `Bearer ${token}\r`,
          `Bearer ${token}\u2028`,
          `Bearer ${token}\u2029`,
          `Bearer ${token}, Bearer ${token}`,
        ]) {
          const request =
            realm === "enroll"
              ? service.enroll(authorization, { runnerCredential })
              : service.heartbeat(authorization);
          await expect(request).rejects.toMatchObject({
            statusCode: 401,
            code: "RUNNER_UNAUTHENTICATED",
          });
        }
      }
      expect(connect).not.toHaveBeenCalled();
    } finally {
      connect.mockRestore();
      await pool.end();
    }
  });
});
