import { describe, expect, it } from "vitest";
import {
  CreateWorkspaceRequestSchema,
  UpdateWorkspaceRequestSchema,
  WorkspaceDefinitionSchema,
  WorkspaceListQuerySchema,
  WorkspaceListResponseSchema,
  WorkspaceResponseSchema,
} from "@ark/contracts";

const id = "a42d9551-b621-4ef5-b8e6-78d0b1d5fe77";
const definition = {
  name: "Web application",
  description: "A shared development workspace.\nPreserve these notes. 🚀",
  repositoryUrl: "https://github.com/example/project.git",
  sourceRef: "feature/workspaces",
  defaultBranch: "main",
  sandboxImage: "ghcr.io/example/dev:24",
  workingDirectory: "apps/web",
  actions: {
    install: "pnpm install --frozen-lockfile",
    test: "pnpm test\npnpm test:integration",
    lint: "",
    build: "  pnpm build  ",
  },
};

describe("workspace contracts", () => {
  it("preserves every supported field and command while normalizing reference fields", () => {
    expect(
      CreateWorkspaceRequestSchema.parse({
        id,
        schemaVersion: 1,
        definition: {
          ...definition,
          name: ` ${definition.name} `,
          repositoryUrl: ` ${definition.repositoryUrl} `,
          sourceRef: ` ${definition.sourceRef} `,
          sandboxImage: ` ${definition.sandboxImage} `,
          workingDirectory: ` ${definition.workingDirectory} `,
        },
      }),
    ).toEqual({ id, schemaVersion: 1, definition });
    expect(
      WorkspaceDefinitionSchema.parse({ ...definition, workingDirectory: "." })
        .workingDirectory,
    ).toBe(".");
  });

  it("rejects unsafe or incomplete repository URLs", () => {
    for (const repositoryUrl of [
      "http://github.com/example/project",
      "ssh://git@github.com/example/project",
      "file:///tmp/project",
      "C:\\project",
      "https://github.com",
      "https://user@github.com/example/project",
      "https://example:placeholder@github.com/example/project",
      "https://github.com/example/project?token=private",
      "https://github.com/example/project#main",
      "https://git\nhub.com/example/project",
      "https://github.com/exam\tple/project",
      "https://github.com/example/project\u0000suffix",
    ]) {
      expect(
        WorkspaceDefinitionSchema.safeParse({ ...definition, repositoryUrl })
          .success,
        repositoryUrl,
      ).toBe(false);
    }
  });

  it("rejects absolute paths, traversal, ambiguous separators, and invalid refs", () => {
    for (const workingDirectory of [
      "../web",
      "apps/../web",
      "/apps/web",
      "C:/apps/web",
      "apps\\web",
      "apps//web",
      "apps/./web",
      "apps/",
      "apps/web\u0000",
      "apps/\nweb",
    ]) {
      expect(
        WorkspaceDefinitionSchema.safeParse({ ...definition, workingDirectory })
          .success,
        workingDirectory,
      ).toBe(false);
    }
    for (const field of ["sourceRef", "defaultBranch"]) {
      for (const value of [
        "-flag",
        "../main",
        "refs//main",
        "main/",
        "main.",
        ".hidden",
        "refs/.hidden",
        "main.lock",
        "refs/main.lock",
        "main:other",
        "main~1",
        "main^",
        "main@{1}",
        "main branch",
        "ma\nin",
        "ma\u0000in",
      ]) {
        expect(
          WorkspaceDefinitionSchema.safeParse({ ...definition, [field]: value })
            .success,
          `${field}: ${value}`,
        ).toBe(false);
      }
    }
  });

  it("rejects unknown fields, missing nested actions, unsupported schemas, and invalid revisions", () => {
    const { build: _build, ...partialActions } = definition.actions;
    for (const invalid of [
      { ...definition, role: "admin" },
      { ...definition, actions: { ...definition.actions, deploy: "publish" } },
      { ...definition, actions: partialActions },
      { ...definition, name: " " },
      { ...definition, sandboxImage: "node:24 --privileged" },
      {
        ...definition,
        actions: { ...definition.actions, test: "echo\u0000bad" },
      },
    ]) {
      expect(WorkspaceDefinitionSchema.safeParse(invalid).success).toBe(false);
    }
    for (const invalid of [
      { id: "invalid", schemaVersion: 1, definition },
      { id, schemaVersion: 2, definition },
      { id, schemaVersion: 1, definition, teamId: id },
    ]) {
      expect(CreateWorkspaceRequestSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
    for (const revision of [0, -1, 1.5, 2_147_483_647, "1"]) {
      expect(
        UpdateWorkspaceRequestSchema.safeParse({
          revision,
          schemaVersion: 1,
          definition,
        }).success,
      ).toBe(false);
    }
    expect(
      UpdateWorkspaceRequestSchema.safeParse({
        revision: 1,
        schemaVersion: 1,
        definition,
      }).success,
    ).toBe(true);
  });

  it("rejects null bytes and malformed Unicode before PostgreSQL receives text", () => {
    for (const invalidText of [
      "invalid\u0000text",
      "invalid\ud800text",
      "invalid\udffftext",
    ]) {
      for (const field of ["name", "description"]) {
        expect(
          WorkspaceDefinitionSchema.safeParse({
            ...definition,
            [field]: invalidText,
          }).success,
        ).toBe(false);
      }
      expect(
        WorkspaceDefinitionSchema.safeParse({
          ...definition,
          repositoryUrl: `https://example.test/${invalidText}`,
        }).success,
      ).toBe(false);
      for (const action of ["install", "test", "lint", "build"]) {
        expect(
          WorkspaceDefinitionSchema.safeParse({
            ...definition,
            actions: { ...definition.actions, [action]: invalidText },
          }).success,
        ).toBe(false);
      }
    }
  });

  it("enforces bounded content and list pagination contracts", () => {
    for (const invalid of [
      { name: "x".repeat(81) },
      { description: "x".repeat(2001) },
      { repositoryUrl: `https://example.test/${"x".repeat(2048)}` },
      { sourceRef: "x".repeat(201) },
      { defaultBranch: "x".repeat(201) },
      { sandboxImage: "x".repeat(201) },
      { workingDirectory: "x".repeat(201) },
      { actions: { ...definition.actions, build: "x".repeat(1001) } },
    ]) {
      expect(
        WorkspaceDefinitionSchema.safeParse({ ...definition, ...invalid })
          .success,
      ).toBe(false);
    }
    expect(WorkspaceListQuerySchema.parse({})).toEqual({});
    expect(WorkspaceListQuerySchema.parse({ cursor: id })).toEqual({
      cursor: id,
    });
    expect(WorkspaceListQuerySchema.safeParse({ cursor: "bad" }).success).toBe(
      false,
    );
    expect(WorkspaceListQuerySchema.safeParse({ limit: 10000 }).success).toBe(
      false,
    );
    const summary = {
      id,
      teamId: id,
      name: definition.name,
      revision: 1,
      versionId: id,
      schemaVersion: 1,
      updatedAt: "2026-09-27T00:00:00.000Z",
    };
    expect(
      WorkspaceListResponseSchema.safeParse({
        workspaces: Array(51).fill(summary),
        nextCursor: id,
      }).success,
    ).toBe(false);
  });

  it("retains unfamiliar stored definitions for read-only forward compatibility", () => {
    const futureDefinition = {
      ...definition,
      futureSetting: { enabled: true },
    };
    const response = {
      workspace: {
        id,
        teamId: id,
        versionId: id,
        name: definition.name,
        revision: 2,
        schemaVersion: 2,
        definition: futureDefinition,
        updatedAt: "2026-09-27T00:00:00.000Z",
        createdAt: "2026-09-26T00:00:00.000Z",
      },
    };
    expect(WorkspaceResponseSchema.parse(response)).toEqual(response);
    expect(WorkspaceDefinitionSchema.safeParse(futureDefinition).success).toBe(
      false,
    );
  });
});
