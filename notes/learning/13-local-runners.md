# Local runner enrollment and health

Recorded 2026-10-15; updated 2026-10-20 (Asia/Kolkata). [Learning index](README.md) · [Contract](../findings/runner-enrollment.md)

Ark's catalogs describe repeatable work: a Workspace supplies repository context, an Agent supplies a role and instructions, and a Flow orders typed steps with explicit version pins. A runner is the local process that will eventually perform authorized work. This first runner increment establishes its identity and connection health. Dispatch approval, compute grants, jobs, repository access, and model calls are separate work.

Enrollment, heartbeats, revocation, and Compute are verified locally. The [October 20 checkpoint](../progress/2026-10-20-01-runner-enrollment.md) records automated and browser acceptance, recovery runs, cleanup, and limits. V0.3 as a whole remains incomplete.

## Connect a runner

After updating the code, use the existing local environment and database volume:

```powershell
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

`db:prepare` applies migration 006 and grants the restricted API role access to runner records. The API does not apply migrations at startup. Open Ark, sign in, select your team, and open **Compute**. A current team admin can enter a runner name and choose **Issue enrollment code**. Developers, reviewers, and viewers can inspect their team's registrations but cannot issue or revoke them.

In another terminal in the Ark project folder:

```powershell
pnpm.cmd runner:local
```

Reveal/select the code in Compute and enter it at the terminal's hidden prompt. The code expires ten minutes after issue. It identifies one runner registration; it is consumed by the first successful credential exchange. Keep the terminal process open. It sends a heartbeat immediately and then every 15 seconds. Use **Refresh runners** to fetch current health.

The foreground process retains its credential only in memory. Restarting it requires a new enrollment; revoke the old registration when it is no longer needed. Stopping the process with Ctrl+C does not revoke its registration. A temporary API restart can recover while the same runner process is alive. Network retries use bounded backoff and stop after ten consecutive failures. Authentication rejection stops the process.

For a disposable verification API, pass only endpoint configuration as arguments:

```powershell
pnpm.cmd runner:local --api http://127.0.0.1:3002 --origin http://127.0.0.1:5184
```

The API and Origin must be loopback HTTP origins, and the server must explicitly allow them. Enter the enrollment code through hidden input or an in-memory stdin pipe. Do not put codes in arguments, environment variables, scripts, notes, screenshots, or shell history.

## Understand the displayed states

| Field             | Meaning                                                                              |
| ----------------- | ------------------------------------------------------------------------------------ |
| Pending           | Issued code has not been consumed and had not expired at the last response.          |
| Expired           | An unused code has passed its ten-minute deadline. Issue a fresh registration.       |
| Enrolled          | The process exchanged the code for its own credential.                               |
| Revoked           | A team admin permanently disabled the code and credential. The record stays visible. |
| Unknown health    | No heartbeat has arrived, or the registration has been revoked.                      |
| Online health     | The server received a heartbeat within the last 60 seconds.                          |
| Offline health    | The latest heartbeat is more than 60 seconds old.                                    |
| Dispatch approval | Always unapproved in this increment. A heartbeat gives no execution permission.      |

Health is a server observation at the displayed response time. Refresh to update it; the page does not poll. A revoked runner's last heartbeat is historical evidence and does not establish whether the computer itself is on or off.

## What happens to the code and credential

```text
Team admin in browser
  -> generate a random enrollment code in memory
  -> authenticated API checks current explicit team-admin membership
  -> PostgreSQL stores the code hash and ten-minute deadline

Foreground runner
  -> read the code through stdin; generate its own random credential
  -> exchange code once through the API
  -> PostgreSQL stores the credential hash atomically with enrollment
  -> authenticated empty heartbeats update server receipt time

Team admin revokes
  -> API checks current membership and expected lifecycle revision
  -> PostgreSQL records revocation
  -> subsequent enrollment/heartbeat authentication is rejected
```

The API stores hashes, never raw codes or credentials. The runner connects to HTTP APIs and has no database connection. An enrolled runner is a team service identity, so its issuer logging out or changing roles does not stop it. An unused code loses authority if its issuer loses active team-admin access. Explicit runner revocation disables an enrolled identity.

## Recover from interruptions

If issuing a code loses its response, **Retry same enrollment** resends the original identity, name, and code. It does not create another registration. The name remains locked until the outcome is resolved. Refresh can inspect registrations after a lost response. The browser exposes the code only after a successful response and masks it by default. Leaving Compute, switching teams, signing out, or reloading discards it; stored hashes cannot recover it.

The foreground client generates its credential before exchanging the code. After a lost exchange response it can prove possession through a heartbeat, allowing recovery when the server committed but the response was lost. It never invents a new credential for an uncertain exchange.

Revocation asks for confirmation. If enrollment changed the lifecycle revision while the page was open, refresh and confirm again. Heartbeats do not change that revision. A retry of an already completed revocation is harmless after current authorization. Offline failures retain loaded metadata and offer retry; access denial clears private runner data.

This increment establishes a local health connection. After its acceptance, the next bounded contract defines dispatch approval and explicit compute grants: which runners can receive work and who may use them. Protected persistent credential storage, compatibility/capacity, and execution also require their own contracts and acceptance evidence. See [current progress](../progress/README.md) for the checks actually completed.
