# Findings index

Keep facts and decisions in focused files; distinguish verified behavior from intended architecture.

| Topic                                             | Findings                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Codebase and tooling](codebase-and-tooling.md)   | F001 package map; F002 lockfile; F006 strictness/lint; F009 maintained tooling            |
| [Database](database.md)                           | F003 port/authentication; F004 role lifecycle; F008 migration/test boundaries             |
| [Publication and Git](publication-and-git.md)     | F005 private research exclusion; F007 commit safety and hooks                             |
| [Identity and security](identity-and-security.md) | API, session/access invariants, evidence and limits                                       |
| [Browser verification](browser-verification.md)   | Design direction, disposable fixtures, CLI walkthrough                                    |
| [Architecture review](architecture-review.md)     | Module boundaries, render recovery, rollback cleanup, local URL validation                |
| [Workspace catalog](workspaces.md)                | Fields, ownership, immutable snapshots, HTTP contracts, concurrency, and scope            |
| [Agent catalog](agents.md)                        | Stub configuration, kind isolation, shared versioning, text bounds, and scope             |
| [Ordered Flows](flows.md)                         | Stage/port contract, pinned dependency boundaries, and acceptance limits                  |
| [Catalog history](catalog-history.md)             | History pagination, fresh restore revisions, source audit, and current dependency checks  |
| [Catalog archive](catalog-archive.md)             | Lifecycle counters, visibility, inbound Flow checks, and acceptance contract              |
| [Catalog templates](catalog-templates.md)         | Authenticated built-ins, independent drafts, explicit pins, and recovery contract         |
| [Local runners](runner-enrollment.md)             | One-use enrollment, machine credentials, derived health, revocation, and acceptance scope |

## Next decisions

The [built-in template contract](catalog-templates.md) defines the completed V0.2 example-copy boundary. Acceptance and limits are recorded in the [template completion entry](../progress/2026-10-13-01-template-completion.md).

The first V0.3 runner increment is verified locally. The [runner checkpoint](../progress/2026-10-20-01-runner-enrollment.md) records actual evidence, recovery runs, cleanup, and limits; V0.3 is not complete.

1. Define dispatch approval and explicit compute grants before implementation. Keep registration, health, approval, grants, compatibility, and capacity distinct; execution belongs to later increments.
2. Decide when to add automated browser regression tests; current browser evidence is a CLI walkthrough.
3. Design invitations, administration, and password recovery before a team-usable release.
4. Select recoverable OS-backed secret storage before real provider credentials.
5. Validate runner/container isolation when that milestone starts; a database container does not prove it.
