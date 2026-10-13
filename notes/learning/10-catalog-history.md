# Catalog history and restore

Recorded 2026-10-02 (Asia/Kolkata). [Learning index](README.md) · [Current progress](../progress/README.md)

Each Workspace, Agent, and Flow keeps its saved revisions. Open a saved resource and use its history controls to browse revisions and view the complete saved definition. Reading history checks your current session and team membership, just like opening the current definition. Reviewers and viewers can browse; admins and developers can restore.

Restoring revision 1 while revision 3 is current creates revision 4 with revision 1's definition. Revisions 1, 2, and 3 stay intact. The restored resource keeps its identity. Restore also copies the saved name, which must still be available within the team and resource kind.

The confirmation explains that restore replaces the editor's draft. Cancel keeps the draft. A failed request also keeps it. If another person saved after you opened the resource, restore receives a conflict; load the latest saved resource explicitly before deciding whether to try again. A lost response can mean the server already committed, so inspect the latest revision before retrying. Restore never retries automatically.

```text
Choose saved snapshot + expected definition/lifecycle revisions
    -> confirm restore
    -> API: current session, explicit team membership, write role
    -> lock current resource and check expected counters and active state
    -> validate stored schema and definition
    -> Flow: check original dependency pins under current access
    -> commit new snapshot, current pointer, and source audit together
    -> show returned saved revision
```

A restored Flow retains the exact Workspace and Agent version IDs from the selected snapshot. It does not advance them to the latest revisions. If a dependency is unavailable or its pinned definition is unsupported, restore fails and keeps the current Flow. Restoring an Agent or Workspace creates a new revision; existing Flows keep their previous pins.

Unsupported stored schemas remain readable as complete definitions and cannot be restored. Invalid saved definitions also fail safely. History loads newest first in pages of 50. Opening one revision loads its full definition separately, so listing history does not fetch every saved instruction or Flow recipe.

History itself uses the existing version tables and adds no migration or dependency. The subsequent [archive increment](11-catalog-archive.md) adds migration 005 and requires the lifecycle counter for restore. Archived records remain readable; unarchive them before restoring a definition. Start the project with the existing environment and volume using the commands in the [Workspace guide](07-workspaces.md). Saving or restoring configuration performs no repository access, command execution, or model call.

[Built-in templates](12-catalog-templates.md) fill new unsaved drafts. Once saved, each copy has its own resource identity and immutable revisions and follows the same history/restore rules described here. Shipped-template changes never rewrite those snapshots. See the [template completion record](../progress/2026-10-13-01-template-completion.md) for acceptance and limits.
