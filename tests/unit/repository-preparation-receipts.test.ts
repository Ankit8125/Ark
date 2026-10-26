import { describe, expect, it } from "vitest";
import {
  RepositoryPreparationBindingSchema,
  RepositoryPreparationCommandImageSchema,
  RepositoryPreparationDirectorySchema,
  RepositoryPreparationEvidenceSchema,
  RepositoryPreparationReceiptPayloadSchema,
  RepositoryPreparationReceiptReadResponseSchema,
  RepositoryPreparationReceiptRequestSchema,
  RepositoryPreparationReceiptResponseSchema,
  SavedRepositoryPreparationReceiptSchema,
  compileRepositoryCommandPlan,
  repositoryOwnershipManifest,
  serializeRepositoryPreparationReceiptPayload,
  validateRepositoryPreparationEvidence,
  type RepositoryPreparationBinding,
  type RepositoryPreparationEvidence,
  type RepositoryPreparationReceiptPayload,
  type RepositoryPreparationReceiptRequest,
  type SavedRepositoryPreparationReceipt,
} from "@ark/contracts";

const receiptId = "ab286801-a441-4c81-b111-589de8611ff2";
const executionId = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const leaseId = "3c286801-a441-4c81-b111-589de8611ff2";
const otherId = "7c286801-a441-4c81-b111-589de8611ff2";
const binding: RepositoryPreparationBinding = {
  executionId,
  leaseId,
  generation: 1,
  planDigest: "a".repeat(64),
};
const workspace = { resourceId: receiptId, versionId: otherId };
const plan = compileRepositoryCommandPlan(
  {
    ...workspace,
    definition: {
      name: "Preparation receipts",
      description: "Protocol fixtures, never executed.",
      repositoryUrl: "https://github.com/example/project.git",
      sourceRef: "main",
      defaultBranch: "main",
      sandboxImage: "node:24",
      workingDirectory: "packages/current",
      actions: {
        install: "",
        test: "never execute this action",
        lint: "",
        build: "",
      },
    },
  },
  {
    action: "test",
    commitOid: "abcdef0123456789abcdef0123456789abcdef01",
    imageDigest: `node@sha256:${"b".repeat(64)}`,
  },
);
const manifest = repositoryOwnershipManifest(
  executionId,
  leaseId,
  binding.planDigest,
);

function prepared(): Extract<
  RepositoryPreparationEvidence,
  { outcome: "prepared" }
> {
  return {
    version: 1,
    outcome: "prepared",
    elapsedMs: 120_000,
    sourceCommitOid: plan.source.commitOid,
    commandImage: {
      repositoryDigest: plan.image.pinned,
      imageId: `sha256:${"c".repeat(64)}`,
      os: "linux",
    },
    // A symlink may resolve to a different contained target than the saved path.
    resolvedWorkingDirectory: "/workspace/repository/packages/actual",
    resources: {
      preparationContainer: {
        name: manifest.resources.preparationContainer,
        id: "d".repeat(64),
        status: "exited",
        exitCode: 0,
        ownership: { ...binding },
      },
      workspaceVolume: {
        name: manifest.resources.workspaceVolume,
        status: "present",
        ownership: { ...binding },
      },
      commandContainer: {
        name: manifest.resources.commandContainer,
        status: "absent",
      },
    },
  };
}
function failed(): Extract<
  RepositoryPreparationEvidence,
  { outcome: "failed" }
> {
  return {
    version: 1,
    outcome: "failed",
    elapsedMs: 0,
    reason: "unknown",
    sourceCommitOid: null,
    commandImage: null,
    resolvedWorkingDirectory: null,
  };
}
function request(
  evidence: RepositoryPreparationEvidence = prepared(),
): RepositoryPreparationReceiptRequest {
  return {
    id: receiptId,
    ...binding,
    leaseToken: "e".repeat(64),
    evidence,
  };
}
function payload(
  evidence: RepositoryPreparationEvidence = prepared(),
): RepositoryPreparationReceiptPayload {
  const { leaseToken: _, ...value } = request(evidence);
  return value;
}
function saved(): SavedRepositoryPreparationReceipt {
  return {
    ...payload(),
    workspace,
    organizationId: otherId,
    teamId: otherId,
    reportedByRunnerId: otherId,
    evidenceStatus: "runner_reported_unverified",
    receivedAt: "2026-10-26T00:00:00.000Z",
    reportDigest: "f".repeat(64),
    manifest,
  };
}
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .reverse()
      .map(([key, item]) => [key, reverseKeys(item)]),
  );
}

describe("repository preparation receipts", () => {
  it("validates copied preparation claims against the exact lease and saved plan", () => {
    const original = prepared();
    const result = validateRepositoryPreparationEvidence(
      binding,
      plan,
      original,
    );
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
    expect(result.resolvedWorkingDirectory).not.toBe(plan.containerDirectory);
    expect(
      RepositoryPreparationReceiptRequestSchema.parse(request()).evidence,
    ).toEqual(original);
    expect(RepositoryPreparationReceiptPayloadSchema.parse(payload())).toEqual(
      payload(),
    );
  });

  it("accepts root or canonical contained paths and rejects traversal and host paths", () => {
    for (const value of [
      "/workspace/repository",
      "/workspace/repository/packages/web",
      "/workspace/repository/café",
    ])
      expect(RepositoryPreparationDirectorySchema.parse(value)).toBe(value);
    for (const value of [
      "/workspace/repository-other",
      "/workspace/repository2/web",
      "/workspace/repository/../other",
      "/workspace/repository/./web",
      "/workspace/repository//web",
      "/workspace/repository/",
      "/workspace/repository/web/",
      "/workspace/repository\\web",
      "/workspace/repository/web\n",
      "/workspace/repository/web\u0085",
      "/workspace/repository/\u0000",
      "/workspace/repository/\ud800",
      "C:\\private\\project",
      "../project",
      "/home/operator/project",
      `/workspace/repository/${"a".repeat(210)}`,
    ])
      expect(
        RepositoryPreparationDirectorySchema.safeParse(value).success,
        value,
      ).toBe(false);
  });

  it("requires precise command-image identity without equating it to the preparation image", () => {
    const image = prepared().commandImage;
    expect(RepositoryPreparationCommandImageSchema.parse(image)).toEqual(image);
    for (const invalid of [
      { ...image, imageId: image.repositoryDigest },
      { ...image, imageId: `${image.imageId}\n` },
      { ...image, imageId: `sha256:${"C".repeat(64)}` },
      { ...image, os: "windows" },
      { ...image, repositoryDigest: "node:24" },
      { ...image, preparationImageDigest: image.repositoryDigest },
    ])
      expect(
        RepositoryPreparationCommandImageSchema.safeParse(invalid).success,
      ).toBe(false);
  });

  it("requires matching admitted commit and command-image pin for prepared outcomes", () => {
    const commitMismatch = { ...prepared(), sourceCommitOid: "0".repeat(40) };
    const imageMismatch = {
      ...prepared(),
      commandImage: {
        ...prepared().commandImage,
        repositoryDigest: `other@sha256:${"b".repeat(64)}`,
      },
    };
    expect(() =>
      validateRepositoryPreparationEvidence(binding, plan, commitMismatch),
    ).toThrow();
    expect(() =>
      validateRepositoryPreparationEvidence(binding, plan, imageMismatch),
    ).toThrow();
  });

  it("retains bounded failure diagnostics without asserting preparation or ownership", () => {
    const mismatch = {
      ...failed(),
      elapsedMs: 900_001,
      reason: "source_mismatch" as const,
      sourceCommitOid: "0".repeat(40),
      commandImage: {
        ...prepared().commandImage,
        repositoryDigest: `other@sha256:${"0".repeat(64)}`,
      },
    };
    expect(
      validateRepositoryPreparationEvidence(binding, plan, mismatch),
    ).toEqual(mismatch);
    expect(
      RepositoryPreparationReceiptRequestSchema.parse(request(mismatch))
        .evidence,
    ).toEqual(mismatch);
    expect(
      RepositoryPreparationEvidenceSchema.safeParse({
        ...mismatch,
        resources: prepared().resources,
      }).success,
    ).toBe(false);
    expect(
      RepositoryPreparationEvidenceSchema.safeParse({
        ...failed(),
        reason: "raw daemon diagnostic",
      }).success,
    ).toBe(false);
  });

  it("bounds reported durations without interpreting them as server deadlines", () => {
    expect(
      RepositoryPreparationEvidenceSchema.parse({
        ...failed(),
        elapsedMs: Number.MAX_SAFE_INTEGER,
      }).elapsedMs,
    ).toBe(Number.MAX_SAFE_INTEGER);
    for (const elapsedMs of [
      -1,
      0.5,
      Number.MAX_SAFE_INTEGER + 1,
      Infinity,
      NaN,
    ])
      expect(
        RepositoryPreparationEvidenceSchema.safeParse({
          ...failed(),
          elapsedMs,
        }).success,
      ).toBe(false);
    expect(
      RepositoryPreparationEvidenceSchema.safeParse({
        ...prepared(),
        elapsedMs: 120_001,
      }).success,
    ).toBe(false);
    expect(
      RepositoryPreparationEvidenceSchema.parse({ ...prepared(), elapsedMs: 0 })
        .elapsedMs,
    ).toBe(0);
  });

  it("requires successful exited preparation, present volume, and absent command claims", () => {
    for (const [role, changes] of [
      ["preparationContainer", { status: "running" }],
      ["preparationContainer", { exitCode: 1 }],
      ["preparationContainer", { id: "short-id" }],
      ["preparationContainer", { id: "D".repeat(64) }],
      ["workspaceVolume", { status: "absent" }],
      ["commandContainer", { status: "present" }],
      ["commandContainer", { id: "d".repeat(64) }],
    ] as const) {
      const evidence = prepared();
      const invalid = {
        ...evidence,
        resources: {
          ...evidence.resources,
          [role]: { ...evidence.resources[role], ...changes },
        },
      };
      expect(
        RepositoryPreparationEvidenceSchema.safeParse(invalid).success,
      ).toBe(false);
    }
  });

  it("rejects other resource names and mismatched structured ownership", () => {
    for (const role of [
      "preparationContainer",
      "workspaceVolume",
      "commandContainer",
    ] as const) {
      const evidence = prepared();
      evidence.resources[role].name = `${evidence.resources[role].name}-other`;
      expect(
        RepositoryPreparationReceiptRequestSchema.safeParse(request(evidence))
          .success,
      ).toBe(false);
      expect(() =>
        validateRepositoryPreparationEvidence(binding, plan, evidence),
      ).toThrow();
    }
    for (const role of ["preparationContainer", "workspaceVolume"] as const) {
      for (const change of [
        { executionId: otherId },
        { leaseId: otherId },
        { planDigest: "0".repeat(64) },
      ]) {
        const evidence = prepared();
        Object.assign(evidence.resources[role].ownership, change);
        expect(
          RepositoryPreparationReceiptPayloadSchema.safeParse(payload(evidence))
            .success,
        ).toBe(false);
      }
    }
    expect(
      RepositoryPreparationBindingSchema.safeParse({
        ...binding,
        generation: 2,
      }).success,
    ).toBe(false);
  });

  it("rejects authority, credentials, diagnostics, and unknown nested fields", () => {
    for (const extra of [
      { command: "replacement" },
      { confirmedStopped: true },
      { trusted: true },
      { authorizedForMs: 45_000 },
      { adapterVersion: "approved" },
      { stdout: "private output" },
      { environment: {} },
      { quality: "passed" },
      { workDeadlineAt: "2026-10-26T00:02:00.000Z" },
    ])
      expect(
        RepositoryPreparationReceiptRequestSchema.safeParse({
          ...request(),
          ...extra,
        }).success,
      ).toBe(false);
    expect(
      RepositoryPreparationReceiptRequestSchema.safeParse({
        ...request(),
        evidence: { ...prepared(), logs: "private logs" },
      }).success,
    ).toBe(false);
    const evidence = prepared();
    const { preparationContainer, ...resources } = evidence.resources;
    expect(
      RepositoryPreparationEvidenceSchema.safeParse({
        ...evidence,
        resources: {
          ...resources,
          preparationContainer: {
            ...preparationContainer,
            ownership: { ...binding, token: "private" },
          },
        },
      }).success,
    ).toBe(false);
  });

  it("normalizes UUIDs and commit OIDs consistently before canonical storage", () => {
    const value = request();
    const evidence = prepared();
    evidence.sourceCommitOid = evidence.sourceCommitOid.toUpperCase();
    const normalized = RepositoryPreparationReceiptRequestSchema.parse({
      ...value,
      id: value.id.toUpperCase(),
      executionId: value.executionId.toUpperCase(),
      leaseId: value.leaseId.toUpperCase(),
      evidence,
    });
    expect(normalized).toEqual(value);
    expect(
      validateRepositoryPreparationEvidence(binding, plan, evidence),
    ).toEqual(prepared());
  });

  it("serializes one frozen token-free failure payload", () => {
    const expected =
      '{"id":"ab286801-a441-4c81-b111-589de8611ff2","executionId":"a42d9551-b621-4ef5-b8e6-78d0b1d5fe77","leaseId":"3c286801-a441-4c81-b111-589de8611ff2","generation":1,"planDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","evidence":{"version":1,"outcome":"failed","elapsedMs":0,"reason":"unknown","sourceCommitOid":null,"commandImage":null,"resolvedWorkingDirectory":null}}';
    expect(
      serializeRepositoryPreparationReceiptPayload(payload(failed())),
    ).toBe(expected);
    expect(
      serializeRepositoryPreparationReceiptPayload(
        reverseKeys(payload(failed())),
      ),
    ).toBe(expected);
    expect(() =>
      serializeRepositoryPreparationReceiptPayload(request(failed())),
    ).toThrow();
    expect(
      RepositoryPreparationReceiptPayloadSchema.safeParse({
        ...payload(),
        leaseToken: "e".repeat(64),
      }).success,
    ).toBe(false);
  });

  it("reconstructs canonical prepared payloads after all nested JSONB key reordering", () => {
    const value = payload();
    const encoded = serializeRepositoryPreparationReceiptPayload(value);
    expect(
      serializeRepositoryPreparationReceiptPayload(reverseKeys(value)),
    ).toBe(encoded);
    expect(JSON.parse(encoded)).toEqual(value);
    expect(
      Object.keys(JSON.parse(encoded).evidence.resources.preparationContainer),
    ).toEqual(["name", "id", "status", "exitCode", "ownership"]);
    expect(encoded.endsWith("\n")).toBe(false);
    expect(encoded.includes("leaseToken")).toBe(false);
  });

  it("preserves server provenance and rejects stronger trust or cached authority", () => {
    const value = saved();
    expect(
      RepositoryPreparationReceiptResponseSchema.parse({
        preparationReceipt: value,
      }).preparationReceipt,
    ).toEqual(value);
    expect(
      RepositoryPreparationReceiptReadResponseSchema.parse({
        preparationReceipt: null,
      }),
    ).toEqual({ preparationReceipt: null });
    expect(
      RepositoryPreparationReceiptResponseSchema.safeParse({
        preparationReceipt: null,
      }).success,
    ).toBe(false);
    expect(
      SavedRepositoryPreparationReceiptSchema.safeParse({
        ...value,
        evidenceStatus: "verified",
      }).success,
    ).toBe(false);
    expect(
      SavedRepositoryPreparationReceiptSchema.safeParse({
        ...value,
        receivedAt: "yesterday",
      }).success,
    ).toBe(false);
    expect(
      SavedRepositoryPreparationReceiptSchema.safeParse({
        ...value,
        leaseToken: "e".repeat(64),
      }).success,
    ).toBe(false);
    expect(
      RepositoryPreparationReceiptResponseSchema.safeParse({
        preparationReceipt: value,
        control: { decision: "prepare" },
      }).success,
    ).toBe(false);
  });

  it("binds saved manifests and prepared resource claims to the saved receipt context", () => {
    const value = saved();
    for (const changes of [
      { executionId: otherId },
      { leaseId: otherId },
      { planDigest: "0".repeat(64) },
    ])
      expect(
        SavedRepositoryPreparationReceiptSchema.safeParse({
          ...value,
          ...changes,
        }).success,
      ).toBe(false);
    expect(
      SavedRepositoryPreparationReceiptSchema.safeParse({
        ...value,
        manifest: { ...value.manifest, executionId: otherId },
      }).success,
    ).toBe(false);
    const evidence = prepared();
    evidence.resources.workspaceVolume.ownership.executionId = otherId;
    expect(
      SavedRepositoryPreparationReceiptSchema.safeParse({ ...value, evidence })
        .success,
    ).toBe(false);
  });
});
