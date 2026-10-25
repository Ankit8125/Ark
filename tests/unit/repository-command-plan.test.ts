import { describe, expect, it } from "vitest";
import {
  REPOSITORY_COMMAND_LIMITS,
  REPOSITORY_COMMAND_POLICY,
  REPOSITORY_COMMAND_RUNTIME,
  REPOSITORY_CONTAINER_ROOT,
  RepositoryCommandPlanSchema,
  RepositoryCommandSelectionSchema,
  RepositoryCommitOidSchema,
  RepositoryImageDigestSchema,
  compileRepositoryCommandPlan,
  type RepositoryAction,
} from "@ark/contracts";

const resourceId = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const versionId = "ab286801-a441-4c81-b111-589de8611ff2";
const commitOid = "abcdef0123456789abcdef0123456789abcdef01";
const digest = "a".repeat(64);
const pinned = `ghcr.io/example/dev@sha256:${digest}`;

function workspace() {
  return {
    resourceId,
    versionId,
    definition: {
      name: "Web application",
      description: "Saved configuration only.",
      repositoryUrl: "https://github.com/example/project.git",
      sourceRef: "feature/command-plan",
      defaultBranch: "main",
      sandboxImage: "ghcr.io/example/dev:24",
      workingDirectory: "apps/web",
      actions: {
        install: "pnpm install --frozen-lockfile",
        test: '  pnpm test -- --reporter=junit\nprintf "%s" "$HOME"\n',
        lint: "pnpm lint",
        build: "pnpm build",
      },
    },
  };
}
function selection(action: RepositoryAction = "test") {
  return { action, commitOid, imageDigest: pinned };
}
function plan() {
  return compileRepositoryCommandPlan(workspace(), selection());
}

describe("repository command planning contracts", () => {
  it("selects one saved action and preserves its command verbatim without inserting other commands", () => {
    const saved = workspace();
    const result = compileRepositoryCommandPlan(saved, selection());
    expect(result.action).toEqual({
      kind: "test",
      command: saved.definition.actions.test,
    });
    expect(result.action.command).toBe(
      '  pnpm test -- --reporter=junit\nprintf "%s" "$HOME"\n',
    );
    const serialized = JSON.stringify(result);
    for (const other of ["install", "lint", "build"] as const)
      expect(serialized).not.toContain(saved.definition.actions[other]);
  });

  it("supports each explicitly selected action without an implicit install or command sequence", () => {
    const saved = workspace();
    for (const action of ["install", "test", "lint", "build"] as const) {
      const result = compileRepositoryCommandPlan(saved, selection(action));
      expect(result.action).toEqual({
        kind: action,
        command: saved.definition.actions[action],
      });
      expect(Object.keys(result.action)).toEqual(["kind", "command"]);
    }
  });

  it("requires an explicit supported action and a nonblank valid selected command", () => {
    expect(
      RepositoryCommandSelectionSchema.safeParse({
        commitOid,
        imageDigest: pinned,
      }).success,
    ).toBe(false);
    expect(
      RepositoryCommandSelectionSchema.safeParse({
        ...selection(),
        action: "deploy",
      }).success,
    ).toBe(false);
    for (const command of [
      "",
      " \n\t ",
      "bad\u0000command",
      "x".repeat(1001),
    ]) {
      const saved = workspace();
      saved.definition.actions.test = command;
      expect(() => compileRepositoryCommandPlan(saved, selection())).toThrow();
    }
    const saved = workspace();
    saved.definition.actions.install = "";
    expect(() =>
      compileRepositoryCommandPlan(saved, selection()),
    ).not.toThrow();
    expect(() =>
      compileRepositoryCommandPlan(saved, selection("install")),
    ).toThrow();
  });

  it("requires a full SHA-1 OID and normalizes uppercase hex without accepting refs or abbreviations", () => {
    expect(RepositoryCommitOidSchema.parse(commitOid.toUpperCase())).toBe(
      commitOid,
    );
    expect(
      compileRepositoryCommandPlan(workspace(), {
        ...selection(),
        commitOid: commitOid.toUpperCase(),
      }).source.commitOid,
    ).toBe(commitOid);
    for (const value of [
      "main",
      "HEAD",
      commitOid.slice(0, 12),
      "a".repeat(39),
      "a".repeat(41),
      "a".repeat(64),
      "g".repeat(40),
      ` ${commitOid}`,
      `${commitOid}\n`,
    ])
      expect(RepositoryCommitOidSchema.safeParse(value).success, value).toBe(
        false,
      );
  });

  it("derives the container directory for the repository root or a relative working directory", () => {
    expect(plan().containerDirectory).toBe(
      `${REPOSITORY_CONTAINER_ROOT}/apps/web`,
    );
    const saved = workspace();
    saved.definition.workingDirectory = ".";
    const root = compileRepositoryCommandPlan(saved, selection());
    expect(root.containerDirectory).toBe(REPOSITORY_CONTAINER_ROOT);
    for (const directory of ["/etc", `${REPOSITORY_CONTAINER_ROOT}/other`])
      expect(
        RepositoryCommandPlanSchema.safeParse({
          ...root,
          containerDirectory: directory,
        }).success,
      ).toBe(false);
  });

  it("produces deterministic copies that cannot alias stale inputs or the shared fixed limits", () => {
    const saved = workspace();
    const selected = selection();
    const first = compileRepositoryCommandPlan(saved, selected);
    const second = compileRepositoryCommandPlan(saved, selected);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(first.source).not.toBe(second.source);
    expect(first.sandbox).not.toBe(second.sandbox);
    expect(first.limits).not.toBe(REPOSITORY_COMMAND_LIMITS);

    saved.definition.actions.test = "changed command";
    saved.definition.repositoryUrl = "https://example.com/changed";
    saved.definition.workingDirectory = "other";
    saved.versionId = resourceId;
    selected.commitOid = "b".repeat(40);
    selected.imageDigest = `ghcr.io/example/dev@sha256:${"b".repeat(64)}`;
    expect(first).toEqual(second);
    first.action.command = "output-only change";
    expect(saved.definition.actions.test).toBe("changed command");
    expect(second.action.command).toBe(workspace().definition.actions.test);
    expect(compileRepositoryCommandPlan(workspace(), selection())).toEqual(
      second,
    );
  });

  it("normalizes snapshot labels and identities while leaving the command text untouched", () => {
    const saved = workspace();
    saved.resourceId = resourceId.toUpperCase();
    saved.versionId = versionId.toUpperCase();
    saved.definition.repositoryUrl = ` ${saved.definition.repositoryUrl} `;
    saved.definition.sourceRef = " feature/command-plan ";
    saved.definition.sandboxImage = " ghcr.io/example/dev:24 ";
    saved.definition.workingDirectory = " apps/web ";
    const result = compileRepositoryCommandPlan(saved, selection());
    expect(result.workspace).toEqual({ resourceId, versionId });
    expect(result.source.repositoryUrl).toBe(
      workspace().definition.repositoryUrl,
    );
    expect(result.source.requestedRef).toBe("feature/command-plan");
    expect(result.image.requested).toBe("ghcr.io/example/dev:24");
    expect(result.workingDirectory).toBe("apps/web");
    expect(result.action.command).toBe(saved.definition.actions.test);
  });

  it("pins a tagged or untagged image only to that same explicit repository, including registry ports", () => {
    for (const [requested, repository] of [
      ["node:24", "node"],
      ["ghcr.io/example/dev", "ghcr.io/example/dev"],
      ["ghcr.io/example/dev:24-bookworm", "ghcr.io/example/dev"],
      ["registry.example:5000/team/dev:24", "registry.example:5000/team/dev"],
    ]) {
      const saved = workspace();
      saved.definition.sandboxImage = requested!;
      const imageDigest = `${repository}@sha256:${digest}`;
      const result = compileRepositoryCommandPlan(saved, {
        ...selection(),
        imageDigest,
      });
      expect(result.image).toEqual({ requested, pinned: imageDigest });
    }
  });

  it("requires the same repository and digest for saved image pins, including tagged digest references", () => {
    for (const requested of [
      pinned,
      `ghcr.io/example/dev:24@sha256:${digest}`,
    ]) {
      const saved = workspace();
      saved.definition.sandboxImage = requested;
      expect(
        compileRepositoryCommandPlan(saved, selection()).image.pinned,
      ).toBe(pinned);
      for (const imageDigest of [
        `ghcr.io/example/dev@sha256:${"b".repeat(64)}`,
        `ghcr.io/example/other@sha256:${digest}`,
      ])
        expect(() =>
          compileRepositoryCommandPlan(saved, { ...selection(), imageDigest }),
        ).toThrow();
    }
    const changed = plan();
    changed.image.requested = pinned;
    changed.image.pinned = `ghcr.io/example/dev@sha256:${"b".repeat(64)}`;
    expect(RepositoryCommandPlanSchema.safeParse(changed).success).toBe(false);
  });

  it("rejects a digest from another repository instead of inferring aliases or moving image names", () => {
    for (const repository of [
      "ghcr.io/example/other",
      "ghcr.io/other/dev",
      "docker.io/example/dev",
      "example/dev",
    ])
      expect(() =>
        compileRepositoryCommandPlan(workspace(), {
          ...selection(),
          imageDigest: `${repository}@sha256:${digest}`,
        }),
      ).toThrow();
  });

  it("rejects mutable or malformed image pins, unsafe protocols, whitespace, and invalid ports", () => {
    for (const imageDigest of [
      "ghcr.io/example/dev:24",
      `ghcr.io/example/dev:24@sha256:${digest}`,
      `https://ghcr.io/example/dev@sha256:${digest}`,
      `GHCR.IO/example/dev@sha256:${digest}`,
      `ghcr.io/example/dev@sha256:${"A".repeat(64)}`,
      `ghcr.io/example/dev@sha256:${"a".repeat(63)}`,
      `ghcr.io/example/dev@sha256:${"g".repeat(64)}`,
      `ghcr.io/example/dev@sha512:${digest}`,
      `registry.example:0/dev@sha256:${digest}`,
      `registry.example:65536/dev@sha256:${digest}`,
      ` ${pinned}`,
      `${pinned}\n`,
      `${pinned} `,
    ])
      expect(
        RepositoryImageDigestSchema.safeParse(imageDigest).success,
        imageDigest,
      ).toBe(false);
  });

  it("rejects unsafe source URL and ref syntax while treating a branch as unresolved declared intent", () => {
    for (const repositoryUrl of [
      "file:///tmp/repository",
      "ssh://git@example.com/repository",
      "http://example.com/repository",
      "https://example.com",
      "https://user:placeholder@example.com/repository",
      "https://example.com/repository?secret=placeholder",
      "https://example.com/repository#branch",
      "https://exam\nple.com/repository",
    ]) {
      const saved = workspace();
      saved.definition.repositoryUrl = repositoryUrl;
      expect(() => compileRepositoryCommandPlan(saved, selection())).toThrow();
    }
    for (const sourceRef of [
      "--upload-pack=other",
      "HEAD~1",
      "main:other",
      "refs/../heads/main",
      "refs//heads/main",
      "main\nother",
    ]) {
      const saved = workspace();
      saved.definition.sourceRef = sourceRef;
      expect(() => compileRepositoryCommandPlan(saved, selection())).toThrow();
    }
    expect(plan().source.requestedRef).toBe("feature/command-plan");
    expect(plan().source.commitOid).toBe(commitOid);
    expect(plan().status).toBe("planned_unverified");
  });

  it("rejects absolute, drive, traversal, and ambiguous working-directory syntax", () => {
    for (const workingDirectory of [
      "/tmp/repository",
      "C:/repository",
      "C:\\repository",
      "\\\\server\\share",
      "../repository",
      "apps/../other",
      "apps/./web",
      "apps//web",
      "apps/web/",
      "",
    ]) {
      const saved = workspace();
      saved.definition.workingDirectory = workingDirectory;
      expect(() => compileRepositoryCommandPlan(saved, selection())).toThrow();
    }
  });

  it("rejects sandbox-policy and resource-limit tampering rather than treating them as caller choices", () => {
    const original = plan();
    expect(original.limits).toEqual(REPOSITORY_COMMAND_LIMITS);
    expect(original.sandbox.policy).toBe(REPOSITORY_COMMAND_POLICY);
    for (const change of [
      { policy: "unrestricted" },
      { shell: "powershell.exe" },
      { network: "host" },
      { readOnlyRoot: false },
      { dropAllCapabilities: false },
      { noNewPrivileges: false },
      { user: "0:0" },
    ])
      expect(
        RepositoryCommandPlanSchema.safeParse({
          ...original,
          sandbox: { ...original.sandbox, ...change },
        }).success,
      ).toBe(false);
    for (const [name, value] of Object.entries(REPOSITORY_COMMAND_LIMITS))
      expect(
        RepositoryCommandPlanSchema.safeParse({
          ...original,
          limits: { ...original.limits, [name]: value + 1 },
        }).success,
        name,
      ).toBe(false);
    expect(Object.isFrozen(REPOSITORY_COMMAND_LIMITS)).toBe(true);
  });

  it("rejects unknown fields in compiler inputs and every nested plan object", () => {
    const saved = workspace();
    const extraSnapshot = { ...saved, approved: true };
    const extraDefinition = {
      ...saved,
      definition: { ...saved.definition, runtime: "shell" },
    };
    expect(() =>
      compileRepositoryCommandPlan(extraSnapshot, selection()),
    ).toThrow();
    expect(() =>
      compileRepositoryCommandPlan(extraDefinition, selection()),
    ).toThrow();
    expect(
      RepositoryCommandSelectionSchema.safeParse({
        ...selection(),
        command: "replacement command",
      }).success,
    ).toBe(false);
    const original = plan();
    expect(
      RepositoryCommandPlanSchema.safeParse({ ...original, approved: true })
        .success,
    ).toBe(false);
    for (const name of [
      "workspace",
      "source",
      "image",
      "action",
      "sandbox",
      "limits",
    ] as const)
      expect(
        RepositoryCommandPlanSchema.safeParse({
          ...original,
          [name]: { ...original[name], unexpected: true },
        }).success,
        name,
      ).toBe(false);
  });

  it("remains planned and unverified without claiming lease authority, process success, or quality", () => {
    const result = plan();
    expect(result.version).toBe(1);
    expect(result.runtime).toBe(REPOSITORY_COMMAND_RUNTIME);
    expect(result.status).toBe("planned_unverified");
    for (const field of [
      "quality",
      "exitCode",
      "passedTests",
      "confirmedStopped",
      "leaseToken",
      "authorized",
    ])
      expect(Object.hasOwn(result, field)).toBe(false);
    for (const change of [
      { version: 2 },
      { runtime: "stub.v1" },
      { status: "completed" },
      { quality: "passed" },
      { authorized: true },
    ])
      expect(
        RepositoryCommandPlanSchema.safeParse({ ...result, ...change }).success,
      ).toBe(false);
  });

  it("requires an already exact saved source OID to match the normalized selected OID", () => {
    const saved = workspace();
    saved.definition.sourceRef = commitOid.toUpperCase();
    expect(
      compileRepositoryCommandPlan(saved, selection()).source.commitOid,
    ).toBe(commitOid);
    expect(() =>
      compileRepositoryCommandPlan(saved, {
        ...selection(),
        commitOid: "b".repeat(40),
      }),
    ).toThrow();
    const changed = plan();
    changed.source.requestedRef = "b".repeat(40);
    expect(RepositoryCommandPlanSchema.safeParse(changed).success).toBe(false);
  });

  it("rejects malformed saved image tags even when their repository matches the selected digest", () => {
    for (const tag of ["", ".invalid", "-invalid", "a".repeat(129)]) {
      const saved = workspace();
      saved.definition.sandboxImage = `node:${tag}`;
      expect(() =>
        compileRepositoryCommandPlan(saved, {
          ...selection(),
          imageDigest: `node@sha256:${digest}`,
        }),
      ).toThrow();
    }
    const saved = workspace();
    saved.definition.sandboxImage = `node:${"a".repeat(128)}`;
    expect(() =>
      compileRepositoryCommandPlan(saved, {
        ...selection(),
        imageDigest: `node@sha256:${digest}`,
      }),
    ).not.toThrow();
  });
});
