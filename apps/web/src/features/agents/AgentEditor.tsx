import {
  AgentDefinitionSchema,
  type Agent,
  type AgentCapability,
  type AgentDefinition,
} from "@ark/contracts";
import common from "../../App.module.css";
import { CatalogEditor, CatalogField } from "../catalog/CatalogEditor";
import {
  useVersionedEditor,
  type EditorConfig,
  type EditorProps,
} from "../catalog/useVersionedEditor";
import styles from "../catalog/catalog.module.css";
import { agentApi } from "./api";

const config: EditorConfig<AgentDefinition, Agent> = {
  kind: "agent",
  plural: "agents",
  createDescription:
    "Save the instructions and preferences your team will use.",
  emptyDefinition: () => ({
    name: "",
    description: "",
    instructions: "",
    runtime: "stub",
    modelPreference: null,
    capabilities: [],
  }),
  schema: AgentDefinitionSchema,
  api: agentApi,
};
const capabilities: {
  value: AgentCapability;
  label: string;
  description: string;
}[] = [
  {
    value: "read_files",
    label: "Read files",
    description: "Inspect files in a future authorized workspace.",
  },
  {
    value: "edit_files",
    label: "Edit files",
    description:
      "Propose or make file changes in a future authorized workspace.",
  },
  {
    value: "run_commands",
    label: "Run commands",
    description:
      "Request command execution in a future authorized environment.",
  },
];

export function AgentEditor({
  agentId,
  ...props
}: Omit<EditorProps, "resourceId"> & { agentId?: string }) {
  const editor = useVersionedEditor({ ...props, resourceId: agentId }, config);
  const { draft } = editor;
  function field(
    name: "name" | "description" | "instructions" | "modelPreference",
    label: string,
    options: {
      maxLength: number;
      required?: boolean;
      multiline?: boolean;
      rows?: number;
      hint?: string;
      placeholder?: string;
    },
  ) {
    return (
      <CatalogField
        kind="agent"
        name={name}
        label={label}
        value={draft[name] ?? ""}
        error={editor.errors[name]?.[0]}
        writable={editor.writable}
        busy={editor.busy}
        onChange={(value) =>
          editor.changeDraft({
            ...draft,
            [name]: name === "modelPreference" && value === "" ? null : value,
          })
        }
        {...options}
      />
    );
  }
  return (
    <CatalogEditor editor={editor}>
      <section
        className={styles.formPanel}
        aria-labelledby="agent-details-heading"
      >
        <h2 id="agent-details-heading">Agent details</h2>
        {field("name", "Name", {
          required: true,
          maxLength: 80,
          placeholder: "Code reviewer…",
        })}
        {field("description", "Description", {
          maxLength: 2000,
          multiline: true,
        })}
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="agent-instructions-heading"
      >
        <h2 id="agent-instructions-heading">Instructions</h2>
        {field("instructions", "Agent instructions", {
          required: true,
          maxLength: 16000,
          multiline: true,
          rows: 10,
          hint: "Describe the role, task boundaries, and expected output. Keep credentials out of these fields.",
        })}
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="agent-runtime-heading"
      >
        <h2 id="agent-runtime-heading">Runtime preferences</h2>
        <div className={styles.fieldGrid}>
          <div className={styles.field}>
            <label htmlFor="agent-runtime">Runtime</label>
            <select
              id="agent-runtime"
              name="runtime"
              value={draft.runtime}
              disabled={!editor.writable || editor.busy}
              aria-describedby="agent-runtime-hint"
              onChange={(event) => {
                if (event.target.value === "stub")
                  editor.changeDraft({ ...draft, runtime: "stub" });
              }}
            >
              <option value="stub">Stub (planned)</option>
            </select>
            <p id="agent-runtime-hint" className={common.hint}>
              A deterministic stub is planned for local verification. Execution
              is not available yet.
            </p>
          </div>
          {field("modelPreference", "Model preference", {
            maxLength: 200,
            hint: "Optional model identifier, stored only. The planned stub does not use a model.",
          })}
        </div>
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="agent-capabilities-heading"
      >
        <h2 id="agent-capabilities-heading">Requested capabilities</h2>
        <p id="agent-capabilities-hint" className={styles.sectionHint}>
          These are configuration preferences for future runs. Saving does not
          grant access, run commands, or call a model.
        </p>
        <fieldset
          className={styles.capabilities}
          disabled={!editor.writable || editor.busy}
          aria-describedby="agent-capabilities-hint"
          aria-label="Requested capabilities"
        >
          {capabilities.map((capability) => (
            <label className={styles.capability} key={capability.value}>
              <input
                type="checkbox"
                name="capabilities"
                value={capability.value}
                checked={draft.capabilities.includes(capability.value)}
                onChange={(event) =>
                  editor.changeDraft({
                    ...draft,
                    capabilities: event.target.checked
                      ? [...draft.capabilities, capability.value]
                      : draft.capabilities.filter(
                          (value) => value !== capability.value,
                        ),
                  })
                }
              />
              <span>
                <strong>{capability.label}</strong>
                <span>{capability.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {editor.errors.capabilities?.[0] && (
          <p className={common.fieldError}>{editor.errors.capabilities[0]}</p>
        )}
      </section>
    </CatalogEditor>
  );
}
