# Working agreement

## Read first

1. `notes/progress/README.md` and its latest dated entry for the current checkpoint and next bounded step.
2. `notes/findings/README.md` and relevant topic files for facts, constraints, and open decisions.
3. `docs/architecture.md` and `docs/roadmap.md` for intended behavior.
4. `notes/learning/README.md` and relevant topic guides for user-facing explanations.

Code, migrations, and reproducible check results establish implemented behavior. Plans describe intended behavior; do not confuse them. Keep the current snapshot in the notes aligned with changes and preserve dated history.

## Scope and communication

- Explain the purpose and data flow of each bounded change in plain language.
- The verified foundation includes local V0.1 identity plus V0.2 Workspace, Agent, and ordered Flow catalogs with history/restore, archive/unarchive, and built-in templates. All support create/read/edit and restore as new immutable revisions; Flows pin Workspace/Agent versions and revalidate them on restore/unarchive. Archive preserves snapshots and names, protects active Flow dependencies, and uses a separate lifecycle counter to reject stale mutations. Templates fill new unsaved drafts; ordinary Save creates independent team-owned configuration after explicit repository/dependency choices. The [template completion record](notes/progress/2026-10-13-01-template-completion.md) records V0.2 acceptance and limits.
- V0.3 runner enrollment and compute controls are verified locally: team-admin one-use enrollment/revocation, member reads, a foreground CLI with memory-only credentials, authenticated 15-second heartbeats, derived offline status after 60 seconds, dispatch approval, and explicit per-user grants. Follow the [runner contract](notes/findings/runner-enrollment.md), [October 20 checkpoint](notes/progress/2026-10-20-01-runner-enrollment.md), [compute-control contract](notes/findings/runner-compute-controls.md), and [October 24 checkpoint](notes/progress/2026-10-24-01-compute-controls.md) for actual checks, recovery runs, cleanup, and limits. Current explicit team admins manage permission; eligible admins/developers each need a grant. Approval, health, and current use permission remain separate. Focused verification and owner/developer browser acceptance passed; full regression suites were deliberately not repeated.
- V0.4 deterministic durable sessions are verified locally in the [October 25 record](notes/progress/2026-10-25-01-durable-sessions.md): 130 distinct focused cases across runs, browser acceptance, and verified fixture/service cleanup; broad suites were not repeated. Follow the [session contract](notes/findings/durable-sessions.md): read-only preview, explicit immutable Flow/Workspace/Agent pins, exact typed input values, idempotent queue/start, append-only events, and pure `stub.v1` output with `quality: not_evaluated`. Foreground work requires `--stub-sessions`; default runner behavior remains heartbeat only. Work leases last 45 seconds and retain capacity one across active and uncertain ownership. Recheck the original starter's current eligibility/grant at claim and ordinary progress; browser logout alone does not stop durable work. Queued cancellation is immediate; active cancellation retains ownership until stopped acknowledgement. Lost-process recovery requires runner revocation and an admin's explicit stopped confirmation. Human reads and event batches reauthorize separately; terminal detail synchronizes the HTTP journal before claiming history is current. No repository/path/container execution or model work is implemented; those remain V0.5+ work. No new dependencies or external workflow service was added. Invitations and general administration UI remain future work; Agent instructions, capabilities, and model preferences remain inert configuration. Avoid repeating long suites without a new change or unresolved concern; the user requested focused verification.
- V0.5 has a recorded [repository/command contract](notes/findings/repository-execution.md), a pure shared compiler, and a backend saved-plan API verified locally; see the [planning record](notes/progress/2026-10-25-02-repository-planning.md) and [API record](notes/progress/2026-10-25-03-repository-plan-api.md) for focused checks and cleanup. Current members may preview/read plans; admins/developers may save an immutable `planned_unverified` record from an active supported Workspace version and explicit action/commit/image selection. Planning needs no runner or use grant. Migration 009 adds separate append-only plan storage with SELECT/INSERT runtime privileges. Save/audit/response validation are atomic; same-creator normalized request replay returns saved content without re-resolving the catalog or adding audit. SHA-256 uses the frozen v1 serialization, including fixed policy/limits and verbatim command text. Plans establish intent only, with no source/image observation, execution authority, lease, dispatch, UI, real report, or quality verdict. V0.4 remains the accepted runnable checkpoint; V0.5 is incomplete. Next separately define and implement repository execution admission, long-command control/renewal, and report binding before a real adapter. Do not reuse the stub admin stopped-confirmation shortcut to release future repository ownership without verified cleanup evidence.
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
- `pnpm.cmd db:prepare` explicitly applies migrations through 009 for durable sessions and immutable repository plans, and configures the runtime role; the API never runs migrations at startup. Never edit an applied SQL migration; add a new version.
- `pnpm.cmd db:test:prepare` provisions local `ark_test`. Integration and browser fixtures must refuse every other database and clean up only their own generated schema.
- Runtime uses `DATABASE_URL`; migrations use `MIGRATION_DATABASE_URL`. Never pass administrative credentials or private configuration into `VITE_*` variables.
- `pnpm.cmd dev` starts API, the lease-reconciliation engine, and web. `pnpm.cmd runner:local --stub-sessions` separately opts a newly enrolled foreground runner into pure stub work. Keep the loopback, exact Host/Origin checks, JSON mutation requirement, HttpOnly cookie, and explicit team-membership boundary intact.
- Keep browser checks and automated tests distinct. A successful build or a screenshot is not proof of authorization or persistence.
