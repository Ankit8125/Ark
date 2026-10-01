# Agents: save instructions and preferences

[Learning index](README.md) · [Current progress](../progress/README.md)

An Agent is a team-owned definition describing what a future worker should do. Its instructions, runtime, optional model preference, and capabilities are saved together. This increment adds configuration editing; it does not execute instructions or call a model.

## Start and create an Agent

From `D:\Coding\ONGOING\ark`, with Docker Desktop running:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

The new migration is `003_agents.sql`. The preparation command checks earlier migrations, preserves existing records and the Docker volume, and applies missing migrations. Keep your existing ignored `.env`; no additional installation or provider credential is needed.

Open the Vite URL, sign in or complete first-owner setup, select your team, then open **Agents** and choose **New agent**. Admins and developers can save. Reviewers and viewers can read.

## Example: a review Agent

| Field            | Example                                                                          | Meaning                                                                      |
| ---------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Name             | Code reviewer                                                                    | Unique among Agents in the selected team, ignoring case                      |
| Description      | Review a proposed change                                                         | Optional explanation for teammates                                           |
| Instructions     | Review the change for correctness. Explain each finding with a concrete example. | Required text, up to 16,000 characters; spaces and line breaks are preserved |
| Runtime          | Stub (planned)                                                                   | The only supported catalog runtime choice at this checkpoint                 |
| Model preference | Leave empty                                                                      | Optional identifier stored for future use; the stub does not use a model     |
| Capabilities     | Read files                                                                       | Saved capability preferences; they do not grant access or run tools          |

The other capability choices are **Edit files** and **Run commands**. A new Agent starts with none selected. Future execution must separately check the runtime's capabilities, team permissions, and applicable grants. A saved checkbox cannot authorize itself.

Model preference is optional. A value such as `provider/model-id` is an opaque example, not a recommendation or a verified model. Saving does not check that it exists. Do not put keys, passwords, or tokens in any catalog field; secret storage is a separate planned feature.

## Follow a save and edit

```text
Agent form
    -> shared schema validates the complete definition
    -> API checks session, team membership, and write role
    -> transaction stores current revision + immutable snapshot + audit
    -> form receives the saved revision
```

The first save creates revision 1. A later edit creates revision 2 while preserving revision 1. Reload reads the saved definition, including every supported field. A Workspace and an Agent may have the same name because they are different resource kinds.

If two editors open revision 1 and one saves first, the second save receives a conflict and retains its draft. Loading the latest version explicitly discards that unsaved draft. Network errors also retain drafts; retrying an identical creation uses its original ID. An uncertain update must be reconciled with the current saved version. Writes are never automatically retried.

Leaving with unsaved changes asks before discarding. Drafts remain only in the open page; a browser crash or expired session can still lose them. Unknown stored schema versions are read-only. There is no history/restore screen yet.

## Where this fits

Workspaces describe repository and environment configuration. Agents describe instructions and preferences. The verified [Flow editor](09-flows.md) refers to authorized, immutable Workspace and Agent versions. Changing an Agent creates a new version and does not advance existing Flow pins. Session execution, runners, and real model adapters belong to later milestones. See [Agent findings](../findings/agents.md) for the storage/security contract and [progress](../progress/README.md) for verified checks.
