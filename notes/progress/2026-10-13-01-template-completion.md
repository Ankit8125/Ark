# Built-in templates and V0.2 catalog acceptance

Recorded 2026-10-13 (Asia/Kolkata). [Current progress](README.md) · [Initial contract](2026-10-05-01-catalog-templates.md)

## Purpose and data flow

Finish the existing template increment before starting runners. Current team members can read original built-in examples. Applying one fills a new unsaved draft; ordinary catalog Save creates the team's independent resource and immutable revision. Workspace copies require a repository URL. Flow copies receive fresh stage IDs and remapped bindings, then require explicit Workspace and Agent version choices. Backend creation rechecks the ordinary authorization, active dependencies, version pairs, and schema rules.

The local V0.2 catalog milestone is complete with Workspace, Agent, ordered Flow, immutable history/restore, archive/unarchive, and built-in examples. User-managed template libraries, bundle import/export, deletion, execution, invitations, and administration remain separate scope. Agent runtime/model/capability preferences remain inert. Templates need no migration, credential, dependency, seed record, or external service.

## Files and changes

- `packages/contracts/src/catalog-templates.ts` defines strict bounded template envelopes and definitions without repository choices or dependency pins. Flow examples reuse the real ordered graph validator through internal validation-only references.
- `apps/api/src/catalog-templates.ts` ships one Workspace, two Agent, and one illustrative two-stage Flow example, returning independent nested copies. `catalog-template-routes.ts` reads them through current session/team authorization with strict kind, parameter, and empty-query validation. `app.ts` registers the route.
- `apps/web/src/features/catalog/` adds template reads, clone conversion, a shared optional chooser, and editor recovery. The concrete Workspace/Agent/Flow editors provide their conversion functions. Applying a template preserves the creation ID so uncertain-create replay still works.
- `useVersionedEditor.ts` keeps request lifetime independent of status callback identity, fixing a cancelled read that could leave loading stuck. `features/flows/useDependencyCatalog.ts` hides previous-team choices immediately and protects loading, errors, retries, and pagination from replaced requests.
- Template contract, PostgreSQL, and DOM tests cover malformed definitions/graphs, current authorization, read-side non-mutation, independent saved copies, replay, current dependency rejection, required choices, dirty/offline recovery, late responses, and team changes. The cross-organization test relaxes the singleton constraint only inside its own disposable schema, matching existing isolation fixtures; production constraints are unchanged.
- Architecture, roadmap, working agreement, findings, and learning guides now reflect templates and the next bounded V0.3 contract. The October 5 implementation checkpoint is preserved.

## Automated checks

| Check | Result |
| --- | --- |
| `pnpm.cmd build` | All packages passed; final frontend fixes are also checked by `pnpm.cmd --dir apps/web build` |
| `pnpm.cmd lint` | Passed without warnings after final dependency-loading cleanup |
| `pnpm.cmd typecheck` | All packages and test TypeScript passed after final dependency-loading cleanup |
| `node node_modules/vitest/vitest.mjs run tests/unit apps/web/src --pool=threads --maxWorkers=1` | 155 tests passed in 16 files; one history worker timed out before discovery |
| Same runner with `apps/web/src/features/catalog/CatalogHistory.test.tsx` | Remaining 40/40 passed; 195 total unit/DOM cases verified before final added recovery case |
| Same runner with `CatalogTemplates.test.tsx` and `FlowEditor.test.tsx` after final hook cleanup | 41/41 passed, including two additional recovery cases; final total is 197 distinct unit/DOM cases |
| `node --env-file=.env node_modules/vitest/vitest.mjs run tests/integration --pool=threads --maxWorkers=1` | 130 passed; one new isolation fixture failed on the organization singleton constraint |
| Same runner with `tests/integration/catalog-templates.test.ts` after fixture correction | 17/17 passed, covering the earlier failed case; 131 integration cases verified in total |
| `pnpm.cmd test:guard` | 7/7 passed |

These totals combine full and targeted recovery runs; they are not a claim of one uninterrupted suite pass. Early sandbox runs could not access dependencies or loopback PostgreSQL; elevated local verification resolved those restrictions. Docker Desktop was initially stopped, then its declared PostgreSQL service was started with the existing volume. A worker startup timeout during host contention was recovered with a targeted rerun. No assertion failure was hidden by the timeout.

Independent backend and frontend reviews completed. Backend review found no implementation defect. Frontend recovery issues above received focused regression coverage. The final dependency hook derives loading/error visibility from kind/team/retry-keyed results rather than synchronous effect setters, and recovers interrupted pagination without retaining an old request's loading state.

## Browser acceptance

Playwright CLI used a fictional owner created through the setup UI, a disposable `ark_test` schema, API port 3002, and web port 5184. Actual API and PostgreSQL persistence were exercised separately from DOM mocks.

- Workspace dirty replacement cancellation preserved the manual draft; confirmation copied the example. Empty repository submission was rejected. All 11 fields survived real creation and a hard reload; saved records no longer exposed template controls.
- An offline Agent template read retained manual edits and showed a retry action. Restoring network access and retrying did not replace the draft. Applying the example and editing its instructions created an independent Agent; all 8 controls, including capabilities, survived reload.
- The Flow example began with empty Workspace and Agent selectors. Saving before selection marked all three required dependency fields invalid. Explicit choices and a custom second-stage name saved successfully. All 25 form values survived reload. Authorized saved-definition reads verified exact pins, fresh stage IDs, and remapped stage-output/final-output bindings against the shipped example.
- Desktop 1440x1000 and mobile 390x844 Workspace/Agent/Flow template captures were inspected. Controls and explanatory text remained readable; all three forms had no horizontal document overflow. A clean Flow preview was captured separately from the deliberate validation-error state.
- Stable-source console review found the intentional offline failure and ordinary React development information. Changing the hook layout while Vite was live temporarily triggered React's hook-order/render recovery during hot reload. A full reload loaded the final module graph; all three saved copies were rechecked against their recorded fields, with no page errors. CLI quoting, expected-validation-text, and absolute-URL walkthrough mistakes were corrected; final DOM markers and independent reload/API assertions confirmed completion after early dialog returns.

This remains interactive acceptance, not an automated browser regression suite, full accessibility audit, or network-release verification. Current role/session/isolation and transaction guarantees are established by separate API/DOM regression checks. No model call, deployment, repository access, runner, or job execution occurred.

## Data preservation and cleanup

The prior October 5 template schema was positively identified from its ignored fixture record and locked for inspection. It contained zero users, resources, and versions; only that empty generated schema was removed. A fresh generated schema was used for this walkthrough.

The named QA browser was closed. The server sessions had no interactive stdin, so the helper's `stop` command was unavailable. The two server processes were identified from their exact command lines and QA ports, then stopped. Cleanup locked the exact fresh schema and verified its fictional owner/organization/team, three named resources, and three immutable versions before removing only that schema. Independent queries confirmed both template schemas absent and ports 3002/5184 closed.

Before and after QA, `ark_dev` used `ark_app`, had five migrations, and contained zero users, resources, and versions. These counts matched exactly. A final role check confirmed no superuser, database/role creation, or RLS-bypass privileges. Environment files and persistent database volumes were preserved. Browser screenshots, logs, and helper scripts remain ignored under `output/playwright/` and `.playwright-cli/`.

## Git and next bounded step

Base commit: local archive checkpoint `b1554c6`. This record belongs to the template feature commit, identifiable with `git log -- notes/progress/2026-10-13-01-template-completion.md`. All 38 source/test/documentation files were explicitly staged and the staged diff reviewed. Staged whitespace checks and `pnpm.cmd check:staged` passed; all 20 changed Markdown files had valid local links. Manual review found no credentials, private research/source, browser artifacts, or unrelated changes. The guard is heuristic and complements manual review. No push was requested or performed.

Next: define the V0.3 enrollment contract before shared schemas or a migration. Bound the first increment to one-use enrollment, runner authentication, heartbeats, explicit team authorization, and revocation; distinguish online, approved, granted, compatible, and available compute. Dispatch/jobs and repository/model execution remain later increments.
