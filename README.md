# Ark

An independent, self-hosted development platform being built incrementally: a task becomes a plan, a verified change, a human-approved publication, and a draft pull request. The intended product supports multiple teams with backend-enforced permissions.

**Current status: V0.1 started, incomplete.** The repository contains a React/Vite starter and local PostgreSQL configuration. No platform API, authentication, runner, AI integration, or task-to-PR workflow exists yet.

## Start reading

- [Notes index](notes/README.md): where to find explanations, progress, and decisions.
- [Learning guides](notes/learning/README.md): focused explanations with flows and examples.
- [Progress](notes/progress/README.md): current checkpoint plus separate dated change records.
- [Findings](notes/findings/README.md): codebase facts and decisions organized by topic.
- [Architecture](docs/architecture.md) and [roadmap](docs/roadmap.md): the independent product's intended design and release boundaries.
- [Contributor/agent instructions](AGENTS.md): how to keep changes, notes, and Git history aligned.

## Local setup on Windows

Use Node.js 24, pnpm 10 (the exact version is pinned in `package.json`), Git, and Docker Desktop with its Linux engine running. Run commands from the repository root in PowerShell.

```powershell
npm.cmd install --global pnpm@10.34.5
pnpm.cmd install --frozen-lockfile
pnpm.cmd hooks:install
pnpm.cmd setup:env
pnpm.cmd db:up
pnpm.cmd dev
```

`setup:env` generates local credentials only if `.env` does not exist. It never prints or overwrites existing credentials. `.env.example` contains placeholders only. If the PostgreSQL volume already exists, retain the matching `.env`; regenerating it does not change the password inside an initialized database.

The frontend normally opens at `http://127.0.0.1:5173`. PostgreSQL is reachable on **127.0.0.1:5434**, forwarded to container port 5432. The frontend is not connected to PostgreSQL; a future API will mediate that access.

## Available checks

```powershell
pnpm.cmd build
pnpm.cmd lint
pnpm.cmd test:guard
pnpm.cmd db:status
docker compose --env-file .env -f infra/local/compose.yaml exec -T postgres psql -U ark -d ark_dev -c "SELECT version();"
```

The build includes TypeScript compilation. Lint currently uses the starter's Oxlint configuration. `test:guard` checks the local staged-file guard; it is not a platform business-logic test suite. Vitest and Playwright are installed, but application unit/integration/browser suites have not been implemented.

Stop the web server with Ctrl+C and the database with `pnpm.cmd db:stop`. The named database volume persists.

## Before each commit

1. Make one bounded change and update the relevant notes in the same change.
2. Run applicable checks, add a dated entry under `notes/progress/`, and update its index.
3. Stage explicit files; inspect `git diff --cached` locally.
4. Run `pnpm.cmd check:staged`, then commit with a descriptive message.
5. Push the reviewed commits and verify that the remote branch matches local HEAD.

The installed pre-commit hook repeats the staged-file guard. It catches selected token formats, credential-bearing URLs, known local `.env` secrets, and private/local files. It is a targeted safety check, not a guarantee that every possible secret or confidential passage is detected. Hooks must be installed in each fresh clone.

This repository is public. Local research documents containing private service references are intentionally excluded. Published architecture and roadmap files describe only this independent project. Do not copy private source, prompts, reports, credentials, or internal links into notes or commits.
