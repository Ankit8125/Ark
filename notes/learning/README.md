# Learning guides

Read these in order or open the topic you need:

1. [Tools and workspace](01-tools-and-workspace.md): Node, pnpm, packages, and commands.
2. [Frontend and data flow](02-frontend-and-data-flow.md): how setup/login reaches the API and database.
3. [Local database](03-local-database.md): Docker, port 5434, persistent data, and role-aware commands.
4. [Git and safe synchronization](04-git-and-safe-sync.md): staging, commits, pushing, and safe history.
5. [Identity and sessions](05-identity-and-sessions.md): working setup/login, runtime roles, tests, and limits.
6. [Project architecture](06-project-architecture.md): folder tree, request flow, recovery, and growth decisions.
7. [Workspaces](07-workspaces.md): create/edit configuration, saved versions, conflicts, and updated startup commands.
8. [Agents](08-agents.md): instructions, stub runtime, model preferences, capabilities, and versioned editing.
9. [Ordered Flows](09-flows.md): named inputs/outputs, ordered stages, pinned versions, validation, and save recovery.
10. [Catalog history](10-catalog-history.md): browse complete snapshots and restore a saved definition as a new revision.
11. [Catalog archive](11-catalog-archive.md): archive/unarchive, active Flow dependencies, and stale lifecycle recovery.
12. [Catalog templates](12-catalog-templates.md): built-in examples, editable copies, explicit dependency choices, and recovery.
13. [Local runners](13-local-runners.md): one-use enrollment, foreground CLI, heartbeat health, revocation, and interruption recovery.
14. [Compute controls](14-compute-controls.md): dispatch approval, explicit member grants, current use permission, and recovery.

The [template completion record](../progress/2026-10-13-01-template-completion.md) records the verified local V0.2 catalog checkpoint. V0.3 local runner enrollment and compute controls are accepted: the [runner checkpoint](../progress/2026-10-20-01-runner-enrollment.md) preserves connection evidence, and the [compute-control checkpoint](../progress/2026-10-24-01-compute-controls.md) records approval/grants, focused checks, browser acceptance, cleanup, and limits. Durable session execution is the next milestone.

Use [current progress](../progress/README.md) for verification and [findings](../findings/README.md) for durable decisions. Give future topics their own files and keep existing explanations aligned with implemented behavior.
