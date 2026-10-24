# Dispatch approval and explicit compute grants

Recorded 2026-10-20 (Asia/Kolkata). [Findings index](README.md)

Implemented and accepted locally on October 24. The [checkpoint](../progress/2026-10-24-01-compute-controls.md) records focused automated checks, real browser acceptance, cleanup, and skipped full regression suites.

## Bounded contract

This extends runner enrollment with stored permission controls. It introduces no job claims, dispatch, repository commands, model calls, compatibility negotiation, capacity reservations, or credential persistence. Online health remains a separate observation.

- Current explicit team admins manage dispatch approval and per-user use grants. Organization ownership alone grants neither administration nor use. Every user, including an admin, needs an explicit use grant.
- Enabling approval and new grants require an enrolled, unrevoked runner. Approval may be given while offline; it is not a readiness claim. A grant may be configured before approval. Withdrawing approval and removing stored grants remain allowed after revocation; removing an absent grant is a no-op and creates no record.
- Grant recipients must be enabled users with active organization and explicit team memberships, currently holding the team admin or developer role. Reviewers/viewers cannot use compute in this increment. Removing an existing grant is allowed even when its recipient is no longer eligible.
- Current user status, organization/team membership, and role narrow every access assessment. A stored grant remains recorded while membership is inactive or the role is ineligible; restoring eligibility restores that grant's effect unless an admin removes it. Future membership-management UI must explain this behavior.
- Revoking a runner irreversibly clears dispatch approval and makes every grant ineffective. Grant records remain as history; an enrolled replacement runner starts unapproved with no grants. Removing approval suspends use without disconnecting the heartbeat process or deleting grants.
- Enrollment, revocation, approval changes, and grant changes share the existing runner lifecycle revision. Heartbeats never advance it. Approval/grant writes require an exact expected lifecycle revision, including no-ops. Stale requests return 409 even if their desired state happens to match; clients refresh and reconcile uncertain responses before another mutation. A current-revision no-op creates neither a revision nor an audit.
- Mutations hold current actor identity/membership locks, recipient locks when granting, then the runner lock; recheck session wall-clock expiry after waits. Runner permission changes serialize on that runner. Persist permission, revision, and safe audit atomically. No secrets or email addresses enter grant responses/audits.

## API and UI

All endpoints use existing human cookies, team scoping, Host/Origin checks, and strict JSON mutations. Machine credentials cannot administer or inspect human grants.

- `POST /api/teams/:teamId/runners/:runnerId/dispatch-approval`: `{ expectedLifecycleRevision, approved }`, returns the ordinary runner response.
- `POST /api/teams/:teamId/runners/:runnerId/grants/:userId`: `{ expectedLifecycleRevision, granted }`, returns the ordinary runner response.
- `GET /api/teams/:teamId/runners/:runnerId/grants?cursor=UUID`: admin-only, at most 50 members ordered by user ID. Includes currently eligible candidates and members with a stored grant record, with display name, role, current eligibility, and stored grant status. Response includes runner metadata/revision and next cursor. No general membership-management endpoint is introduced.
- `GET /api/teams/:teamId/runners/:runnerId/use-access`: active team members inspect only their own stored grant and current use permission. `useAllowed` requires an eligible role, a grant, enrollment, approval, and no runner revocation. It deliberately excludes health, compatibility, and capacity, and is never a dispatch ticket. Future admission/claim operations must reauthorize inside their own transactions.

Compute keeps registration, health, approval, and personal use permission separate. Admins open a paginated access panel to select members and add/remove grants or approve/withdraw approval. Show the exact runner/member in confirmation, block mutation after stale or uncertain results until refresh, clear restricted data on access/session/team loss, and preserve recoverable network errors. No execution controls appear.

## Acceptance cases

Strict request schemas; admin-only writes/roster; no owner bypass; all team/organization/credential-realm boundaries; pending/revoked runner denial; inactive/ineligible recipient denial with removal allowed; self-access narrowing after membership/role/user changes; approval withdrawal and irreversible runner revocation; heartbeat remains independent; matching no-op and stale/uncertain recovery; concurrent permission/revoke writes; actor expiry and recipient changes while waiting on locks; safe audits and rollback; composite database ownership constraints and restricted runtime privileges; UI permission states, pagination, confirmation/cancellation, failed/stale mutations, team/session/access loss, and browser persistence.

Implementation and verification status belong in the dated progress record. A saved permission is not evidence of executed work.
