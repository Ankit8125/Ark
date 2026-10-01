import type { FlowInputSource, FlowPort, FlowValueType } from "@ark/contracts";
import { Plus, X } from "lucide-react";
import common from "../../App.module.css";
import { CatalogField } from "../catalog/CatalogEditor";
import styles from "../catalog/catalog.module.css";
import flowStyles from "./flows.module.css";
import { fieldError, sourceKey, type SourceChoice } from "./flow-fields";

type EditablePort = FlowPort & { source?: FlowInputSource };

export function FlowPorts<T extends EditablePort>({
  title,
  path,
  ports,
  errors,
  writable,
  busy,
  choices,
  createPort,
  onChange,
}: {
  title: string;
  path: string;
  ports: T[];
  errors: Record<string, string[]>;
  writable: boolean;
  busy: boolean;
  choices?: SourceChoice[];
  createPort: () => T;
  onChange: (ports: T[]) => void;
}) {
  const id = `flow-${path.replaceAll(".", "-")}`;
  const update = (index: number, change: Partial<T>) =>
    onChange(
      ports.map((port, current) =>
        current === index ? { ...port, ...change } : port,
      ),
    );
  return (
    <fieldset className={flowStyles.ports} aria-labelledby={`${id}-heading`}>
      <legend id={`${id}-heading`}>{title}</legend>
      {ports.map((port, index) => {
        const prefix = `${path}.${index}`;
        const typeId = `flow-${prefix.replaceAll(".", "-")}-type`;
        const sourceId = `flow-${prefix.replaceAll(".", "-")}-source`;
        const typeError = errors[`${prefix}.type`]?.[0];
        const sourceError = fieldError(errors, `${prefix}.source`);
        const selectedSource = port.source ? sourceKey(port.source) : "";
        const retainedSource =
          selectedSource &&
          !choices?.some(
            (choice) => sourceKey(choice.source) === selectedSource,
          );
        return (
          <div className={flowStyles.port} key={index}>
            <div className={flowStyles.portFields}>
              <CatalogField
                kind="flow"
                name={`${prefix}.name`}
                label={`${title} ${index + 1} name`}
                value={port.name}
                maxLength={40}
                required
                error={errors[`${prefix}.name`]?.[0]}
                writable={writable}
                busy={busy}
                placeholder="result…"
                onChange={(name) => update(index, { name } as Partial<T>)}
              />
              <div className={styles.field}>
                <label htmlFor={typeId}>
                  {title} {index + 1} type
                </label>
                <select
                  id={typeId}
                  name={`${prefix}.type`}
                  value={port.type}
                  disabled={!writable || busy}
                  aria-invalid={Boolean(typeError)}
                  aria-describedby={typeError ? `${typeId}-error` : undefined}
                  onChange={(event) =>
                    update(index, {
                      type: event.target.value as FlowValueType,
                    } as Partial<T>)
                  }
                >
                  <option value="text">Text</option>
                  <option value="json">JSON</option>
                </select>
                {typeError && (
                  <p id={`${typeId}-error`} className={common.fieldError}>
                    {typeError}
                  </p>
                )}
              </div>
              {choices && (
                <div className={styles.field}>
                  <label htmlFor={sourceId}>
                    {title} {index + 1} source
                  </label>
                  <select
                    id={sourceId}
                    name={`${prefix}.source`}
                    value={selectedSource}
                    disabled={!writable || busy}
                    aria-invalid={Boolean(sourceError)}
                    aria-describedby={
                      sourceError ? `${sourceId}-error` : undefined
                    }
                    onChange={(event) => {
                      const selected = choices.find(
                        (choice) =>
                          sourceKey(choice.source) === event.target.value,
                      );
                      if (selected)
                        update(index, {
                          source: selected.source,
                        } as Partial<T>);
                    }}
                  >
                    {!selectedSource && (
                      <option value="">Choose a source…</option>
                    )}
                    {retainedSource && (
                      <option value={selectedSource}>
                        Unavailable source:{" "}
                        {port.source?.port || "not selected"}
                      </option>
                    )}
                    {choices.map((choice, choiceIndex) => (
                      <option
                        key={`${sourceKey(choice.source)}:${choiceIndex}`}
                        value={sourceKey(choice.source)}
                      >
                        {choice.label}
                      </option>
                    ))}
                  </select>
                  {sourceError && (
                    <p id={`${sourceId}-error`} className={common.fieldError}>
                      {sourceError}
                    </p>
                  )}
                </div>
              )}
            </div>
            {writable && (
              <button
                type="button"
                className={common.secondaryButton}
                disabled={busy || ports.length <= 1}
                aria-label={`Remove ${title.toLowerCase()} ${index + 1}`}
                onClick={() =>
                  onChange(ports.filter((_, current) => current !== index))
                }
              >
                <X size={15} aria-hidden="true" /> Remove
              </button>
            )}
          </div>
        );
      })}
      {errors[path]?.[0] && (
        <p className={common.fieldError}>{errors[path][0]}</p>
      )}
      {writable && (
        <button
          type="button"
          className={common.secondaryButton}
          disabled={busy || ports.length >= 8}
          onClick={() => onChange([...ports, createPort()])}
        >
          <Plus size={15} aria-hidden="true" /> Add {title.toLowerCase()}
        </button>
      )}
    </fieldset>
  );
}
