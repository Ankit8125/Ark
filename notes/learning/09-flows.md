# Ordered Flows and pinned versions

Updated 2026-10-01. [Learning index](README.md)

The Flow catalog has passed automated checks and a real-browser acceptance walkthrough; the [completion record](../progress/2026-10-01-01-flow-completion.md) records the evidence and limits. This guide describes its implemented configuration contract. Execution remains a later milestone.

A Workspace describes the repository and commands. An Agent describes instructions and preferences. A Flow connects those definitions into an ordered recipe. Saving a recipe does not run it or contact a model provider.

## Follow the data

```text
Workspace revision 1 ───────────────────────┐
                                           v
Flow input: task (text) -> Plan stage -> Build stage -> Flow output: result
                          Agent v1      Agent v3
                          plan (text)   result (text)

Browser draft -> shared validation -> API authorization + reference checks
              -> PostgreSQL: current revision + immutable snapshot + audit
              -> reload the exact saved recipe
```

The arrows describe configured data dependencies. They are not running processes. A later execution milestone must validate actual input/output values, permissions, and runtime compatibility again.

## A small example

1. Save a Workspace and two Agents in the selected team.
2. Create a Flow with the input `task`, type `text`, and explicitly select a Workspace revision.
3. Add a stage named Plan, select an Agent revision, bind its `request` input to Flow input `task`, and declare its `plan` output as `text`.
4. Add Build after Plan. Bind its `plan` input to Plan's `plan` output, and its `task` input to Flow input `task`. Declare a `result` output of type `text`.
5. Bind the Flow's final `result` output to Build's `result`. Save and reload.

Port names use lowercase letters, digits, and underscores, starting with a letter. A binding has its own name and type; its source must exist and have that same type. `json` declares structured JSON data for future execution, without an arbitrary expression language or a user-supplied JSON Schema in this increment.

## Why versions are pinned

If Plan uses Agent revision 1 and you later save Agent revision 2, the Flow continues to point to revision 1. The pair of resource ID and immutable version ID is authoritative. Selecting a newer available revision is an explicit Flow edit, which produces a new Flow revision on save. A historical dependency read returns the historical definition, including its historical name.

An inaccessible, missing, wrong-kind, or incompatible dependency cannot be used just because its UUID is known. Server checks remain authoritative even when a browser has stale options. Current sharing is deliberately restricted to the same team; cross-team grants are future work.

## Editing and recovery

Stages have stable identities, so moving one does not rename its references. However, moving a producer below its consumer creates an invalid forward reference. Fix the order or source before saving. Removing or renaming a source does not silently redirect its consumers. Validation identifies broken bindings.

All active team members can read. Admins and developers can save. Failed requests and revision conflicts retain the draft, and unknown stored schemas remain read-only. The [Workspace guide](07-workspaces.md) explains the shared revision/conflict model; the [Agent guide](08-agents.md) explains why no API key is needed for catalog configuration.

[Catalog history](10-catalog-history.md) lets you inspect an earlier Flow and restore it as a new revision. Restore keeps that snapshot's exact dependency pins and checks their current availability before saving.

After pulling this increment, apply its new migration explicitly and start both services:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

Use the existing `.env` and database volume. There is no need to recreate credentials or install a new dependency for Flows.
