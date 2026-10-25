import { z } from "zod";
import { ResourceVersionReferenceSchema } from "./catalog-versions.js";
import { WorkspaceDefinitionSchema } from "./workspaces.js";

export const REPOSITORY_COMMAND_RUNTIME = "repository.v1" as const;
export const REPOSITORY_COMMAND_POLICY = "docker-linux-offline.v1" as const;
export const REPOSITORY_CONTAINER_ROOT = "/workspace/repository" as const;
export const REPOSITORY_COMMAND_LIMITS = Object.freeze({
  preparationSeconds: 120,
  commandSeconds: 300,
  cleanupSeconds: 30,
  runSeconds: 900,
  outputBytesPerChannel: 65_536,
  cpuCount: 2,
  memoryMiB: 1024,
  workspaceMiB: 1024,
  pids: 128,
  temporaryMiB: 64,
});

export const RepositoryActionSchema = z.enum([
  "install",
  "test",
  "lint",
  "build",
]);
// Only SHA-1 repositories are supported by the first execution contract.
// A syntactically valid OID is declared intent, not an observed commit.
export const RepositoryCommitOidSchema = z
  .string()
  .length(40)
  .regex(/^[a-fA-F0-9]{40}$/)
  .toLowerCase();

const imagePart = "[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*";
const digestImage = new RegExp(
  `^${imagePart}(?::[1-9][0-9]{0,4})?(?:/${imagePart})*@sha256:[a-f0-9]{64}$`,
);
export const RepositoryImageDigestSchema = z
  .string()
  .max(272)
  .refine((value) => {
    const match = digestImage.exec(value);
    if (!match || match[0] !== value) return false;
    const repository = value.split("@")[0]!;
    const first = repository.split("/")[0]!;
    if (!first.includes(":")) return true;
    return repository.includes("/") && Number(first.split(":")[1]) <= 65_535;
  }, "Use a lowercase repository@sha256 digest without a tag or whitespace.");

export const RepositoryCommandSelectionSchema = z.strictObject({
  action: RepositoryActionSchema,
  commitOid: RepositoryCommitOidSchema,
  imageDigest: RepositoryImageDigestSchema,
});

const workspaceSnapshot = ResourceVersionReferenceSchema.extend({
  definition: WorkspaceDefinitionSchema,
});
const limits = z.strictObject({
  preparationSeconds: z.literal(REPOSITORY_COMMAND_LIMITS.preparationSeconds),
  commandSeconds: z.literal(REPOSITORY_COMMAND_LIMITS.commandSeconds),
  cleanupSeconds: z.literal(REPOSITORY_COMMAND_LIMITS.cleanupSeconds),
  runSeconds: z.literal(REPOSITORY_COMMAND_LIMITS.runSeconds),
  outputBytesPerChannel: z.literal(
    REPOSITORY_COMMAND_LIMITS.outputBytesPerChannel,
  ),
  cpuCount: z.literal(REPOSITORY_COMMAND_LIMITS.cpuCount),
  memoryMiB: z.literal(REPOSITORY_COMMAND_LIMITS.memoryMiB),
  workspaceMiB: z.literal(REPOSITORY_COMMAND_LIMITS.workspaceMiB),
  pids: z.literal(REPOSITORY_COMMAND_LIMITS.pids),
  temporaryMiB: z.literal(REPOSITORY_COMMAND_LIMITS.temporaryMiB),
});

function matchingImage(requested: string, pinned: string): boolean {
  const parts = requested.split("@");
  if (parts.length > 2) return false;
  const reference = parts[0]!;
  const pinnedParts = pinned.split("@");
  if (parts.length === 2 && parts[1] !== pinnedParts[1]) return false;
  const tag = reference.lastIndexOf(":");
  if (
    tag > reference.lastIndexOf("/") &&
    !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(reference.slice(tag + 1))
  )
    return false;
  const repository =
    tag > reference.lastIndexOf("/") ? reference.slice(0, tag) : reference;
  return repository === pinnedParts[0];
}

function containerDirectory(relative: string): string {
  return relative === "."
    ? REPOSITORY_CONTAINER_ROOT
    : `${REPOSITORY_CONTAINER_ROOT}/${relative}`;
}

export const RepositoryCommandPlanSchema = z
  .strictObject({
    version: z.literal(1),
    runtime: z.literal(REPOSITORY_COMMAND_RUNTIME),
    status: z.literal("planned_unverified"),
    workspace: ResourceVersionReferenceSchema,
    source: z.strictObject({
      repositoryUrl: WorkspaceDefinitionSchema.shape.repositoryUrl,
      requestedRef: WorkspaceDefinitionSchema.shape.sourceRef,
      commitOid: RepositoryCommitOidSchema,
    }),
    image: z.strictObject({
      requested: WorkspaceDefinitionSchema.shape.sandboxImage,
      pinned: RepositoryImageDigestSchema,
    }),
    action: z.strictObject({
      kind: RepositoryActionSchema,
      command: WorkspaceDefinitionSchema.shape.actions.shape.test.refine(
        (value) => value.trim().length > 0,
        "Select a configured Workspace action.",
      ),
    }),
    workingDirectory: WorkspaceDefinitionSchema.shape.workingDirectory,
    containerDirectory: z.string().max(222),
    sandbox: z.strictObject({
      policy: z.literal(REPOSITORY_COMMAND_POLICY),
      shell: z.literal("/bin/sh"),
      network: z.literal("none"),
      readOnlyRoot: z.literal(true),
      dropAllCapabilities: z.literal(true),
      noNewPrivileges: z.literal(true),
      user: z.literal("1000:1000"),
    }),
    limits,
  })
  .superRefine((plan, context) => {
    const requestedCommit = RepositoryCommitOidSchema.safeParse(
      plan.source.requestedRef,
    );
    if (
      requestedCommit.success &&
      requestedCommit.data !== plan.source.commitOid
    )
      context.addIssue({
        code: "custom",
        path: ["source", "commitOid"],
        message: "Use the exact commit already selected by this Workspace.",
      });
    if (!matchingImage(plan.image.requested, plan.image.pinned))
      context.addIssue({
        code: "custom",
        path: ["image", "pinned"],
        message: "Pin the same image repository and any already saved digest.",
      });
    if (plan.containerDirectory !== containerDirectory(plan.workingDirectory))
      context.addIssue({
        code: "custom",
        path: ["containerDirectory"],
        message: "Use the derived directory inside the repository volume.",
      });
  });

export type RepositoryAction = z.infer<typeof RepositoryActionSchema>;
export type RepositoryCommandSelection = z.infer<
  typeof RepositoryCommandSelectionSchema
>;
export type RepositoryCommandPlan = z.infer<typeof RepositoryCommandPlanSchema>;

/**
 * Copy declared intent only. The caller must separately authorize and observe
 * the source, image, path, lease, and enforced limits before executing work.
 * No filesystem, subprocess, environment, network, or credential access occurs.
 */
export function compileRepositoryCommandPlan(
  workspace: z.input<typeof workspaceSnapshot>,
  selection: z.input<typeof RepositoryCommandSelectionSchema>,
): RepositoryCommandPlan {
  const saved = workspaceSnapshot.parse(workspace);
  const selected = RepositoryCommandSelectionSchema.parse(selection);
  const definition = saved.definition;
  return RepositoryCommandPlanSchema.parse({
    version: 1,
    runtime: REPOSITORY_COMMAND_RUNTIME,
    status: "planned_unverified",
    workspace: { resourceId: saved.resourceId, versionId: saved.versionId },
    source: {
      repositoryUrl: definition.repositoryUrl,
      requestedRef: definition.sourceRef,
      commitOid: selected.commitOid,
    },
    image: { requested: definition.sandboxImage, pinned: selected.imageDigest },
    action: {
      kind: selected.action,
      command: definition.actions[selected.action],
    },
    workingDirectory: definition.workingDirectory,
    containerDirectory: containerDirectory(definition.workingDirectory),
    sandbox: {
      policy: REPOSITORY_COMMAND_POLICY,
      shell: "/bin/sh",
      network: "none",
      readOnlyRoot: true,
      dropAllCapabilities: true,
      noNewPrivileges: true,
      user: "1000:1000",
    },
    limits: REPOSITORY_COMMAND_LIMITS,
  });
}
