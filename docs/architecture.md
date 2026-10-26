# Intended architecture

This is the independent project's design, not a description of an existing private platform. Consult [progress](../notes/progress/README.md) for what has actually been built.

Local V0.1–V0.4 are verified, including durable sessions using a deterministic stub in the [October 25 record](../notes/progress/2026-10-25-01-durable-sessions.md). The broader diagram below includes later repository, artifact, secret, and publication boundaries. The implemented session boundary and partial V0.5 command planner are described below. The [V0.5 contract](../notes/findings/repository-execution.md) is recorded; V0.4 remains the accepted runnable checkpoint.

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

The broader intended session lifecycle also includes preparation and approval waits. V0.4 implements `queued`, `running`, `blocked`, `cancelling`, `cancelled`, `failed`, and `completed`; the last three are terminal. `blocked` retains a concrete reason. Preparation, approval waits, and stage retries belong to later increments.

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

Pinned references live in the Flow's immutable JSON snapshot. API checks establish their integrity; no relational edge table is added in this increment. Archive checks inbound references as described below. Future deletion, transfer, or sharing features must also account for references and reauthorization. Runtime privileges prohibit deleting resources or changing/deleting snapshots; they do not constrain the migration administrator.

The frontend uses ordered cards, explicit port/binding controls, and paginated active-version choices. A saved historical selection remains visible and unchanged; moving to a newer revision requires an explicit selection. Existing catalog recovery handles stale edits, uncertain requests, read-only roles, and unknown schemas. Built-in templates provide unsaved starting definitions as described below. See [Flow findings](../notes/findings/flows.md) and [current progress](../notes/progress/README.md) for verification status. Secret references and execution remain follow-ups; the separate runner health boundary is described below.

## Catalog history and restore boundary

All three catalogs expose paginated revision metadata and complete, separately authorized snapshot reads. Restore copies a supported saved definition into a fresh immutable revision under current write authorization and expected-revision checks. The source version is paired with the authorized owning resource; clients cannot submit replacement fields. Current and historical unsupported definitions remain read-only.

Flow restore revalidates its original dependency pins inside the write transaction. Identity/membership locks, owning-resource lock, dependency checks, new snapshot, current pointer, safe source audit, and concrete response validation commit together. The browser confirms draft replacement and retains drafts on failure. History/restore itself required no migration; archive adds migration 005 and lifecycle checks below. See [history findings](../notes/findings/catalog-history.md) and [progress](../notes/progress/README.md) for checks and limits.

## Catalog archive boundary

Archive is resource lifecycle metadata, separate from immutable definition revisions. Migration 005 adds an archive timestamp and lifecycle counter. All definition and lifecycle mutations require expected definition and lifecycle revisions, so an archive/unarchive cycle invalidates previously opened drafts. Names stay reserved. Default lists show active resources; an explicit archived filter and authorized direct/history reads preserve access to archived records. Archived definitions cannot be edited or restored.

Workspace/Agent archive holds its resource row for update and scans active Flow current definitions in bounded pages. It rejects existing references or incompatible definitions whose references cannot be established. Flow mutations hold dependency share locks and re-read active state; archive never locks inbound Flow rows, preserving lock order. Historical/archived Flow pins remain intact. Unarchive validates the stored definition, and a Flow also revalidates its original active dependency pins. Lifecycle metadata, safe audit, and concrete response validation commit atomically without adding a definition snapshot. Existing table grants suffice; no deletion or execution is introduced. See the [archive contract](../notes/findings/catalog-archive.md) and [progress](../notes/progress/README.md) for acceptance status.

## Implemented built-in template boundary

Templates are read-only examples shipped by the backend and read through current team authorization. Applying one creates an unsaved draft; ordinary catalog creation saves the team's independent copy. Workspace templates contain no repository URL, and Flow templates contain no Workspace/Agent pins. The browser assigns fresh stage IDs, remaps bindings, and requires explicit dependency choices before the existing backend validator accepts a save. Templates introduce no storage entity, seed data, execution, or live relationship with saved copies. This bounds the initial template scope to examples; user-managed template libraries and bundle imports remain separate. See the [template contract](../notes/findings/catalog-templates.md) and [template completion record](../notes/progress/2026-10-13-01-template-completion.md) for acceptance and limits.

## Implemented local runner health boundary

The first V0.3 increment connects a foreground process to a team through one-use enrollment and authenticated heartbeats. It is verified locally; the [October 20 checkpoint](../notes/progress/2026-10-20-01-runner-enrollment.md) records automated and browser acceptance, recovery runs, and limits. The subsequent permission controls below complete local V0.3 acceptance.

Current explicit team admins issue ten-minute enrollment codes and revoke pending or enrolled registrations; all active team members may read non-secret metadata. Issue/revoke use human sessions and held identity/membership locks. Enrollment rechecks the issuer's active team-admin authority. After enrollment, the runner is a team service identity whose access is controlled by explicit runner revocation, independently of the issuer's later login state or role.

Browser-generated enrollment codes and runner-generated credentials use separate bearer realms, bind to one runner UUID, and are stored only as hashes. The browser retains a pending issue request in memory for identical retries; the foreground runner retains its credential in memory and can reconcile a lost enrollment response with an authenticated heartbeat. A process restart requires new enrollment. The CLI accepts loopback HTTP endpoints, refuses redirects, uses finite request timeouts and bounded retries, and cancels pending work on shutdown. It connects only to the API.

Migration 006 adds mutable runner records separately from immutable catalog versions. Enrollment and revocation advance a lifecycle counter; heartbeat writes update only server receipt time. Heartbeat/revoke operations serialize on the same runner row. Health is derived on read: unknown before any heartbeat or after revocation, online for at most 60 seconds since the last heartbeat, then offline. The CLI normally sends heartbeats every 15 seconds. Compute displays registration, health, last heartbeat, and dispatch approval separately and refreshes on request.

The first increment kept dispatch approval false. The subsequent compute-control implementation extends it as described below. See the [runner findings](../notes/findings/runner-enrollment.md) and [runner guide](../notes/learning/13-local-runners.md) for enrollment, health, recovery, and commands.

## Implemented compute permission boundary

Migration 007 adds dispatch approval to the runner and a separate per-user `runner_use_grants` table. Existing runners start unapproved without grants. Composite foreign keys preserve runner/team/organization and recipient membership ownership. Runtime privileges allow SELECT/INSERT/UPDATE on grants, never DELETE. Registration and grants remain mutable operational state outside catalog snapshots.

Current explicit team admins manage approval and grants. Enabling either requires an enrolled, unrevoked runner. Grant recipients must currently be enabled users with active organization and team memberships and an admin/developer team role. Admin and owner status supplies no automatic use permission. Removing approval suspends use without disconnecting heartbeats; runner revocation clears approval and makes all retained grants ineffective. An authorized admin may remove stored grants after the recipient loses eligibility or the runner is revoked. If a recipient later regains eligibility, a retained grant becomes effective again unless an admin removed it.

Actor identity/membership locks, recipient locks when granting, then the runner row serialize mutations. Approval/grant changes share the runner lifecycle counter; exact expected revisions are checked before no-ops, so stale matching requests cannot replay permission after a later change. Current-revision no-ops create no revision or audit. Session wall-clock expiry is rechecked after blocking waits; permission, revision, audit, and validated response commit atomically. Heartbeats never change permission or its revision.

Admins read a paginated roster of eligible candidates and retained grant records; other team members can inspect only their own grant and current use permission. Personal access combines current session/user/membership/role, grant, approval, enrollment, and revocation in a fresh database snapshot. This is an observation, not an execution ticket: it excludes health, compatibility, and capacity. Future admission and claim operations must reauthorize in their own transactions.

Compute loads permission details on demand, confirms the exact runner/member and desired action, and requires refresh after stale or uncertain outcomes. Permission data clears on team/session/access loss. The [compute-control checkpoint](../notes/progress/2026-10-24-01-compute-controls.md) records focused checks, owner/developer browser acceptance, and verified disposable-fixture cleanup. Combined with the runner checkpoint, this completes local V0.3 acceptance; full regression suites were deliberately not repeated for the permission increment. The V0.4 boundary below consumes these permissions without treating a saved permission observation as an execution ticket. See the [compute-control contract](../notes/findings/runner-compute-controls.md) and [guide](../notes/learning/14-compute-controls.md).

## Verified local deterministic session boundary

The [durable session contract](../notes/findings/durable-sessions.md) defines the bounded V0.4 implementation. `packages/contracts/src/sessions.ts` owns strict requests/responses, bounded text/JSON values, and pure typed-binding/stub evaluation. Additive migration 008 stores execution sessions, immutable pinned snapshots and inputs, leases, and append-only event/receipt records. This increment adds no dependencies or external orchestration service, including Temporal. PostgreSQL remains the durable queue and journal.

```text
Sessions draft: explicit Flow version + runner + typed input values
  -> authorized preview: validate and copy definitions; save no session
  -> explicit queue: atomic pinned snapshot + queued session + first event
  -> opted-in foreground runner claims one saved assignment through the API
  -> pure stub resolves declared input bindings and returns deterministic outputs
  -> API reauthorizes and validates outputs before saving progress/events
  -> Sessions reads saved detail and replays the authorized event journal

Separate engine entrypoint -> mark expired work leases uncertain; retain ownership
```

Current team admins/developers with their own explicit runner grant may preview/start supported active Flow versions. The runner must be enrolled, approved, and unrevoked; being offline does not prevent queuing. Start stores the selected Flow definition and its Workspace/Agent definitions with exact version references. Later catalog edits or archival do not change that snapshot. A client-generated creation UUID and the same immutable request permit identical Start replay; a different payload conflicts. Current team members can read session contents; broader resource sharing policies remain V1 work.

The foreground runner keeps machine credentials and lease tokens in memory and connects only through the API. Default startup remains enrollment/heartbeats. `--stub-sessions` explicitly opts in to `stub.v1`, whose stage outputs are validated by the server's same pure evaluator. Agent instructions, model preferences, Workspace actions, and requested capabilities are saved context rather than executed behavior. Session quality remains `not_evaluated`; a completed state establishes completion of the deterministic stub protocol, not tested code or real agent work.

A database partial unique index permits one active or uncertain lease per runner. Each 45-second work lease uses database time and renews after accepted stage progress; registration heartbeats do not renew it. Claim IDs, lease identity/generation/token, worker event IDs, and expected revisions protect replay and concurrent ownership. The original starter's enabled identity, current organization/team memberships, eligible role, and grant are rechecked at claim and ordinary progress/completion. Logging out of the starter's browser alone does not revoke that durable authority. Locks follow actor/recipient identity when needed, then runner, session, and lease.

Queued cancellation is immediate. Active or uncertain cancellation enters `cancelling` while retaining the reservation until the matching runner confirms it has stopped. Expiry records uncertain ownership and blocks ordinary completion; a late result is recovery evidence. If the process or its credential is lost, a current team admin must first revoke the runner in Compute and explicitly confirm the stub has stopped before manual reconciliation releases the reservation as failed/cancelled. A fresh session represents a later run; terminal sessions never reopen.

The web feature lists saved sessions, shows pinned versions, stage progress/outputs, and pages the durable event log. SSE uses session-bound sequence cursors, validates events, deduplicates replay, and closes on terminal state, access loss, or navigation. Every server batch reauthorizes the human reader. Stream errors trigger a fresh detail access check before bounded reconnect attempts; offline failures expose manual controls. A terminal detail read drains bounded HTTP journal pages from the last verified cursor before the UI claims history is up to date; a failed read leaves an explicit refresh state. Uncertain queue responses keep the original request for identical retry and protect the open draft from accidental navigation. The [V0.4 record](../notes/progress/2026-10-25-01-durable-sessions.md) records 130 distinct focused cases across runs, browser acceptance, and exact fixture/service cleanup. Broad suites were not repeated.

Migration 008 supplies durable session storage. `pnpm.cmd dev` starts the API, lease-reconciliation engine, and web; `pnpm.cmd runner:local --stub-sessions` starts a separate opted-in foreground runner. Repository fetching, checkout/path isolation, containers, child processes, commands, provider calls, and publication remain V0.5+ work. The logical lease is not a repository sandbox or a guarantee that arbitrary external processes have stopped.

## Partial repository planning boundary

The [repository execution contract](../notes/findings/repository-execution.md) defines V0.5 preparation, authority, command isolation, renewal, cleanup, and report requirements. Its first slice is the pure `compileRepositoryCommandPlan` helper in `packages/contracts/src/repository-command-plan.ts`; the [planning record](../notes/progress/2026-10-25-02-repository-planning.md) tracks its verification. A separate saved-plan API now wraps that compiler without adding repository work to Sessions. The backend API is verified locally in the [API record](../notes/progress/2026-10-25-03-repository-plan-api.md), including focused checks and cleanup; V0.5 remains incomplete.

The compiler validates an immutable Workspace reference/definition and one explicit `install`, `test`, `lint`, or `build` selection, rejects an empty action, and copies that saved command verbatim. The selection also declares a full 40-hex commit OID and a lowercase `repository@sha256:...` image digest. The image repository must match the saved image's spelling; an already saved digest must match exactly. The plan preserves repository/ref context, Workspace version, selected action/command, lexical working directory, fixed policy/limits, and a derived container directory under `/workspace/repository`.

Its `planned_unverified` status establishes syntax and declared intent only. It does not resolve a branch/tag, confirm a commit exists or matches the saved ref, inspect/trust an image, establish actual path containment, authorize work, enforce sandbox limits, or execute anything. It emits no report or quality verdict. The separate preparation-control API below admits the `repository.v1` protocol and `docker-linux-offline.v1` policy declaration; no real adapter enforces them yet.

`packages/contracts/src/repository-plans.ts` defines strict preview/save/read/list contracts. `RepositoryPlanService` and its routes authorize current team members for preview/read and current admins/developers for Save. The server resolves one active, supported Workspace resource/version in the owning team, then compiles from its immutable definition. Clients submit only the Workspace pin and action/commit/image selection; they cannot replace commands or policy. Planning requires no runner, approval, grant, or capacity reservation.

Migration 009 adds `repository_plans` separately from execution sessions, with creator/tenant/Workspace provenance and composite resource-kind/version ownership. It stores the normalized save request, selected compiled configuration, Workspace name, and SHA-256 plan digest. The original complete Workspace definition remains in its immutable catalog version. Runtime privileges are SELECT/INSERT only, and an immutable-row trigger rejects UPDATE/DELETE. The API never migrates on startup.

Preview writes nothing. Save holds identity/membership locks, serializes the client UUID with a transaction advisory lock, and resolves the Workspace under a shared resource lock. Plan insertion, one safe audit, digest/response validation, and session-expiry checks commit atomically. Concurrent identical saves and lost-response retries return the same saved record without adding audit or resolving a subsequently edited/archived catalog. Changed creator, tenant, or normalized request conflicts. List/detail reads reauthorize separately. SHA-256 covers the UTF-8 bytes of `serializeRepositoryCommandPlan`, whose v1 normalization, explicit field order, and policy/limit semantics are frozen; JSONB key order cannot change the identity.

The [planning](../notes/learning/16-repository-planning.md) and [saved-plan](../notes/learning/17-saved-repository-plans.md) guides explain why persistence supplies no dispatch authority. The new admission/control boundary below consumes saved plans separately. Saved-plan UI and actual repository execution remain future work.

## Repository admission and preparation control

`packages/contracts/src/repository-executions.ts`, `RepositoryExecutionService`, and dedicated routes implement the [preparation-control contract](../notes/findings/repository-execution-control.md). The backend protocol is verified locally in the [control record](../notes/progress/2026-10-26-02-repository-execution-control.md): 79 distinct focused cases, builds/type checks, migration/runtime privileges, and fixture cleanup. This is a partial V0.5 protocol, not real preparation or cleanup evidence.

An admin/developer with their own current compute grant previews/starts one standalone action from a saved plan ID/digest and exact Workspace version. The selected Workspace must be active and supported at new admission. No unrelated Flow/Agent snapshot is created; a future Flow command stage must explicitly bind the matching Workspace pin. Read-only preview creates nothing. Start atomically saves immutable admission, queued state, first lifecycle event, and safe audit. Identical requests replay saved content. Current members may list/read executions and their bounded JSON events; cancellation uses an exact lifecycle revision. Offline queuing is allowed.

Migration 010 adds `repository_executions`, append-only `repository_execution_events`, and token-free `repository_control_receipts`. It extends the existing `session_leases` table with an immutable runtime discriminator and exactly one runtime-appropriate owner. Existing leases default to `stub.v1`; the original unique index still permits only one active or uncertain lease per runner across both runtimes. No second capacity ledger exists. Stub claim/advance/expiry and stub manual recovery exclude repository owners. The engine reconciles each runtime separately. `pnpm.cmd db:prepare` now applies through 011, including the receipt journal below.

The repository bearer claim explicitly declares `repository.v1` and `docker-linux-offline.v1`. This advances compatibility from pending to protocol-declared, without proving sandbox capability. Stable claim UUID/token pairs recover the same assignment; only a token hash is stored. At first claim the server fixes a 900-second run deadline and a preparation deadline bounded by 120 seconds and the run deadline minus a 30-second cleanup reserve. Preparation leases renew for at most 45 seconds within those fixed cutoffs. Queue time consumes neither clock.

Control uses an independent sequence and stable request UUID, leaving ordinary lifecycle revision/event sequencing separate. Exact receipt replay checks current authority, cancellation, expiry, and deadlines but never renews again or adds a duplicate receipt. The response authorizes only `prepare` with a positive bounded duration, after a 250ms safety allowance; otherwise it says `stop`. A later worker must measure that duration from request-start monotonic time. Registration heartbeats do not renew work, and uncertain ownership cannot reactivate.

Jobs include deterministic `ark-repo-LEASE_UUID-g1-prep`, `-command`, and `-workspace` names bound to execution/lease/generation/plan digest. These manifests establish ownership intent only. This slice has no repository command-start, completion, stopped/release, or manual-reconcile operation. Queued cancellation is terminal; held cancellation/expiry retains capacity. There is no actual adapter, repository CLI worker, or UI. Next bind verified preparation/process/cleanup evidence and reports before command execution or release. A Boolean stopped assertion, including the V0.4 admin shortcut, cannot release repository ownership. See the [control guide](../notes/learning/18-repository-execution-control.md).

## Preparation receipt journal

The [receipt contract](../notes/findings/repository-preparation-receipts.md) adds a separate backend journal; its [progress record](../notes/progress/2026-10-27-01-preparation-receipts.md) distinguishes implementation from verification. Migration 011 adds one append-only final receipt per repository lease, composite immutable execution/lease context, token-free canonical request/digest, server provenance, and SELECT/INSERT-only runtime access. `repository-preparation-receipts.ts` validates prepared observations or bounded failure diagnostics against the exact saved plan and deterministic resources. Machine ingestion locks runner -> execution -> lease and checks current bearer plus exact lease ownership. It deliberately performs no work assessment, renewal, lifecycle transition, or capacity release.

Saved evidence always says `runner_reported_unverified`. Exact receipt replay adds no audit, and another final report conflicts. Current team members read the saved receipt or null after fresh authorization/session-expiry checks. Late uploads after work expiry/cancellation or grant/approval loss preserve diagnostics; revoked machine credentials remain invalid. Reported elapsed time and server receipt time never extend fixed deadlines. Matching command-image/source/path/ownership claims are consistency checks, not trusted adapter observations. The command image may differ from the preparation transport image. No raw logs, credentials, arbitrary labels, or quality verdicts are accepted.

Command authorization, process/cleanup receipts, and an actual adapter still require an explicit contract binding observations, concrete resources, fixed deadlines, and verified termination/cleanup. This unverified journal cannot unlock commands or release uncertain ownership. See [guide 19](../notes/learning/19-preparation-receipts.md).
