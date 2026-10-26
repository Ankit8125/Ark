# Current progress

Updated 2026-10-26 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**V0.5 repository admission and preparation control verified locally.** The [October 26 preparation-control entry](2026-10-26-02-repository-execution-control.md) records exact saved-plan/Workspace binding, current compute authorization, standalone queued executions, shared runner ownership, preparation-only claim/control, cancellation/expiry, 79 focused cases, populated upgrade coverage, restricted privileges, and cleanup. There is no repository command-start/completion/release endpoint, worker adapter, or UI yet; V0.5 is incomplete.

The [saved-plan completion entry](2026-10-26-01-repository-plan-api-verification.md) and [implementation](2026-10-25-03-repository-plan-api.md) preserve immutable storage, authorized preview/Save/list/get, frozen digests, atomic replay/audit, and 36 earlier focused cases. Saved `planned_unverified` plans remain non-dispatchable until separately admitted and need no runner for planning.

The [shared planning entry](2026-10-25-02-repository-planning.md) preserves the original contract/compiler and 18 earlier focused cases.

**Verified locally: V0.4 durable deterministic-stub sessions.** The [October 25 checkpoint](2026-10-25-01-durable-sessions.md) records pinned sessions, deterministic runner work, durable events, cancellation/recovery, 130 distinct focused cases, browser checks, exact fixture/service cleanup, and staged review. Full regression suites were deliberately skipped. Repository commands and models remain later work.

**Earlier accepted baseline: V0.1 identity, V0.2 catalogs, and V0.3 local runner enrollment plus compute controls.** The [October 24 checkpoint](2026-10-24-01-compute-controls.md) records dispatch approval, explicit member grants, 25 passed integration checks, 80 passed Compute DOM/API cases, focused schema/build/lint/type checks, browser acceptance, and verified fixture cleanup.

The [previous runner checkpoint](2026-10-20-01-runner-enrollment.md) preserves the broader baseline: 166 integration tests, 281 distinct unit/DOM cases across recovery runs, build/lint/type/guard checks, browser/foreground-runner acceptance, and fixture cleanup. The [template completion record](2026-10-13-01-template-completion.md) preserves the catalog checkpoint.

| Area              | Evidence                                                                                                                                              |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–010; restricted ark_app, immutable plans/admission, append-only events/controls, global active/uncertain runner leases                 |
| Development setup | Zero identity/catalog/runner/session/repository records at the October 26 check; first-owner setup remains available                                  |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                                                                         |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard                                             |
| Automated tests   | Latest slice: 14 schema, 32 repository control, 32 existing stub, and 1 populated-upgrade case passed; earlier evidence retained in dated records     |
| UI                | Sessions lost-response replay, finite SSE, restart persistence, cancellation, natural expiry/admin recovery, reload, and desktop/mobile checks passed |
| Tooling           | Production build, lint, and strict type checks passed                                                                                                 |
| Scope             | Loopback development; runnable pure stub plus repository planning/admission/preparation controls; real repository commands and models remain future   |

The [latest runner record](2026-10-20-01-runner-enrollment.md) distinguishes completed checks, recovery runs, limits, and verified QA cleanup. The [runner guide](../learning/13-local-runners.md) explains enrollment, health, revocation, and commands. The [template](../learning/12-catalog-templates.md), [archive](../learning/11-catalog-archive.md), [history](../learning/10-catalog-history.md), [Flow](../learning/09-flows.md), [Agent](../learning/08-agents.md), and [Workspace](../learning/07-workspaces.md) guides cover catalog behavior. The [architecture guide](../learning/06-project-architecture.md) maps implemented modules and boundaries.

The [tooling verification](2026-09-26-04-supported-react-tooling.md) confirms Vite rather than Create React App and records the requirement to avoid deprecated/end-of-life technology. The catalog increments add no dependencies.

The original V0.1 browser verification used separate test ports and a separate database because port 5173 was occupied at that time. If `pnpm.cmd dev` reports that port busy, stop the older development terminal first.

## Change log

| Date / step     | Record                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| 2026-09-25 / 01 | [Bootstrap and initial GitHub sync](2026-09-25-01-bootstrap.md)                                |
| 2026-09-25 / 02 | [Organize notes](2026-09-25-02-notes-organization.md)                                          |
| 2026-09-26 / 01 | [Identity foundation and verification](2026-09-26-01-identity-foundation.md)                   |
| 2026-09-26 / 02 | [Verified identity checkpoint on GitHub](2026-09-26-02-identity-sync.md)                       |
| 2026-09-26 / 03 | [Architecture review and focused hardening](2026-09-26-03-architecture-review.md)              |
| 2026-09-26 / 04 | [React tooling and maintenance policy](2026-09-26-04-supported-react-tooling.md)               |
| 2026-09-27 / 01 | [Team-owned workspace catalog](2026-09-27-01-workspaces.md)                                    |
| 2026-09-27 / 02 | [Team-owned Agent catalog](2026-09-27-02-agents.md)                                            |
| 2026-09-28 / 01 | [Ordered Flow implementation](2026-09-28-01-flows.md)                                          |
| 2026-09-30 / 01 | [Flow verification checkpoint and remaining work](2026-09-30-01-flow-verification.md)          |
| 2026-10-01 / 01 | [Flow acceptance completed](2026-10-01-01-flow-completion.md)                                  |
| 2026-10-02 / 01 | [History/restore implementation and verification checkpoint](2026-10-02-01-catalog-history.md) |
| 2026-10-03 / 01 | [Catalog archive and unarchive](2026-10-03-01-catalog-archive.md)                              |
| 2026-10-04 / 01 | [Archive acceptance completed](2026-10-04-01-archive-completion.md)                            |
| 2026-10-05 / 01 | [Built-in template contract and implementation checkpoint](2026-10-05-01-catalog-templates.md) |
| 2026-10-13 / 01 | [Template acceptance and V0.2 catalog completion](2026-10-13-01-template-completion.md)        |
| 2026-10-20 / 01 | [Runner implementation and verification checkpoint](2026-10-20-01-runner-enrollment.md)        |
| 2026-10-20 / 02 | [GitHub synchronization](2026-10-20-02-github-sync.md)                                         |
| 2026-10-20 / 03 | [Dispatch approval and compute grants](2026-10-20-03-compute-controls.md)                      |
| 2026-10-24 / 01 | [Compute-control verification](2026-10-24-01-compute-controls.md)                              |
| 2026-10-25 / 01 | [Durable deterministic-stub sessions](2026-10-25-01-durable-sessions.md)                       |
| 2026-10-25 / 02 | [Repository contract and shared command planning](2026-10-25-02-repository-planning.md)        |
| 2026-10-25 / 03 | [Immutable saved-plan API](2026-10-25-03-repository-plan-api.md)                               |
| 2026-10-26 / 01 | [Saved-plan API completion](2026-10-26-01-repository-plan-api-verification.md)                 |
| 2026-10-26 / 02 | [Repository admission and preparation control](2026-10-26-02-repository-execution-control.md)  |

## Synchronization

At the user's request, archive `b1554c6`, templates `37571f5`, and runner `725b446` were pushed to `origin/main` on October 20. Remote and local HEAD were verified equal at `725b446173285ce2ae7948fd727e0f5e0360857c`. See the [synchronization record](2026-10-20-02-github-sync.md); this documentation follow-up records the publication. No deployment was performed.

## Next bounded step

Define preparation/process/cleanup receipts and trusted observation binding under the [preparation-control contract](../findings/repository-execution-control.md) before connecting a real runner adapter. Require exact plan/lease/generation and observed process/resource cleanup before command authorization or capacity release. Keep declared source/image pins separate from observations and process status separate from quality. The [V0.4 checkpoint](2026-10-25-01-durable-sessions.md) remains the runnable baseline; use focused checks without repeated broad suites.
