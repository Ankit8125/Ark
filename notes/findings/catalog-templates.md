# Built-in catalog templates

Recorded 2026-10-05 (Asia/Kolkata). [Findings index](README.md)

Acceptance and current limits are recorded in the [October 13 completion entry](../progress/2026-10-13-01-template-completion.md). The original contract and acceptance cases below were established before implementation.

## Contract before implementation

The first template increment provides original examples shipped by the backend. Templates are read-only application content; they have no owning team, resource ID, history, or archive state. An authenticated team member reads templates through that team's API boundary. Applying one copies its values into a new unsaved editor draft. Only the ordinary authorized catalog create request saves a resource owned by the selected team.

- `GET /api/teams/:teamId/templates/:kind`, with singular `workspace`, `agent`, or `flow`, returns a bounded typed list. Parameters and the empty query are strict. Every request checks current session and explicit team membership. There are no template write endpoints.
- Each template has a stable slug ID, template version, schema version 1, kind, title, description, and typed definition. The template version describes the shipped example; it is not a saved resource revision or a live link from copies.
- Workspace templates omit the repository URL. The draft requires the user to supply it. Agent templates retain the stub runtime and inert capabilities/model preference. Flow templates omit the Workspace pin and each stage's Agent pin. They contain typed ports, ordered stages, and validated bindings.
- The browser gives copied Flow stages fresh IDs and remaps every stage-output reference. Dependency pickers begin empty and require explicit choices. The existing create transaction revalidates current membership, kind/team/version pairs, active dependencies, and pinned definitions.
- Applying a template is available only for a new, writable editor. It replaces a dirty draft only after confirmation. Fetching templates never replaces a draft. Loading failures are recoverable without losing manual edits; stale responses after team/route changes are ignored.
- Applying or retrying a template does not change the editor's creation ID. A lost create response remains subject to the existing same-ID replay/conflict recovery, preventing a second resource from being created silently.
- A saved copy has its own name, resource/version identity, revisions, and lifecycle. Later edits or changes to shipped templates never modify it. Existing duplicate-name rules and immutable history remain authoritative.

No storage migration, new grant, dependency, provisioning, repository access, command execution, or model call is needed. User-managed templates, importing/exporting bundles, and creating dependencies automatically are separate scope. No template provenance field is claimed or stored in this increment.

## Acceptance

Contract tests must reject unknown fields, invalid graph bindings, embedded Flow dependency pins, and malformed template envelopes. API tests must verify authenticated membership reads, kind filtering, no read-side database writes, unchanged builtins after saved-copy edits, ordinary creation replay, and current Flow dependency rejection. Browser/DOM checks cover all three template drafts, explicit repository/dependency completion, save/reload fidelity, fresh stage IDs and remapped references, dirty cancel/confirm, offline retry, read-only/saved-editor boundaries, and late response cancellation. Existing catalog regression suites remain required.
