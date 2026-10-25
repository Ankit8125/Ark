# Ark

An independent, self-hosted development platform being built incrementally: a task becomes a plan, a verified change, a human-approved publication, and a draft pull request. The intended product supports multiple teams with backend-enforced permissions.

**Verified locally: V0.1 identity and the V0.2 catalog milestone, including built-in templates.** Create the first organization, owner, and team through local setup; sign in and save team-owned configuration with immutable versions and stale-edit protection. Browse snapshots, restore one as a new revision, or archive configuration while keeping its history. Flows connect typed stages and pin exact Workspace/Agent versions. Templates fill unsaved drafts; ordinary Save creates independent copies after explicit repository/dependency choices. A Fastify API checks authentication, explicit team membership, write roles, and dependencies against PostgreSQL. See the [V0.2 acceptance record](notes/progress/2026-10-13-01-template-completion.md) for evidence and limits.

**Verified locally: V0.3 runner enrollment and compute controls.** Team admins issue one-use enrollment codes, revoke registrations, approve enrolled runners, and grant use to specific current team admins/developers. Every intended user, including an admin, needs a grant. The foreground CLI keeps credentials in memory and sends 15-second heartbeats; the server derives offline status after 60 seconds. Compute separates approval, personal permission, and health. The [runner checkpoint](notes/progress/2026-10-20-01-runner-enrollment.md) and [compute-control checkpoint](notes/progress/2026-10-24-01-compute-controls.md) record local acceptance, cleanup, and limits. Full regression suites were deliberately not repeated for compute controls.

**Verified locally: V0.4 durable deterministic-stub sessions.** Sessions previews an explicit saved Flow version, typed input values, and an eligible runner before queuing a pinned snapshot. A foreground runner must opt in with `--stub-sessions`; its default remains heartbeats only. PostgreSQL owns the queue, event journal, and 45-second work leases, with one active or uncertain reservation per runner. Saved sessions expose stage outputs, replayable events, cancellation, and explicit recovery. Session quality remains `not_evaluated`; the stub performs no repository, command, container, or model work. No dependencies or external orchestration services were added. The [V0.4 record](notes/progress/2026-10-25-01-durable-sessions.md) records 130 distinct focused cases across runs and browser acceptance, including response-loss replay, a 20-stage session across API/engine restarts, finite SSE replay, cancellation, natural expiry, admin recovery, and desktop/mobile layouts. Broad suites were not repeated. Fixture cleanup was verified; development data remains empty under restricted `ark_app` with eight migrations. The [session guide](notes/learning/15-durable-sessions.md) explains the workflow and recovery. Next, define the V0.5 isolated repository and real-command contract before implementation.

## Start reading

- [Notes index](notes/README.md): where to find explanations, progress, and decisions.
- [Learning guides](notes/learning/README.md): focused explanations with flows and examples.
- [Progress](notes/progress/README.md): current checkpoint plus separate dated change records.
- [Findings](notes/findings/README.md): codebase facts and decisions organized by topic.
- [Architecture](docs/architecture.md) and [roadmap](docs/roadmap.md): the independent product's intended design and release boundaries.
- [Contributor/agent instructions](AGENTS.md): how to keep changes, notes, and Git history aligned.

## Local setup on Windows

Use Node.js 24.15 or newer within 24.x, pnpm 10 (the exact version is pinned in `package.json`), Git, and Docker Desktop with its Linux engine running. Run commands from the repository root in PowerShell.

```powershell
npm.cmd install --global pnpm@10.34.5
pnpm.cmd install --frozen-lockfile
pnpm.cmd hooks:install
pnpm.cmd setup:env
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

`setup:env` generates local credentials only if `.env` does not exist. It never prints or overwrites existing credentials. `.env.example` contains placeholders only. If the PostgreSQL volume already exists, retain the matching `.env`; regenerating it does not change the password inside an initialized database.

Open **http://127.0.0.1:5173** and create your owner account. `dev` builds shared packages and starts the API on **127.0.0.1:3001**, the lease-reconciliation engine, and the frontend together. Vite forwards `/api` requests; the API and engine access PostgreSQL at **127.0.0.1:5434**. The runner uses HTTP only. Ports are strict: stop an older Ark development terminal if one is already using them.

`db:prepare` applies checked SQL migrations and creates a restricted `ark_app` runtime role. It preserves an older setup's administrative connection as `MIGRATION_DATABASE_URL` and writes the new runtime `DATABASE_URL` to ignored `.env`. It never creates an owner account. Keep the resulting `.env` with its matching database volume. See [identity and sessions](notes/learning/05-identity-and-sessions.md) for the full flow and limitations.

After updating an existing checkout, run `pnpm.cmd db:prepare` to apply migrations through **008**, including durable session storage. To connect a local heartbeat runner, issue an enrollment code in **Compute**, then run `pnpm.cmd runner:local` in another terminal and enter the code at its hidden prompt. To accept deterministic stub sessions, start that new foreground process with `pnpm.cmd runner:local --stub-sessions` instead. Keep it open; restarting needs a new enrollment. In Compute, an admin must separately approve it and grant your own eligible account use. The [local runner guide](notes/learning/13-local-runners.md), [compute controls](notes/learning/14-compute-controls.md), and [durable sessions](notes/learning/15-durable-sessions.md) explain the separate boundaries.

## Available checks

```powershell
pnpm.cmd build
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test:unit
pnpm.cmd db:test:prepare
pnpm.cmd test:integration
pnpm.cmd test:guard
pnpm.cmd db:status
docker compose --env-file .env -f infra/local/compose.yaml exec -T postgres psql -U ark -d ark_dev -c "SELECT version();"
```

TypeScript strictness is explicit across the workspace. Oxlint is the chosen linter for this slice. Unit tests check shared contracts; integration tests use isolated schemas in **ark_test**, require that exact local database name, and include an actual API process restart. They never bootstrap or clear `ark_dev`. `test:guard` checks the staged-file safety tool. Browser verification uses the [documented Playwright CLI walkthrough](notes/findings/browser-verification.md); it is not an automated browser regression suite.

Stop the API, engine, and web development group with Ctrl+C, stop any foreground runner in its terminal, and stop the database with `pnpm.cmd db:stop`. The named database volume persists. A lost runner process can leave an uncertain session reservation; follow the session guide's revoke-and-confirm recovery before releasing it. These defaults support local development only; a network deployment needs a separate HTTPS, cookie, proxy, and operations review.

## Before each commit

1. Make one bounded change and update the relevant notes in the same change.
2. Run applicable checks, add a dated entry under `notes/progress/`, and update its index.
3. Stage explicit files; inspect `git diff --cached` locally.
4. Run `pnpm.cmd check:staged`, then commit with a descriptive message.
5. When synchronization is authorized, push the reviewed commits and verify that the remote branch matches local HEAD.

The installed pre-commit hook repeats the staged-file guard. It catches selected token formats, credential-bearing URLs, known local `.env` secrets, and private/local files. It is a targeted safety check, not a guarantee that every possible secret or confidential passage is detected. Hooks must be installed in each fresh clone.

This repository is public. Local research documents containing private service references are intentionally excluded. Published architecture and roadmap files describe only this independent project. Do not copy private source, prompts, reports, credentials, or internal links into notes or commits.
