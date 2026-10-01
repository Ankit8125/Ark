# Workspaces: save configuration before execution

[Learning index](README.md) · [Current progress](../progress/README.md)

A workspace describes which repository, source ref, environment image, directory, and commands a team intends to use. Saving it stores configuration in PostgreSQL. It does not clone the repository, pull an image, run a command, or call a model.

## Start the updated project

From `D:\Coding\ONGOING\ark`, with Docker Desktop running:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

`db:prepare` checks previous migration checksums, applies any new migrations, and gives the runtime role its required table privileges. It preserves accounts, saved workspaces, and the Docker volume. Run it when a pull introduces migrations; the API deliberately does not migrate on startup. Keep the existing ignored `.env`. Database connections still use loopback port 5434.

Open the Vite URL printed in the terminal. Complete setup if this is your first use, otherwise sign in. Select your team, open **Workspaces**, and choose **New workspace**. Team admins and developers can save; reviewers and viewers can read saved configuration.

## Example configuration

| Field             | Example                                | Meaning                                                           |
| ----------------- | -------------------------------------- | ----------------------------------------------------------------- |
| Name              | Ark development                        | Unique within the selected team, ignoring case                    |
| Description       | Local application development          | Optional human explanation                                        |
| Repository URL    | `https://github.com/Ankit8125/Ark.git` | HTTPS repository location without credentials or query parameters |
| Source revision   | `main`                                 | Branch, tag, or commit to check out in a future execution         |
| Default branch    | `main`                                 | Intended default/PR base branch; separate from the source ref     |
| Container image   | `node:24`                              | Intended container image reference                                |
| Working directory | `.`                                    | Repository root; `apps/web` would mean a relative subdirectory    |
| Install           | `pnpm install --frozen-lockfile`       | Command text stored for later execution design                    |
| Test              | `pnpm test:unit`                       | An example test action                                            |
| Lint              | `pnpm lint`                            | An example lint action                                            |
| Build             | `pnpm build`                           | An example build action                                           |

The examples describe configuration, not a verified runner environment. In particular, choosing an image does not prove that pnpm or your other tools exist in it. Actions may be empty. Their spaces and line breaks are preserved. Do not paste passwords, tokens, private keys, or credential-bearing command strings into these fields; secret storage and secret references are a later increment.

The form validates required values, lengths, repository URLs, refs, and relative paths. The server independently validates the same contract. A syntactically valid repository URL is not proof that the repository exists or that a future runner can access it.

## Follow a save

```text
Workspace form
    -> shared request schema
    -> API: session + explicit team membership + write role
    -> one database transaction
         resource current revision
         immutable configuration snapshot
         audit event (workspace ID and revision)
    -> saved revision returned to the form
```

Creation starts at revision 1. Editing and saving creates revision 2 and retains revision 1. Reloading the page reads the saved configuration from the API. The workspace URL keeps the selected record; the selected team remains separately checked by the server.

Two people can open revision 1. If the first person saves revision 2, the second person's revision-1 save receives a conflict. Their draft stays in the form until they explicitly load the latest saved version or leave. This avoids silently overwriting the first person's changes. There is no automatic merge or version-history screen yet.

Network failures also retain the draft. Creation uses a stable request ID so retrying the identical request does not create another record. If the previous result is uncertain and the draft has changed, the form offers an explicit recovery choice. Updates require the saved revision; an uncertain update is reconciled by loading the latest record, never by blindly repeating a write.

Leaving a dirty form prompts before discarding input. Drafts exist only in the open browser page; they are not autosaved or stored in local storage. An expired session, browser crash, or forced reload can still lose unsaved work. A stored schema that this app cannot understand is shown read-only so a save cannot silently discard its fields.

## Scope and verification

This is the workspace portion of V0.2. The [Agent increment](08-agents.md) adds instruction/preference configuration; verified [Flows](09-flows.md) pin these definitions into an ordered recipe. History browsing/restore, deletion/archive, secret references, and session execution remain future work. See the [workspace findings](../findings/workspaces.md) for the API/storage contract and the [implementation record](../progress/2026-09-27-01-workspaces.md) for the original checks and limits.
