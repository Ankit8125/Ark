# Current progress

Updated 2026-10-25 (Asia/Kolkata). Keep this page concise; detailed evidence belongs in dated records.

## Current checkpoint

**V0.5 started: contract and shared command planning.** The [second October 25 entry](2026-10-25-02-repository-planning.md) records the [repository contract](../findings/repository-execution.md), pure `planned_unverified` compiler, 18 passed focused cases, and shared build/type/lint checks. Storage, API, runner, and UI integration remain future work; V0.5 is incomplete.

**Verified locally: V0.4 durable deterministic-stub sessions.** The [October 25 checkpoint](2026-10-25-01-durable-sessions.md) records pinned sessions, deterministic runner work, durable events, cancellation/recovery, 130 distinct focused cases, browser checks, exact fixture/service cleanup, and staged review. Full regression suites were deliberately skipped. Repository commands and models remain later work.

**Earlier accepted baseline: V0.1 identity, V0.2 catalogs, and V0.3 local runner enrollment plus compute controls.** The [October 24 checkpoint](2026-10-24-01-compute-controls.md) records dispatch approval, explicit member grants, 25 passed integration checks, 80 passed Compute DOM/API cases, focused schema/build/lint/type checks, browser acceptance, and verified fixture cleanup.

The [previous runner checkpoint](2026-10-20-01-runner-enrollment.md) preserves the broader baseline: 166 integration tests, 281 distinct unit/DOM cases across recovery runs, build/lint/type/guard checks, browser/foreground-runner acceptance, and fixture cleanup. The [template completion record](2026-10-13-01-template-completion.md) preserves the catalog checkpoint.

| Area              | Evidence                                                                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Database          | Migrations 001–008; restricted ark_app, append-only events, exclusive active/uncertain runner leases                                                      |
| Development setup | Zero users/catalog/runner/session records at the October 25 read-only check; first-owner setup remains available                                          |
| Identity          | One-use atomic bootstrap, Argon2id, hashed opaque sessions, revocation checks                                                                             |
| Authorization     | Explicit membership, admin/developer catalog writes, kind/team isolation, locked checks, last-owner guard                                                 |
| Automated tests   | Latest increment: 32 integration, 35 Sessions DOM, 56 runner, and 7 contract cases passed across focused runs; earlier evidence retained in dated records |
| UI                | Sessions lost-response replay, finite SSE, restart persistence, cancellation, natural expiry/admin recovery, reload, and desktop/mobile checks passed     |
| Tooling           | Production build, lint, and strict type checks passed                                                                                                     |
| Scope             | Loopback development; pure stub orchestration with quality not_evaluated; repository/model work remains future                                            |

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

## Synchronization

At the user's request, archive `b1554c6`, templates `37571f5`, and runner `725b446` were pushed to `origin/main` on October 20. Remote and local HEAD were verified equal at `725b446173285ce2ae7948fd727e0f5e0360857c`. See the [synchronization record](2026-10-20-02-github-sync.md); this documentation follow-up records the publication. No deployment was performed.

## Next bounded step

Add immutable repository-plan storage and authorized preview/admission/work-control under the [V0.5 contract](../findings/repository-execution.md) before connecting an opted-in real runner adapter. The [planning slice](2026-10-25-02-repository-planning.md) preserves the shared boundary; the [V0.4 checkpoint](2026-10-25-01-durable-sessions.md) remains the accepted runnable baseline. Keep source/image declarations separate from observed identities and process status separate from quality. The user requested focused verification without repeated long suites.
