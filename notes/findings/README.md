# Findings index

Keep facts and decisions in focused files; distinguish verified behavior from intended architecture.

| Topic                                             | Findings                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------ |
| [Codebase and tooling](codebase-and-tooling.md)   | F001 package map; F002 lockfile; F006 strictness/lint; F009 maintained tooling |
| [Database](database.md)                           | F003 port/authentication; F004 role lifecycle; F008 migration/test boundaries  |
| [Publication and Git](publication-and-git.md)     | F005 private research exclusion; F007 commit safety and hooks                  |
| [Identity and security](identity-and-security.md) | API, session/access invariants, evidence and limits                            |
| [Browser verification](browser-verification.md)   | Design direction, disposable fixtures, CLI walkthrough                         |
| [Architecture review](architecture-review.md)     | Module boundaries, render recovery, rollback cleanup, local URL validation     |
| [Workspace catalog](workspaces.md)                | Fields, ownership, immutable snapshots, HTTP contracts, concurrency, and scope |

## Next decisions

1. Define the next bounded V0.2 agent catalog slice, then ordered flows and authorized version references.
2. Decide when to add automated browser regression tests; current browser evidence is a CLI walkthrough.
3. Design invitations, administration, and password recovery before a team-usable release.
4. Select recoverable OS-backed secret storage before real provider credentials.
5. Validate runner/container isolation when that milestone starts; a database container does not prove it.
