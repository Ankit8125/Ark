# Findings index

Keep durable facts and decisions in focused topic files. Update the relevant topic when evidence changes and record the change in the progress log. Distinguish verified behavior from planned architecture.

| Topic | Findings |
| --- | --- |
| [Codebase and tooling](codebase-and-tooling.md) | F001 starter boundary; F002 resolved versions; F006 plan/tooling deviations |
| [Database](database.md) | F003 port mapping and check limits; F004 credentials and volume lifecycle |
| [Publication and Git](publication-and-git.md) | F005 private research exclusion; F007 commit safety and hooks |

## Open decisions for the next implementation increment

1. Implement identity/API schemas and migrations before product UI features.
2. Make TypeScript strictness explicit and choose the lint configuration deliberately.
3. Choose the local application and migration database-role split.
4. Add the actual Vitest/PostgreSQL/Playwright suites for the identity slice.
5. Select the recoverable OS-backed secret-store implementation before real provider credentials.
6. Validate runner/container isolation when that milestone starts; it is not proven by current Docker availability.
