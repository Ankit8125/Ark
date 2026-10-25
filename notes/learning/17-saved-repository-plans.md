# Preview and save a repository plan

Recorded 2026-10-25 (Asia/Kolkata). [Learning index](README.md) · [Pure planner](16-repository-planning.md) · [Contract](../findings/repository-execution.md) · [API verification record](../progress/2026-10-25-03-repository-plan-api.md)

The backend now previews, saves, lists, and reads immutable repository plans. This backend-only part of V0.5 is verified locally in the linked record of focused checks and cleanup. V0.4 stub sessions remain the accepted runnable workflow, and V0.5 is incomplete. There is no saved-plan UI, repository dispatch, execution admission, work renewal, or real command execution yet.

A plan preserves intended work: one exact saved Workspace version, one explicitly selected saved action, a declared full commit, and a matching image digest. Saving it does not observe the repository/image or grant permission to execute. Its status remains `planned_unverified`, with no process result or quality verdict.

## Purpose and data flow

```text
Current team member + Workspace version + explicit action/commit/image selection
  -> authorized preview compiles a plan and digest; saves nothing
  -> current admin/developer explicitly saves with a client-generated UUID
  -> PostgreSQL stores one immutable plan and safe audit atomically
  -> current team members list/read the saved plan independently
```

No runner, approval, use grant, or capacity slot is required for planning. These checks belong to future execution admission. The current runner still accepts only the opt-in deterministic `stub.v1` protocol.

## Backend endpoints

All paths below begin with `/api/teams/:teamId`. They use the existing signed-in cookie, exact Host/Origin checks, JSON mutation requirement, and request-size limit.

| Method and path | Current behavior |
| --- | --- |
| `POST /repository-plan-previews` | Members submit `{ workspace, selection }`; returns `{ plan, planDigest }` without storing a record or audit. |
| `POST /repository-plans` | Admins/developers submit the preview fields plus UUID `id`; returns `{ repositoryPlan }`, with 201 for creation or 200 for identical replay. |
| `GET /repository-plans?cursor=UUID` | Members receive at most 50 compact `repositoryPlans` summaries and nullable `nextCursor`. |
| `GET /repository-plans/:planId` | Members receive the complete authorized saved record. |

`workspace` contains `resourceId` and `versionId`. `selection` contains `action`, full 40-hex `commitOid`, and `imageDigest`. The API resolves an active supported Workspace version in the owning team and copies its selected command verbatim. Clients cannot replace the command, compiled plan, policy, limits, or host paths. There are no plan update/delete endpoints.

The saved record includes creator/team/organization provenance, creation time, the selected version's Workspace name, compiled plan, and digest. The complete original Workspace definition stays in its immutable catalog version. Summaries omit command/source configuration. Pagination uses UUID order; refresh to see records that fall before an already loaded cursor.

## Identity, replay, and atomic storage

The plan digest is SHA-256 of the UTF-8 bytes returned by `serializeRepositoryCommandPlan`, without an added newline or byte-order mark. The serializer strictly parses the plan and emits a fixed v1 field order, including nested fields. Incoming JSON and PostgreSQL JSONB key order therefore cannot change it. Version-1 normalization, policy/limits, and serialization semantics are frozen; different semantics require a new supported version. A digest identifies the stored intent; it is not proof of execution or source/image truth.

Keep the original save UUID and normalized request when a response is lost. The same currently authorized creator can replay those exact details and receive the saved record without another audit. A changed request, creator, or tenant conflicts. Replay reads the saved content instead of recompiling today's catalog, so a later Workspace edit or archive does not rewrite or invalidate that saved identity. New previews/saves still require an active supported Workspace; saved reads recheck current team access separately.

Save holds identity/membership locks and serializes the client UUID before resolving the current catalog. Concurrent identical requests therefore recover the same record, including when a waiter observes a subsequent archive. Record insertion, one safe audit, digest/response validation, and browser-session expiry checks share a transaction. A failed audit, invalid response, or expired session rolls back the new record. Audits contain identifiers/provenance rather than command text or repository configuration.

Migration `009_repository_plans.sql` creates separate plan storage with composite tenant/resource-kind/version ownership. Runtime privileges allow SELECT/INSERT only, and an immutable-row trigger also rejects UPDATE/DELETE. Run `pnpm.cmd db:prepare` after updating the checkout to apply migrations through 009; the API does not migrate on startup. Existing catalog versions, stub sessions, environment files, and database volumes are preserved.

## Next boundary

Next separately define and implement repository execution admission, long-command control/renewal, and report binding. Admission must reauthorize the chosen compute and bind work to the exact saved plan/digest. Registration heartbeats do not renew work ownership, and the current 45-second stub lease cannot supervise a long repository command unchanged.

A later adapter must observe the exact source/image, enforce limits and path boundaries, own its resources, and verify cleanup before releasing uncertain ownership. Process status and quality evidence stay separate; missing or zero tests remain non-pass. Model calls, credentials, publication, and deployment remain outside this planning slice.
