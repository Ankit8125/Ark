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
15. [Durable stub sessions](15-durable-sessions.md): explicit versioned starts, typed values, opt-in runner work, lease ownership, event replay, cancellation, and recovery.
16. [Repository-command planning](16-repository-planning.md): one explicit Workspace action, declared commit/image identity, pure unverified plans, and the remaining V0.5 boundaries.
17. [Saved repository plans](17-saved-repository-plans.md): authorized backend preview/save/read, immutable records, versioned digests, replay, and the separate execution boundary.
18. [Repository admission and preparation control](18-repository-execution-control.md): standalone plan-bound admission, shared runner ownership, preparation-only deadlines/renewal, and recovery gates.
19. [Preparation receipts](19-preparation-receipts.md): immutable unverified observations, exact binding, late diagnostics, and the remaining trust boundary.

The [template completion record](../progress/2026-10-13-01-template-completion.md) records the verified local V0.2 catalog checkpoint. V0.3 local runner enrollment and compute controls are accepted: the [runner checkpoint](../progress/2026-10-20-01-runner-enrollment.md) preserves connection evidence, and the [compute-control checkpoint](../progress/2026-10-24-01-compute-controls.md) records approval/grants, focused checks, browser acceptance, cleanup, and limits. V0.4 deterministic durable sessions remain the accepted runnable workflow in the [October 25 record](../progress/2026-10-25-01-durable-sessions.md). V0.5 has a [recorded contract](../findings/repository-execution.md), pure planner, saved-plan API, and repository admission/preparation-control backend verified locally. The [control record](../progress/2026-10-26-02-repository-execution-control.md) preserves focused tests, migration/privileges, and cleanup. There is no repository adapter, command execution, release protocol, CLI worker, UI, or quality verdict yet; V0.5 remains incomplete.

The [preparation receipt journal](19-preparation-receipts.md) is also verified locally in its [October 27 record](../progress/2026-10-27-01-preparation-receipts.md). It stores unverified observations with no work-authority, lifecycle, lease, or capacity effects; actual process/cleanup observations and command authorization remain future work.

Use [current progress](../progress/README.md) for verification and [findings](../findings/README.md) for durable decisions. Give future topics their own files and keep existing explanations aligned with implemented behavior.
