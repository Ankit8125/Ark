# Working agreement

## Read first

1. `notes/progress/README.md` and its latest dated entry for the current checkpoint and next bounded step.
2. `notes/findings/README.md` and relevant topic files for facts, constraints, and open decisions.
3. `docs/architecture.md` and `docs/roadmap.md` for intended behavior.
4. `notes/learning/README.md` and relevant topic guides for user-facing explanations.

Code, migrations, and reproducible check results establish implemented behavior. Plans describe intended behavior; do not confuse them. Keep the current snapshot in the notes aligned with changes and preserve dated history.

## Scope and communication

- Explain the purpose and data flow of each bounded change in plain language.
- The current checkpoint is the local V0.1 identity foundation. Session execution, catalog editing, invitations, and administration UI are not implemented.
- Follow shared schema -> migration -> backend -> frontend within a feature increment. Do not replace the agreed architecture or implement later releases merely because their libraries are available.
- Before calling a milestone complete, meet its acceptance criteria and record actual checks, skipped checks, and limitations.
- Leave paid model calls, cloud provisioning, deployment, and unrelated external actions outside ordinary local-development work unless requested.

## Persistent notes

- Add a dated `notes/progress/YYYY-MM-DD-NN-topic.md` for every meaningful step: purpose, files, checks, result, next step, and relevant commit references. Update `notes/progress/README.md` with the current checkpoint and a link.
- Add or update focused guides under `notes/learning/` when the user's understanding or commands need to change; keep its README as the index.
- Add or update relevant topic files under `notes/findings/` when a new fact, decision, incompatibility, or resolved uncertainty matters to future work; keep its README as the index.
- Keep indexes concise. Split growing topics into linked files instead of accumulating all history or findings in one large document.
- Update the architecture/roadmap when an intended contract changes; explain the reason.
- Use repository notes for durable project context. Do not depend on a previous chat being available.

## Public repository and credentials

- Never stage `.env`, private research, credentials, logs, database files, or private source/prompts.
- `.env.example` must contain placeholders only. Never place database secrets in `VITE_*` variables.
- Keep the ignored original planning/research documents local. Do not remove their exclusions or copy their private contents into published docs.
- Avoid commands that print resolved Compose configuration, raw environment values, or secrets. Report endpoint/port/status only when inspecting local configuration.
- Stage explicit files, inspect the staged diff, and run `pnpm.cmd check:staged`. Do not bypass a failed guard; fix the content or report the issue.
- The guard is heuristic, not a complete security certification. Review confidential content manually as well.
- Preserve existing work and database volumes. Never use volume deletion or force push as routine setup or recovery.

## Commands and Git history

- Windows commands use `pnpm.cmd` to avoid PowerShell launcher-policy problems.
- Current checks: `pnpm.cmd build`, `lint`, `typecheck`, `test:unit`, `test:integration`, and `test:guard`.
- `pnpm.cmd setup:env` preserves an existing local environment file.
- `pnpm.cmd db:up`, `db:status`, `db:stop` operate only the declared local Compose project.
- Install the local hook with `pnpm.cmd hooks:install` after a fresh clone.
- Record meaningful, reviewable steps in commits. Do not manufacture commits for historical commands that ran before Git history existed.
- For authorized synchronization, fetch/inspect the destination, preserve remote work, push without force, and compare remote HEAD with local HEAD.
- `pnpm.cmd db:prepare` explicitly applies migrations and configures the runtime role; the API never runs migrations at startup. Never edit an applied SQL migration; add a new version.
- `pnpm.cmd db:test:prepare` provisions local `ark_test`. Integration and browser fixtures must refuse every other database and clean up only their own generated schema.
- Runtime uses `DATABASE_URL`; migrations use `MIGRATION_DATABASE_URL`. Never pass administrative credentials or private configuration into `VITE_*` variables.
- `pnpm.cmd dev` starts both API and web. Keep the loopback, exact Host/Origin checks, JSON mutation requirement, HttpOnly cookie, and explicit team-membership boundary intact.
- Keep browser checks and automated tests distinct. A successful build or a screenshot is not proof of authorization or persistence.
