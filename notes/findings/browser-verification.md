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
