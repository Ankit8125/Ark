import type { FlowDefinition, FlowStage } from "@ark/contracts";
import { ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import common from "../../App.module.css";
import { CatalogField } from "../catalog/CatalogEditor";
import styles from "../catalog/catalog.module.css";
import { FlowPorts } from "./FlowPorts";
import {
  fieldError,
  newStage,
  stageSources,
  type SourceChoice,
} from "./flow-fields";
import { ResourceVersionPicker } from "./ResourceVersionPicker";
import type { DependencySummary } from "./useDependencyCatalog";
import flowStyles from "./flows.module.css";

export function FlowStages({
  draft,
  teamId,
  agents,
  errors,
  writable,
  busy,
  onExpired,
  onChange,
}: {
  draft: FlowDefinition;
  teamId: string;
  agents: DependencySummary[];
  errors: Record<string, string[]>;
  writable: boolean;
  busy: boolean;
  onExpired: () => void;
  onChange: (stages: FlowStage[]) => void;
}) {
  function update(index: number, changes: Partial<FlowStage>) {
    onChange(
      draft.stages.map((stage, current) =>
        current === index ? { ...stage, ...changes } : stage,
      ),
    );
  }
  function move(index: number, delta: -1 | 1) {
    const stages = [...draft.stages];
    [stages[index], stages[index + delta]] = [
      stages[index + delta]!,
      stages[index]!,
    ];
    onChange(stages);
  }
  return (
    <>
      <div className={flowStyles.stageList}>
        {draft.stages.map((stage, index) => {
          const prefix = `stages.${index}`;
          const inputChoices: SourceChoice[] = [
            ...draft.inputs.map((port) => ({
              source: { kind: "flow_input" as const, port: port.name },
              label: `Flow / ${port.name || "Unnamed input"} (${port.type})`,
            })),
            ...stageSources(draft.stages.slice(0, index)),
          ];
          return (
            <section
              key={stage.id}
              className={flowStyles.stage}
              aria-labelledby={`stage-${stage.id}-heading`}
            >
              <div className={flowStyles.stageHeading}>
                <h3 id={`stage-${stage.id}-heading`}>
                  {index + 1}. {stage.name || "Unnamed stage"}
                </h3>
                {writable && (
                  <div className={flowStyles.stageActions}>
                    <button
                      type="button"
                      className={common.secondaryButton}
                      disabled={busy || index === 0}
                      aria-label={`Move stage ${index + 1} up`}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={15} aria-hidden="true" /> Up
                    </button>
                    <button
                      type="button"
                      className={common.secondaryButton}
                      disabled={busy || index === draft.stages.length - 1}
                      aria-label={`Move stage ${index + 1} down`}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={15} aria-hidden="true" /> Down
                    </button>
                    <button
                      type="button"
                      className={common.secondaryButton}
                      disabled={busy || draft.stages.length <= 1}
                      aria-label={`Remove stage ${index + 1}`}
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove stage ${index + 1}, ${stage.name || "Unnamed stage"}, from this draft? Any references to its outputs will need updating.`,
                          )
                        )
                          onChange(
                            draft.stages.filter(
                              (_, current) => current !== index,
                            ),
                          );
                      }}
                    >
                      <X size={15} aria-hidden="true" /> Remove
                    </button>
                  </div>
                )}
              </div>
              <div className={styles.fieldGrid}>
                <CatalogField
                  kind="flow"
                  name={`${prefix}.name`}
                  label={`Stage ${index + 1} name`}
                  value={stage.name}
                  maxLength={80}
                  required
                  error={errors[`${prefix}.name`]?.[0]}
                  writable={writable}
                  busy={busy}
                  onChange={(name) => update(index, { name })}
                />
                <ResourceVersionPicker
                  kind="agent"
                  teamId={teamId}
                  name={`${prefix}.agent`}
                  label={`Stage ${index + 1} agent`}
                  value={stage.agent}
                  items={agents}
                  error={fieldError(errors, `${prefix}.agent`)}
                  writable={writable}
                  busy={busy}
                  onChange={(agent) => update(index, { agent })}
                  onExpired={onExpired}
                />
              </div>
              <FlowPorts
                title={`Stage ${index + 1} input`}
                path={`${prefix}.inputs`}
                ports={stage.inputs}
                errors={errors}
                writable={writable}
                busy={busy}
                choices={inputChoices}
                createPort={() => ({
                  name: "",
                  type: "text",
                  source: {
                    kind: "flow_input",
                    port: draft.inputs[0]?.name ?? "",
                  },
                })}
                onChange={(inputs) => update(index, { inputs })}
              />
              <FlowPorts
                title={`Stage ${index + 1} output`}
                path={`${prefix}.outputs`}
                ports={stage.outputs}
                errors={errors}
                writable={writable}
                busy={busy}
                createPort={() => ({ name: "", type: "text" })}
                onChange={(outputs) => update(index, { outputs })}
              />
            </section>
          );
        })}
      </div>
      {errors.stages?.[0] && (
        <p className={common.fieldError}>{errors.stages[0]}</p>
      )}
      {writable && (
        <button
          type="button"
          className={`${common.secondaryButton} ${flowStyles.addStage}`}
          disabled={busy || draft.stages.length >= 20}
          onClick={() =>
            onChange([
              ...draft.stages,
              newStage(draft.stages.length, {
                kind: "flow_input",
                port: draft.inputs[0]?.name ?? "",
              }),
            ])
          }
        >
          <Plus size={16} aria-hidden="true" /> Add stage
        </button>
      )}
    </>
  );
}
