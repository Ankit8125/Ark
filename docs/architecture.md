# Intended architecture

This is the independent project's design, not a description of an existing private platform. Consult [progress](../notes/progress/README.md) for what has actually been built.

## Product and boundaries

A self-hosted organization can have multiple teams, admins, developers, reviewers, and viewers. A solo developer can build and test those roles with separate local accounts. Changing a UI view never grants authority.

```text
Browser / future CLI and MCP clients
                  |
         API + identity + authorization
                  |
         Shared application services
           /           |             \
 PostgreSQL      Artifact storage    Secret storage
 catalog/jobs    immutable evidence  scoped references
 events/audit
      |
 Durable workflow engine
      |
 Job claim/lease API <--- outbound authenticated runner
                                    |
                         Per-session isolated workspace
                                    |
                           Runtime + typed actions
                                    |
                         Code / tests / review evidence
```

Use a TypeScript modular monolith with separate API, engine, and runner entrypoints as needed. PostgreSQL is the authoritative control-plane store and durable job queue. The runner connects to APIs, never directly to the database. Large immutable artifacts live behind an ArtifactStore interface; secret values live separately from ordinary catalog/event records.

Planned stack: Node 24, pnpm workspaces, React/Vite, Fastify 5, Zod 4, PostgreSQL 17 with `pg` and checked-in SQL migrations, HTTP commands plus SSE events, a deterministic stub runtime before one authorized API-key agent adapter. Actual installed frontend tooling is recorded in findings. Redis, orchestration services, cloud hosting, and multiple providers are not initial prerequisites.

## Domain vocabulary

| Concept       | Meaning                                                                         |
| ------------- | ------------------------------------------------------------------------------- |
| Workspace     | Team-owned repository/environment/action configuration                          |
| Compute       | An enrolled execution host with health, grants, capacity, and dispatch approval |
| Agent         | Versioned instructions, runtime/model preference, and allowed capabilities      |
| Flow          | Reusable typed stage definitions and transitions                                |
| Session       | One execution pinned to immutable resource versions                             |
| Stage attempt | One execution of a stage; retries create new attempts                           |
| Artifact      | Immutable output with producer, input ancestry, checksum, and relevant revision |
| Approval      | A person's decision about one exact proposal and evidence set                   |

## Delivery and evidence

```text
Task -> plan -> human plan approval -> implementation -> local checkpoint
   -> actual tests/lint/build -> fresh read-only review
   -> exact-revision publication approval -> controlled push + draft PR
   -> re-read forge destination/head/base/draft -> completed
```

Start with sequential stages and a maximum of two quality-repair cycles, separate from bounded infrastructure retries. A stage process can succeed while its quality verdict requests rework. Agent prose, an unrun test, no tests discovered, a CI trigger receipt, and an unverified URL are not proof of success.

Source revision, working branch, candidate commit, and PR base are distinct fields. New code invalidates downstream tests/review/publication approval without deleting historical evidence. Scope changes beyond an approved plan require a new plan decision.

## Canonical execution invariants to implement

- Validation previews schemas/references/current authorization only. It must not create jobs, clone repositories, run commands, retrieve secret values, or call models. Explicit Start creates an authorized snapshot and queued work atomically.
- Checkout ownership is unique across active AND uncertain leases. A timeout retains ownership until process termination and in-flight effects are reconciled. A new attempt identifier cannot bypass checkout ownership.
- Normal completion requires a current active unexpired lease, matching generation, validated evidence, and confirmed process completion. Late results are recovery evidence, not an ordinary success path.
- Cancel idle/approval-waiting work immediately. Active or uncertain work enters cancelling until termination/effects are reconciled. Cancellation does not undo a branch already pushed.
- Terminal sessions never reopen in place; a fresh linked session represents a later run.
- Persist protected-effect intent before execution. Lost push/PR responses require inspection and reconciliation before retry. Verify the destination and exact approved commit.
- Human/API mutations use idempotency and revision checks. Reauthorization applies to reads, streams, downloads, dependency resolution, dispatch, and protected effects.

Planned session states: `queued`, `preparing`, `running`, `waiting_approval`, `blocked`, `cancelling`, `cancelled`, `failed`, `completed`. The last three are terminal. `blocked` retains a concrete reason; uncertainty is never hidden as completion.

## Team, cost, and security contracts

Resources belong to explicit teams. Sharing a flow does not share referenced credentials, dependencies, or session artifacts. Admin operational visibility does not automatically imply unrestricted private-content access. Team policy can narrow organization policy, not expand it.

Registered, online, dispatch-approved, unrevoked, compatible, authorized, and available compute are distinct conditions. A worktree is not a security sandbox. Begin with trusted repositories and controlled per-session containers when execution is introduced.

Keep estimated, provider-reported, settled, and unknown usage distinct. Use admission reservations, finite deadlines, turn limits, and clear partial outcomes. Unknown cost is not zero, and in-flight estimates are not a guaranteed invoice ceiling.

## Development contract

Implement shared schema -> migration -> API/tests -> frontend form in each feature increment. Backend records are authoritative; forms preserve supported fields on save/reload, handle stale revision conflicts, and treat unknown schema versions as read-only. V0.1 must include team-aware foundations rather than postponing authorization to a later security retrofit.

## Implemented identity boundary

The local API uses opaque 256-bit session tokens in HttpOnly, SameSite=Strict cookies, stores only their SHA-256 hashes, and checks expiry, disabled users, and revoked organization memberships. Passwords use Argon2id. Team access requires an active explicit team membership, including for an organization owner. Database triggers prevent removing or disabling the last active owner. One-time setup locks a seeded bootstrap row and commits organization, owner, team, membership, session, and audit records atomically.

The runtime role is distinct from the administrative migration connection. Migrations are explicit and checksum-verified. The current runtime has scoped table privileges, including insert/read-only audit access; this is not row-level security or an untrusted SQL execution sandbox. The API runs on loopback with exact Host/Origin allowlists and rejects non-JSON mutations. Deployment over a network, invitations, password recovery, membership-management endpoints, session pruning, and a full audit UI remain future work.

The [project architecture guide](../notes/learning/06-project-architecture.md) maps implemented files to these boundaries and explains growth without speculative layers. Root render recovery and sanitized reporting cover unexpected UI rendering failures; expected request failures remain part of the form/API flow. Maintenance/test URL validation and transaction cleanup are infrastructure safeguards. These refinements preserve the existing identity and authorization contracts.

## Implemented workspace boundary

The first V0.2 increment adds team-owned workspace configuration. All active team members can read; admins/developers can create/edit. Repository URL, source ref, default branch, sandbox image, relative directory, and install/test/lint/build actions are stored together as a complete versioned definition. Saving performs no execution or external repository access.

Resources point to immutable snapshots through a deferred current-version foreign key. Resource changes, snapshots, and audit events commit together. Expected revisions prevent lost updates, client-generated creation IDs permit identical request replay, and case-insensitive names are unique within a team. Write authorization holds relevant identity/membership locks for the transaction; it does not rely on the browser's displayed role.

The web workspace feature owns its field layout and request adapter. React Router's data router enables navigation blocking for dirty forms. Failed saves preserve drafts; unknown stored schemas remain read-only. See [workspace findings](../notes/findings/workspaces.md) for request bounds, pagination, compatibility, and remaining limitations.

## Implemented Agent and shared catalog boundary

The second V0.2 increment adds team-owned Agent definitions: instructions, a `stub` runtime choice, nullable model preference, and requested file/command capabilities. Saving only records configuration; these fields neither grant authority nor invoke an executor. Real runtime/provider compatibility and effective permissions belong to execution milestones.

Migration 003 expands the existing resource kinds without rewriting earlier migrations. Kind joins organization/team/ID as a required lookup boundary. Workspace and Agent names are unique within their own kind. Both concrete services use a small internal versioned-catalog implementation for transaction, authorization, revision, audit, and replay behavior. Explicit feature contracts and HTTP modules keep domain decisions visible.

The browser shares list loading, editor recovery, and navigation protection while each feature keeps its own fields and API adapter. The Agent increment introduced this extraction with two actual consumers to avoid duplicated concurrency/security behavior. No new library, generic form engine, or replacement architecture was introduced. See [Agent findings](../notes/findings/agents.md) for bounds and constraints.

## Ordered Flow boundary

The third V0.2 increment adds a sequential recipe: one pinned Workspace version, named text/JSON input ports, up to 20 Agent stages, and final output bindings. Each stage pins an Agent version and consumes Flow inputs or earlier stage outputs with matching types. Stable stage IDs preserve references when the order changes; invalid forward/dangling bindings must be corrected before saving. This schema records declarations without executing instructions or arbitrary expressions.

Flow saves reuse the catalog transaction and add a narrow dependency validator. It verifies resource/version pairs, expected kinds, same-team/organization ownership, and supported pinned definitions while holding identity/membership and dependency resource locks. Snapshots and audits remain atomic. Historical Workspace/Agent reads are separately authorized and expose the selected immutable definition rather than the current resource's metadata. Changing a dependency's current revision never changes an existing pin.

Pinned references live in the Flow's immutable JSON snapshot. API checks establish their integrity; no relational edge table is added in this increment. A future archive, deletion, transfer, or sharing feature must explicitly account for inbound references and reauthorization. Runtime privileges prohibit deleting resources or changing/deleting snapshots; they do not constrain the migration administrator.

The frontend uses ordered cards, explicit port/binding controls, and paginated current-version choices. A saved historical selection remains visible and unchanged; moving to a newer revision requires an explicit selection. Existing catalog recovery handles stale edits, uncertain requests, read-only roles, and unknown schemas. See [Flow findings](../notes/findings/flows.md) and [current progress](../notes/progress/README.md) for verification status. Archive, templates, secret references, and runners remain follow-ups.

## Catalog history and restore boundary

All three catalogs expose paginated revision metadata and complete, separately authorized snapshot reads. Restore copies a supported saved definition into a fresh immutable revision under current write authorization and expected-revision checks. The source version is paired with the authorized owning resource; clients cannot submit replacement fields. Current and historical unsupported definitions remain read-only.

Flow restore revalidates its original dependency pins inside the write transaction. Identity/membership locks, owning-resource lock, dependency checks, new snapshot, current pointer, safe source audit, and concrete response validation commit together. The browser confirms draft replacement and retains drafts on failure. Existing storage and grants suffice; no migration is required. See [history findings](../notes/findings/catalog-history.md) and [progress](../notes/progress/README.md) for checks and limits.
