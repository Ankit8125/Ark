import {
  FlowDefinitionSchema,
  type Flow,
  type FlowDefinition,
} from "@ark/contracts";
import { CatalogEditor, CatalogField } from "../catalog/CatalogEditor";
import {
  useVersionedEditor,
  type EditorConfig,
  type EditorProps,
} from "../catalog/useVersionedEditor";
import styles from "../catalog/catalog.module.css";
import { flowApi } from "./api";
import { FlowPorts } from "./FlowPorts";
import { FlowStages } from "./FlowStages";
import { fieldError, newStage, stageSources } from "./flow-fields";
import {
  DependencyCatalogStatus,
  ResourceVersionPicker,
} from "./ResourceVersionPicker";
import { useDependencyCatalog } from "./useDependencyCatalog";

const config: EditorConfig<FlowDefinition, Flow> = {
  kind: "flow",
  plural: "flows",
  createDescription:
    "Save ordered stages and the versions they depend on. Execution comes later.",
  emptyDefinition: () => {
    const stage = newStage(0, { kind: "flow_input", port: "task" });
    return {
      name: "",
      description: "",
      workspace: { resourceId: "", versionId: "" },
      inputs: [{ name: "task", type: "text" }],
      stages: [stage],
      outputs: [
        {
          name: "result",
          type: "text",
          source: { kind: "stage_output", stageId: stage.id, port: "result" },
        },
      ],
    };
  },
  schema: FlowDefinitionSchema,
  api: flowApi,
};

export function FlowEditor({
  flowId,
  ...props
}: Omit<EditorProps, "resourceId"> & { flowId?: string }) {
  const editor = useVersionedEditor({ ...props, resourceId: flowId }, config);
  const { draft, errors, writable, busy, changeDraft } = editor;
  const workspaces = useDependencyCatalog(
    "workspace",
    props.team.id,
    props.onExpired,
  );
  const agents = useDependencyCatalog("agent", props.team.id, props.onExpired);
  return (
    <CatalogEditor editor={editor}>
      <section
        className={styles.formPanel}
        aria-labelledby="flow-details-heading"
      >
        <h2 id="flow-details-heading">Flow details</h2>
        <CatalogField
          kind="flow"
          name="name"
          label="Name"
          value={draft.name}
          maxLength={80}
          required
          placeholder="Change review…"
          error={errors.name?.[0]}
          writable={writable}
          busy={busy}
          onChange={(name) => changeDraft({ ...draft, name })}
        />
        <CatalogField
          kind="flow"
          name="description"
          label="Description"
          value={draft.description}
          maxLength={2000}
          multiline
          error={errors.description?.[0]}
          writable={writable}
          busy={busy}
          onChange={(description) => changeDraft({ ...draft, description })}
        />
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="flow-workspace-heading"
      >
        <h2 id="flow-workspace-heading">Workspace version</h2>
        <DependencyCatalogStatus
          kind="workspace"
          catalog={workspaces}
          busy={busy}
        />
        <ResourceVersionPicker
          kind="workspace"
          teamId={props.team.id}
          name="workspace"
          label="Workspace version"
          value={draft.workspace}
          items={workspaces.items}
          error={fieldError(errors, "workspace")}
          writable={writable}
          busy={busy}
          onChange={(workspace) => changeDraft({ ...draft, workspace })}
          onExpired={props.onExpired}
        />
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="flow-inputs-heading"
      >
        <h2 id="flow-inputs-heading">Flow inputs</h2>
        <p className={styles.sectionHint}>
          Declare the values a future session will supply. Text is a string;
          JSON is structured data. No task values are saved here.
        </p>
        <FlowPorts
          title="Flow input"
          path="inputs"
          ports={draft.inputs}
          errors={errors}
          writable={writable}
          busy={busy}
          createPort={() => ({ name: "", type: "text" })}
          onChange={(inputs) => changeDraft({ ...draft, inputs })}
        />
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="flow-stages-heading"
      >
        <h2 id="flow-stages-heading">Ordered stages</h2>
        <p className={styles.sectionHint}>
          Stages run in this order when execution is available. Each input must
          match a flow input or an earlier stage output. Moving or removing a
          stage keeps its references; fix any invalid sources before saving.
        </p>
        <DependencyCatalogStatus kind="agent" catalog={agents} busy={busy} />
        <FlowStages
          draft={draft}
          teamId={props.team.id}
          agents={agents.items}
          errors={errors}
          writable={writable}
          busy={busy}
          onExpired={props.onExpired}
          onChange={(stages) => changeDraft({ ...draft, stages })}
        />
      </section>
      <section
        className={styles.formPanel}
        aria-labelledby="flow-outputs-heading"
      >
        <h2 id="flow-outputs-heading">Flow outputs</h2>
        <p className={styles.sectionHint}>
          Choose the stage outputs a future session will return. Use matching
          types. Each input or output list supports up to 8 ports; a flow
          supports up to 20 stages.
        </p>
        <FlowPorts
          title="Flow output"
          path="outputs"
          ports={draft.outputs}
          errors={errors}
          writable={writable}
          busy={busy}
          choices={stageSources(draft.stages)}
          createPort={() => ({
            name: "",
            type: "text",
            source: {
              kind: "stage_output",
              stageId: draft.stages.at(-1)?.id ?? "",
              port: draft.stages.at(-1)?.outputs[0]?.name ?? "",
            },
          })}
          onChange={(outputs) => changeDraft({ ...draft, outputs })}
        />
      </section>
    </CatalogEditor>
  );
}
