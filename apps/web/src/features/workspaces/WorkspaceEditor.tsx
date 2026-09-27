import {
  WorkspaceDefinitionSchema,
  type Workspace,
  type WorkspaceDefinition,
} from "@ark/contracts";
import { CatalogEditor, CatalogField } from "../catalog/CatalogEditor";
import {
  useVersionedEditor,
  type EditorConfig,
  type EditorProps,
} from "../catalog/useVersionedEditor";
import styles from "../catalog/catalog.module.css";
import { workspaceApi } from "./api";

type FieldName =
  | Exclude<keyof WorkspaceDefinition, "actions">
  | `actions.${keyof WorkspaceDefinition["actions"]}`;
const config: EditorConfig<WorkspaceDefinition, Workspace> = {
  kind: "workspace",
  plural: "workspaces",
  createDescription: "Save the repository and actions your team will use.",
  emptyDefinition: () => ({
    name: "",
    description: "",
    repositoryUrl: "",
    sourceRef: "main",
    defaultBranch: "main",
    sandboxImage: "",
    workingDirectory: ".",
    actions: { install: "", test: "", lint: "", build: "" },
  }),
  schema: WorkspaceDefinitionSchema,
  api: workspaceApi,
};

export function WorkspaceEditor({
  workspaceId,
  ...props
}: Omit<EditorProps, "resourceId"> & { workspaceId?: string }) {
  const editor = useVersionedEditor(
    { ...props, resourceId: workspaceId },
    config,
  );
  const { draft } = editor;
  function field(
    name: FieldName,
    label: string,
    options: {
      hint?: string;
      multiline?: boolean;
      maxLength: number;
      required?: boolean;
      placeholder?: string;
      type?: string;
    },
  ) {
    const action = name.startsWith("actions.")
      ? (name.slice(8) as keyof WorkspaceDefinition["actions"])
      : null;
    return (
      <CatalogField
        key={name}
        kind="workspace"
        name={name}
        label={label}
        value={
          action
            ? draft.actions[action]
            : draft[name as Exclude<keyof WorkspaceDefinition, "actions">]
        }
        error={editor.errors[name]?.[0]}
        writable={editor.writable}
        busy={editor.busy}
        onChange={(value) =>
          editor.changeDraft(
            action
              ? { ...draft, actions: { ...draft.actions, [action]: value } }
              : { ...draft, [name]: value },
          )
        }
        rows={action ? 2 : 3}
        code={Boolean(action)}
        {...options}
      />
    );
  }
  return (
    <CatalogEditor editor={editor}>
      <section
        className={styles.formPanel}
        aria-labelledby="workspace-details-heading"
      >
        <h2 id="workspace-details-heading">Workspace details</h2>
        {field("name", "Name", {
          required: true,
          maxLength: 80,
          placeholder: "Customer portal…",
        })}
        {field("description", "Description", {
          maxLength: 2000,
          multiline: true,
        })}
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="workspace-source-heading"
      >
        <h2 id="workspace-source-heading">Source</h2>
        {field("repositoryUrl", "Repository URL", {
          required: true,
          maxLength: 2048,
          type: "url",
          placeholder: "https://github.com/your-team/project…",
          hint: "HTTPS URL without embedded credentials, query parameters, or fragments.",
        })}
        <div className={styles.fieldGrid}>
          {field("sourceRef", "Source revision", {
            required: true,
            maxLength: 200,
            hint: "Branch, tag, or commit to start from.",
          })}
          {field("defaultBranch", "Default branch", {
            required: true,
            maxLength: 200,
            hint: "The repository’s usual target branch.",
          })}
        </div>
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="workspace-environment-heading"
      >
        <h2 id="workspace-environment-heading">Environment</h2>
        <div className={styles.fieldGrid}>
          {field("sandboxImage", "Container image", {
            required: true,
            maxLength: 200,
            placeholder: "node:24-bookworm…",
            hint: "Image reference for a future isolated run.",
          })}
          {field("workingDirectory", "Working directory", {
            required: true,
            maxLength: 200,
            hint: "Relative to the repository, for example . or apps/web.",
          })}
        </div>
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="workspace-actions-heading"
      >
        <h2 id="workspace-actions-heading">Actions</h2>
        <p className={styles.sectionHint}>
          Saving stores configuration only. It does not clone a repository, pull
          an image, or run these commands. Keep credentials out of commands and
          other fields.
        </p>
        <div className={styles.fieldGrid}>
          {(["install", "test", "lint", "build"] as const).map((action) =>
            field(
              `actions.${action}`,
              `${action[0].toUpperCase()}${action.slice(1)} command`,
              { maxLength: 1000, multiline: true },
            ),
          )}
        </div>
      </section>
    </CatalogEditor>
  );
}
