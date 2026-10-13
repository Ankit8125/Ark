# Built-in catalog templates

Recorded 2026-10-05 (Asia/Kolkata). [Current progress](README.md) · [Previous checkpoint](2026-10-04-01-archive-completion.md)

Historical implementation checkpoint. Acceptance was completed in the [October 13 record](2026-10-13-01-template-completion.md); the pending statements below describe this earlier checkpoint.

## Purpose and data flow

Add backend-provided examples that fill new Workspace, Agent, and Flow drafts. Read-only templates are copied into the browser; explicit Save creates ordinary team-owned immutable configuration through the existing API. Workspace copies require a repository URL, and Flow copies require explicit Workspace/Agent pins. No execution or API key is needed.

The [template contract](../findings/catalog-templates.md) records ownership, editable-copy behavior, recovery, and acceptance before implementation. Shared schemas come first; existing resource tables and create transactions suffice, so this increment requires no migration.

## Work in progress

Implement shared template schemas, authenticated read routes and original builtins, then new-editor template controls and focused tests. Complete automated regression checks, disposable browser acceptance, cleanup, and review before marking this feature accepted.

## Git and next step

Base: local archive commit `b1554c6`. Archive and this increment have not been pushed. Finish this bounded feature before starting runner enrollment. Real model testing belongs to the later runtime adapter milestone; request credentials when that integration is ready for an authorized test.
