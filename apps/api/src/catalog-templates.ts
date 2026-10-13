import {
  CatalogTemplateListResponseSchema,
  type CatalogTemplateKind,
  type CatalogTemplateListResponse,
} from "@ark/contracts";

// Original, application-owned examples. Reading these never seeds a team's
// resources. Repository and dependency choices are supplied in the new draft.
const builtins = CatalogTemplateListResponseSchema.parse({
  templates: [
    {
      id: "node-pnpm",
      templateVersion: 1,
      schemaVersion: 1,
      kind: "workspace",
      title: "Node.js with pnpm",
      description:
        "Start with common pnpm scripts. Add your repository URL and review the image, pnpm availability, and commands for your project.",
      definition: {
        name: "Node.js workspace",
        description:
          "Node.js repository configuration. Review the image and commands before future execution.",
        sourceRef: "main",
        defaultBranch: "main",
        sandboxImage: "node:24",
        workingDirectory: ".",
        actions: {
          install: "pnpm install --frozen-lockfile",
          test: "pnpm test",
          lint: "pnpm lint",
          build: "pnpm build",
        },
      },
    },
    {
      id: "implementation",
      templateVersion: 1,
      schemaVersion: 1,
      kind: "agent",
      title: "Implementation agent",
      description:
        "Instructions for making a scoped change and reporting what was actually checked. Runtime remains a stub.",
      definition: {
        name: "Implementation agent",
        description: "A starting point for a focused implementation stage.",
        instructions:
          "Read the task and relevant project guidance. Inspect the affected code before proposing changes. Keep changes within the requested scope and preserve existing work. Explain the resulting behavior and any remaining uncertainty. Report checks only when they have actually run, including failures and skipped checks.",
        runtime: "stub",
        modelPreference: null,
        capabilities: ["read_files", "edit_files", "run_commands"],
      },
    },
    {
      id: "review",
      templateVersion: 1,
      schemaVersion: 1,
      kind: "agent",
      title: "Review agent",
      description:
        "Instructions for reviewing a proposed change and its evidence. Runtime remains a stub.",
      definition: {
        name: "Review agent",
        description: "A starting point for an independent review stage.",
        instructions:
          "Read the task, proposed change, and available evidence. Look for concrete correctness, authorization, data integrity, and regression issues. Explain each actionable finding with its trigger and impact. Distinguish verified facts from assumptions and checks that have not run. If no actionable issue is found, say so and state the limits of the review.",
        runtime: "stub",
        modelPreference: null,
        capabilities: ["read_files"],
      },
    },
    {
      id: "implementation-review",
      templateVersion: 1,
      schemaVersion: 1,
      kind: "flow",
      title: "Implementation and review",
      description:
        "An editable two-stage example. Choose a Workspace and an Agent version for each stage; add or change stages to fit your task.",
      definition: {
        name: "Implementation and review",
        description:
          "One example Flow: implementation followed by review. All stages and bindings are editable; this configuration does not execute work.",
        inputs: [{ name: "task", type: "text" }],
        stages: [
          {
            id: "031b3d4f-e37b-4776-bc64-1c7ed3f84b01",
            name: "Implement",
            inputs: [
              {
                name: "task",
                type: "text",
                source: { kind: "flow_input", port: "task" },
              },
            ],
            outputs: [{ name: "proposal", type: "text" }],
          },
          {
            id: "031b3d4f-e37b-4776-bc64-1c7ed3f84b02",
            name: "Review",
            inputs: [
              {
                name: "task",
                type: "text",
                source: { kind: "flow_input", port: "task" },
              },
              {
                name: "proposal",
                type: "text",
                source: {
                  kind: "stage_output",
                  stageId: "031b3d4f-e37b-4776-bc64-1c7ed3f84b01",
                  port: "proposal",
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
              stageId: "031b3d4f-e37b-4776-bc64-1c7ed3f84b02",
              port: "report",
            },
          },
        ],
      },
    },
  ],
});

export function listBuiltinTemplates(
  kind: CatalogTemplateKind,
): CatalogTemplateListResponse {
  // Parsing returns fresh nested values; a caller cannot mutate the originals.
  return CatalogTemplateListResponseSchema.parse({
    templates: builtins.templates.filter((template) => template.kind === kind),
  });
}
