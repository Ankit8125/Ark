# Browser verification and design decisions

Recorded 2026-09-26. [Findings index](README.md)

## Design reference lock

The existing project direction specifies a compact light developer console, grouped Run/Build/Operate navigation, restrained purple actions and selection, sans-serif text, and monospace identifiers. This increment uses 14px system typography, neutral surfaces and borders, CSS modules with tokens, Lucide icons, and a small code-native Ark favicon. Forms use native labels and controls; a native details element supplies the account menu. No complex component required Radix in this slice.

Refero live reference search returned NO_SUBSCRIPTION. The supplied direction and the installed Refero skill's craft, typography, and color guidance informed the implementation; no unavailable reference is claimed as reviewed. Rejected patterns: marketing hero, invented metrics, fake execution records, unlabeled decorative controls, or functioning-looking buttons for future features.

## Reproduce the disposable browser environment

Run from the repository root after dependency installation:

```powershell
pnpm.cmd build:shared
pnpm.cmd db:test:prepare
pnpm.cmd test:browser:api
```

In a second PowerShell terminal:

```powershell
$env:ARK_API_TARGET = 'http://127.0.0.1:3002'
pnpm.cmd --dir apps/web dev --port 5184
```

Open http://127.0.0.1:5184. The helper creates an empty unique schema in local ark_test; it refuses ark_dev. Use fictional names and an example.test email, and a test-only password. Never use real credentials in browser traces or CLI history. The API's test origins are exactly localhost/127.0.0.1:5184; choose coordinated allowlists if changing test ports.

The helper attempts cleanup on SIGINT/SIGTERM. Abrupt process-tree termination on Windows may skip that handler. Inspect remaining generated schemas and remove only the schema from that fixture; never drop the database or development schema. This checkpoint's two browser fixture schemas were separately identified by migration time and fixture contents before cleanup.

## Acceptance walkthrough performed

Playwright CLI 0.1.21 with Chrome was used against the actual local API and PostgreSQL fixture:

1. New installation opened the setup form.
2. Submitting an empty form displayed field errors and focused the first invalid input.
3. Valid setup created the organization/owner/team and opened Sessions.
4. Reload preserved authentication and the saved organization/team context.
5. Desktop and 390px mobile screenshots were visually inspected; the shell and login remained readable.
6. Account-menu sign-out returned to login.
7. Incorrect password produced the generic error and focused its alert.
8. Browser offline simulation displayed a retryable connection error and retained entered fields.
9. Restoring network access and retrying the same login opened the authenticated shell.

Artifacts are local and ignored under output/playwright; transient snapshots/logs are ignored under .playwright-cli. This is a recorded interactive acceptance check, not an automated browser regression suite or a complete accessibility audit.

## Issues resolved and check limits

A missing favicon was replaced with the Ark mark. A browser left open across dependency optimization/configuration updates briefly mixed stale Vite bundles; a full reload loaded consistent modules and the flow was rerun successfully. Expected 401 responses and the intentional offline failure appear in browser console history; they are not successful-login runtime exceptions.

Ports 5173 and 5174 were already occupied by older servers. Verification used 5184 and API 3002 without stopping those unrelated listeners. The normal root dev command was checked: its strict-port failure stopped its sibling process as designed. Stop the older development terminal on 5173 before normal startup. No network deployment, real organization account, or paid inference was performed.

## Workspace increment, 2026-09-27

The same disposable-database approach verified workspace creation, all-field reload fidelity, two-tab stale conflicts, offline-save retry, and canceled dirty navigation. Desktop and 390px mobile forms were inspected. See the [workspace implementation record](../progress/2026-09-27-01-workspaces.md) for the actual walkthrough, automated coverage, and limits. The existing visual direction was retained; Refero remained unavailable with NO_SUBSCRIPTION, and no subscription or design dependency was added.

## Agent increment, 2026-09-27

The [Agent implementation record](../progress/2026-09-27-02-agents.md) records complete field reload checks, a two-tab revision conflict, offline-save recovery, Agent-specific navigation protection, and desktop/mobile inspection. The refactored Workspace form also preserved all 11 controls after save/reload. Both resources could share a display name without mixing their catalogs. The browser and QA servers were stopped, and the identified test schema's removal was verified. Role/schema cases remain separate DOM/API evidence; this walkthrough is not a full end-to-end regression suite.

## Flow increment, September 28–30: incomplete walkthrough

The disposable fixture reached setup, Workspace/Agent creation, Flow navigation, and the initial ordered form. Flow save/reload, pin retention/upgrades, stale conflicts, mobile inspection, and final console/cleanup confirmation remain pending. The approval service's account usage limit prevented the reload/resume commands from executing. See the [verification checkpoint](../progress/2026-09-30-01-flow-verification.md) for precise evidence and recovery instructions. Do not substitute the passing DOM/API checks for these missing browser checks.

## Flow acceptance completed, 2026-10-01

The earlier interruption is resolved. A fresh disposable fixture verified all 22 form values across create/full reload, a two-stage text/JSON recipe, invalid reorder rejection with retained references, historical Agent pins after a dependency edit, and an explicit upgrade of one stage without changing the other. Two-tab conflicts, load-latest confirmation, offline-save recovery, and dirty navigation stay/discard paths also passed. Full desktop and 390px mobile captures were visually inspected; neither viewport overflowed horizontally. Console history contained only the deliberate 409 conflict and offline network errors, with no unexpected application errors or warnings.

The abandoned earlier schema was identified and removed separately. The fresh fixture cleaned itself up on shutdown; its absence and closed QA ports were independently verified. The development database remained empty with four migrations. See the [completion record](../progress/2026-10-01-01-flow-completion.md) for the exact checks and walkthrough synchronization details. These are interactive acceptance results, not a browser regression suite or full accessibility audit.

On Windows, avoid rebuilding shared packages while a browser draft is open: it can mix stale Vite modules during hot reload. After source/build changes, reload a stable module graph before accepting browser results. Wait for `All changes saved` after loading a record, but `Saved revision N.` after an update; the two statuses describe different events.

## History/restore acceptance completed, 2026-10-02

The disposable fixture verified browsing complete Workspace, Agent, and Flow snapshots; confirmed restores as new revisions; canceled restore draft retention; offline Agent restore and manual retry; and exact Flow pin/definition retention after restore and full reload. Two tabs verified stale restore conflict, retained draft, and explicit load-latest cancel/confirm recovery. Desktop and 390px mobile history lists/previews were visually inspected and did not overflow horizontally.

The earlier approval-service usage interruption was resolved. The existing test schema was positively identified and resumed; after acceptance, both QA servers and Chrome were closed. Cleanup checked exact fixture identities and snapshot counts under table locks before removing only that schema, and verified its absence and closed ports. Development remained empty with four migrations under restricted `ark_app`. See the [history acceptance record](../progress/2026-10-02-01-catalog-history.md) for commands, expected console errors, and limits. This remains an interactive walkthrough, not an automated browser suite.

## Archive/unarchive acceptance completed, 2026-10-04

The disposable fixture verified archive confirmation/cancel, blocked Workspace archive while an active Flow referenced it, URL-persisted Active/Archived filtering, and archived read-only forms with complete history. All 15 Flow form values survived archive and full reload. Unarchive rejected an archived dependency, then preserved the exact original pins and definition once dependencies were active, even after the Workspace advanced to revision 2.

An offline Agent archive retained its draft and allowed a successful manual retry. Two tabs verified that a Workspace archive/unarchive cycle invalidated an older draft even though its definition revision was unchanged; failed save retained the draft, and explicit load-latest cancel/confirm recovered correctly. Desktop 1440px and mobile 390px editor/history/list captures were visually inspected with no horizontal overflow. Console review found only intentional authorization/conflict/dependency/offline responses and normal React development information.

The original fixture was reused after interruption and cleaned up through its owning API helper. Chrome and both QA servers stopped; an independent query confirmed the exact generated schema was absent and ports 3002/5184 were closed. Development remained empty under restricted `ark_app` with five migrations. See the [completion record](../progress/2026-10-04-01-archive-completion.md) for commands and limits. These are interactive acceptance checks; they do not establish an automated browser regression suite or a full accessibility audit.

## Template acceptance completed, 2026-10-13

The disposable fixture verified Workspace, Agent, and Flow template copies through actual Save and hard reload: 11, 8, and 25 form values respectively. Dirty replacement cancel/confirm, a required repository URL, required explicit Flow pins, fresh stage identities/remapped sources, and offline template-read retry passed. Saved editors hid template actions. Desktop 1440x1000 and mobile 390x844 captures were inspected without horizontal overflow.

Live changes to a custom hook's layout temporarily produced React hot-reload hook-order/render-recovery errors. Reload the final stable module graph before accepting browser results. All three saved copies were rechecked after the final refactor with their recorded fields intact and no page errors. The only network error in ordinary template acceptance was the deliberate offline read.

The earlier empty template schema was positively identified and removed. Noninteractive server sessions could not receive the helper's `stop` line; exact QA process command lines/ports were verified before shutdown. Fresh-schema cleanup checked and locked the fixture identities and counts before dropping only that schema. Both schemas' absence, closed QA ports, and unchanged development counts were independently verified. See the [completion record](../progress/2026-10-13-01-template-completion.md) for automated recovery runs and limits. This is interactive acceptance, separate from authorization and persistence regression tests.

## Runner acceptance completed, 2026-10-20

The disposable fixture verified required-name validation, lost enrollment-response replay with an unchanged identity, masked in-memory codes, real foreground CLI enrollment, authenticated heartbeat health, stale revoke recovery, and API restart persistence. Stopping a runner naturally became Offline after 60 seconds. A second connected runner survived cancelled revocation; confirmed revocation persisted through reload, preserved last-seen history, and caused the CLI to reject authentication and exit. An offline list read retained records and recovered through retry.

Desktop 1440x1000 and mobile 390x844 captures were visually inspected without horizontal overflow. Codes were never printed, saved to browser storage, or included in screenshots; a local authenticated helper transferred the code directly to the real CLI's stdin. Hidden interactive terminal behavior has separate unit evidence. Console errors corresponded to deliberately dropped/offline requests and the expected stale 409; Chrome also emitted an informational note about the read-only masked field outside a form.

The helper removed its exact schema and stopped its child process, the named browser closed, and the exact Vite process was identified before shutdown. Independent checks verified both identified runner QA schemas absent, QA ports 3002/3003/5184 closed, and unchanged empty development counts under restricted `ark_app` with six migrations. See the [runner checkpoint](../progress/2026-10-20-01-runner-enrollment.md) for automated recovery runs, the user-run focused result, and acceptance limits. No long test suites were repeated during this walkthrough.
