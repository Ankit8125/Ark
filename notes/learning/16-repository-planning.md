# Plan one saved repository action

Recorded 2026-10-25 (Asia/Kolkata). [Learning index](README.md) · [V0.5 contract](../findings/repository-execution.md) · [Planning progress](../progress/2026-10-25-02-repository-planning.md)

V0.4 deterministic sessions remain the accepted runnable workflow. V0.5 now has a recorded repository/command contract and a first pure shared planning slice. Its focused tests/build are tracked in the progress record; V0.5 is incomplete. There is no repository plan API, database storage, runner consumption, or UI integration yet, and no command has run through this planner.

The purpose is to make the intended work explicit before Ark eventually prepares a repository: **one saved Workspace action, one declared commit, and one matching image digest**. A saved branch or image tag can move. The plan preserves that recipe context while separately recording the exact identities the caller declares; later preparation must observe and verify them.

## What the compiler accepts

`compileRepositoryCommandPlan` in `packages/contracts/src/repository-command-plan.ts` takes an immutable Workspace reference/definition and a strict selection:

| Selection | Current meaning                                                                                                                          |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Action    | Choose exactly one saved `install`, `test`, `lint`, or `build` action. A blank command is rejected.                                      |
| Commit    | Declare a full 40-hex SHA-1 commit OID. Abbreviated IDs and branch/tag names do not satisfy this field.                                  |
| Image     | Declare a lowercase `repository@sha256:64-hex` reference using the saved image's repository spelling. A saved digest must match exactly. |

For example, a Workspace that saves `node:24` can be paired with a declared `node@sha256:...` digest. A different repository spelling is rejected, including an alias that might name equivalent content elsewhere. The compiler does not resolve the tag or establish that the declared digest is its actual content. Digest identity also does not establish image trust.

Selecting `test` copies the Workspace's test command **verbatim**. It never implicitly adds install, lint, build, guessed test flags, or another action. Shell syntax stays intentional saved configuration for the later container's `/bin/sh -c`; the planner does not split it into host commands or execute it.

## What `planned_unverified` means

```text
Pinned Workspace reference and definition
  + one explicit saved action
  + declared full commit OID
  + same-repository image digest
  -> pure validation and copied plan
  -> status: planned_unverified
```

The plan records the Workspace resource/version IDs, repository URL, requested source ref, declared commit, requested image and digest, exact selected command, relative working directory, derived container directory, and fixed policy/limits. A relative `apps/web` directory derives `/workspace/repository/apps/web`; `.` derives `/workspace/repository`. That lexical check cannot determine whether a real directory exists or a symlink escapes the intended root.

The compiler uses no filesystem, network, environment, credentials, subprocess, Docker daemon, or database. It does not establish:

- current user/team authority, runner permission, compatibility, or capacity;
- that the repository/commit exists or that the commit corresponds to the requested source ref;
- image availability, content observation, trust, or enforced isolation;
- real checkout containment, command completion, cleanup, test counts, or quality.

`repository.v1` names the future execution mode. `docker-linux-offline.v1` names the planned command policy: offline, non-root, read-only root filesystem, dropped capabilities, and fixed budgets. Declaring that policy in a valid plan does not enforce it. The plan emits no execution report or quality verdict, and it is not an admission ticket.

## What comes next

Additive plan storage and authorized read-only preview/admission/renewal come before a real Docker adapter. The server must compile from separately authorized saved snapshots, persist the immutable plan before dispatch, and bind future receipts to that exact plan. Commands longer than the existing 45-second work lease need explicit authorized work renewal; registration heartbeats remain separate.

The later adapter must observe the exact source/image, create only manifest-owned resources, enforce the contract's limits, supervise the selected command, and prove cleanup before releasing uncertain ownership. It must preserve the user's checkout, unrelated containers/volumes, and existing data. The V0.4 pure-stub admin confirmation is insufficient to release future repository work without verified cleanup evidence.

Real process results and test quality will be separate. Exit zero or console prose cannot establish tests passed; missing, zero, entirely skipped, malformed, or unsupported test evidence remains non-pass. Those reports and their validators belong to later slices. Model calls, credentials, publication, and deployment remain outside this V0.5 planning work.
