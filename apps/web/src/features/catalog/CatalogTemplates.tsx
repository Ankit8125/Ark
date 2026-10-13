import common from "../../App.module.css";
import styles from "./catalog.module.css";
import type { CatalogRecord, VersionedEditor } from "./useVersionedEditor";

export function CatalogTemplates<Definition, RecordType extends CatalogRecord>({
  editor,
}: {
  editor: VersionedEditor<Definition, RecordType>;
}) {
  const {
    config,
    resourceId,
    record,
    writable,
    busy,
    conflict,
    templatesOpen,
    templates,
    templatesLoading,
    templatesError,
    loadTemplates,
    applyTemplate,
  } = editor;
  if (resourceId || record || !writable) return null;
  return (
    <section
      className={styles.formPanel}
      aria-labelledby="catalog-templates-heading"
      aria-busy={templatesLoading}
    >
      <h2 id="catalog-templates-heading">Start from a template</h2>
      <p className={styles.sectionHint}>
        Optional examples you can edit before saving.
        {config.kind === "workspace" &&
          " Add your repository URL after choosing one."}
        {config.kind === "flow" &&
          " Choose a Workspace version and an Agent version for every stage after copying an example."}
      </p>
      {!templatesOpen ? (
        <button
          type="button"
          className={`${common.secondaryButton} ${styles.fitButton}`}
          disabled={busy || conflict !== null}
          onClick={() => void loadTemplates()}
        >
          Browse templates
        </button>
      ) : templatesLoading ? (
        <p role="status">Loading templates…</p>
      ) : templatesError ? (
        <div className={styles.notice}>
          <p role="alert">{templatesError}</p>
          <p>Your draft is still here.</p>
          <button
            type="button"
            className={`${common.secondaryButton} ${styles.fitButton}`}
            disabled={busy || conflict !== null}
            onClick={() => void loadTemplates()}
          >
            Retry templates
          </button>
        </div>
      ) : templates.length === 0 ? (
        <p role="status">No templates are available for this catalog.</p>
      ) : (
        <ul className={styles.templateList}>
          {templates.map((template) => (
            <li className={styles.templateEntry} key={template.id}>
              <h3>{template.title}</h3>
              <p>{template.description}</p>
              <button
                type="button"
                className={`${common.secondaryButton} ${styles.fitButton}`}
                disabled={busy || conflict !== null}
                onClick={() => applyTemplate(template)}
              >
                Use {template.title} template
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
