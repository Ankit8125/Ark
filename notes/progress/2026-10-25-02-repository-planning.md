# V0.5 repository command planning

Recorded 2026-10-25 (Asia/Kolkata). [Current progress](README.md) · [Contract](../findings/repository-execution.md)

## Purpose and boundary

Continue from accepted/pushed V0.4 commit `ba2ab270f85de5930740747008a622b6f5f7031b`. The next bounded step was to define the V0.5 repository isolation and real-command contract before implementation. That contract is now recorded, including source/image identity, current authority, long-command renewal, verified cleanup, and separate process/quality evidence.

The first implementation slice is a pure shared compiler for one explicitly selected saved Workspace action. A plan names a pinned Workspace, declared full commit, digest-qualified image, exact command, container working directory, and fixed policy/limits. Its status is `planned_unverified`. Plans do not establish authorization or observed repository/image identity. V0.4 Start/claim/runner behavior stays unchanged.

## Implemented files and behavior

- `packages/contracts/src/repository-command-plan.ts`, exported through the shared index, defines strict source/image selection and plan schemas, fixed policy/limits, and `compileRepositoryCommandPlan`. It copies supplied snapshot data without filesystem, network, environment, credential, or subprocess access. The future server still has to establish authority and supply the actual authorized snapshot.
- One explicit saved action is copied verbatim; other actions never run implicitly. Full commit OIDs normalize to lowercase. If the Workspace already names a full commit, the selection must match. Image pins preserve the saved untagged repository spelling and any existing digest, including saved tagged-plus-digest references. Empty/malformed saved tags, replacement digests/repositories, unsafe lexical directories, unknown fields, and policy/limit overrides are rejected.
- The plan carries `planned_unverified`, a derived directory under `/workspace/repository`, and declared budgets including preparation, command, cleanup/run deadlines, retained output, CPU, memory, workspace/temporary storage, and PIDs. These fields do not prove that an adapter enforces isolation or that the declared source/image exists.
- `tests/unit/repository-command-plan.test.ts` contains the focused contract checks. Findings, architecture/roadmap, contributor instructions, progress indexes, and the [planning guide](../learning/16-repository-planning.md) distinguish this slice from actual execution. The earlier [stub guide](../learning/15-durable-sessions.md) remains the runnable workflow.

## Checks actually completed

| Check                                                                                               | Result                                       |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `pnpm.cmd build:shared` after final source edits                                                    | Contracts and database packages compiled     |
| `node node_modules/vitest/vitest.mjs run tests/unit/repository-command-plan.test.ts --pool=threads` | 18/18 passed in 9.69 seconds                 |
| `pnpm.cmd typecheck`                                                                                | All packages and root test TypeScript passed |
| `pnpm.cmd lint`                                                                                     | Passed without warnings                      |

Independent reviews identified and corrected exact-commit conflicts, malformed saved tags, and tagged-plus-digest image matching; the passing tests include those regressions. The contract also now assigns a 30-second cleanup budget and explicit workspace storage budget. No new dependencies were added. Full suites, API/integration tests, browser checks, migrations, and Docker readiness/execution were intentionally omitted because this slice has no API, storage, runner, or UI integration. No claim is made about container isolation, cleanup behavior, source/image observation, reports, or test quality.

No repository fetch or command execution by Ark, image pull, database mutation, running service, disposable database/container fixture, model call, or deployment was introduced. Existing data, volumes, credentials, private research, and the user's checkout were preserved. Git synchronization is separate from repository execution by Ark. All 15 source/test/documentation files were explicitly staged and reviewed; staged whitespace, 192 local links across 12 Markdown files, confidential-content review, and `pnpm.cmd check:staged` passed. No private/local/generated files were staged. The guard remains heuristic and supplements manual review.

The shared planning slice is implemented and verified; **V0.5 is not complete**. V0.4 remains the accepted runnable checkpoint. This increment's base is `ba2ab27`; its commit is identifiable with `git log -- notes/progress/2026-10-25-02-repository-planning.md`.

## Next bounded step

Implement additive repository-plan storage and the authorized read-only preview/admission/lease-control boundary before connecting a real runner adapter. Preserve applied migration 008, stub compatibility, exact plan/receipt binding, current authorization, and exclusive active-or-uncertain ownership. The real adapter must verify resource ownership and stopped processes before release; the stub-only manual confirmation is insufficient.
