# Start from a built-in template

Recorded 2026-10-05 (Asia/Kolkata). [Learning index](README.md) · [Current progress](../progress/README.md)

Templates provide editable examples for a new Workspace, Agent, or Flow. Open a new configuration, browse the templates, and apply one to fill the draft. Review its fields, complete the required choices, and save. Applying a template alone saves nothing.

## What you complete

- **Workspace:** add your repository URL and review the branch, image, directory, and commands. The pnpm example assumes your project has the corresponding scripts and pnpm will be available when execution is introduced.
- **Agent:** review the instructions and requested capabilities. The runtime is still a stub, and no model is called. Capabilities remain configuration until an execution milestone implements effective grants.
- **Flow:** choose a Workspace version and an Agent version for every stage. The implementation/review recipe is one example; rename, add, remove, or reorder stages and fix their bindings as needed. Dependencies are never chosen automatically.

Every copied Flow stage receives a fresh identity. Connections between stages and final outputs follow the copied stages. Choosing saved dependencies creates explicit version pins, which ordinary Save validates against the current team and active resources.

## Copies and recovery

Built-in templates belong to the application. They are not editable team resources. Saving a draft creates your team's independent record at revision 1, with ordinary history, edits, restore, and archive behavior. Editing that record does not change the template or other copies. Future changes to shipped templates do not update your saved configuration.

Applying another template asks before replacing a dirty draft. Cancel leaves it intact. A failed template read leaves manual edits available; retry the read when connectivity returns. A save failure keeps the existing creation identity and recovery choices, including checking whether an uncertain request already created the record.

Templates require no database migration or API key. Existing environment files, database volumes, and startup commands remain valid. See the [contract](../findings/catalog-templates.md) and [completion record](../progress/2026-10-13-01-template-completion.md) for verified behavior and acceptance limits.
