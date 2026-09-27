# Your first working Ark feature

Updated 2026-09-26. [Learning index](README.md) | [Current progress](../progress/README.md)

## What changed, step by step

1. **A shared contract defines each form.** `packages/contracts` describes the names, email, password, and response fields. Both the browser and API validate input against these rules. Adding an unexpected field such as `role: owner` cannot grant authority.
2. **A migration defines durable storage.** `packages/db/migrations/001_identity.sql` creates organizations, users, teams, memberships, login sessions, the one-time setup marker, and audit events. The migration ledger stores a checksum so an applied migration cannot silently change.
3. **The API connects the UI to PostgreSQL.** `apps/api` handles setup, sign-in, sign-out, current identity, and authorized team reads. Your browser never receives database credentials.
4. **Setup creates the first records together.** A database transaction commits the organization, owner, first team, memberships, and login session as one operation. If a later write fails, all earlier writes roll back. Two competing setup requests cannot each create an organization.
5. **The browser receives a protected login cookie.** The password is hashed with Argon2id; it is not stored as plain text. The cookie contains an unpredictable token, and the database stores only its hash. Reloading the page asks the API to validate this cookie and restore your identity.
6. **Team access is checked by the API.** Choosing a team in the dropdown is a preference. It cannot grant membership. Even the organization owner cannot read a team without an explicit active membership.
7. **Checks exercise real failure cases.** The tests prove one-time setup, rollback, persistence after an API process restart, two-team isolation, session revocation, and last-owner protection. Browser checks exercise the actual forms and layout.

```text
Browser at 127.0.0.1:5173
  -> Vite forwards /api
  -> Fastify at 127.0.0.1:3001 validates input and permissions
  -> PostgreSQL at 127.0.0.1:5434 persists the records
  -> API returns allowed fields; browser updates its screen
```

## Start it on your existing checkout

Start Docker Desktop, then run from `D:\Coding\ONGOING\ark`:

```powershell
pnpm.cmd install --frozen-lockfile
pnpm.cmd db:up
pnpm.cmd db:prepare
pnpm.cmd dev
```

Open **http://127.0.0.1:5173**. The setup form asks for your name, email, a password of at least 12 characters, an organization name, and a first team name. For example, organization `My Studio` and team `Platform` describe your own installation. Choose your own password; do not put it in Git or a chat message.

The first successful setup signs you in. Later visits show login when no valid cookie exists. The account menu contains **Sign out**. The current cookie lasts up to 12 hours and logout revokes its database record. There is no password-reset UI yet, so retain your chosen login securely. No real development owner was created during implementation; test accounts live only in disposable `ark_test` schemas.

For a fresh clone, run `pnpm.cmd setup:env` and `pnpm.cmd hooks:install` before the database steps. Never replace a working `.env` when reusing an initialized database volume.

## Understand the two database roles

| Local setting            | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`      | Existing bootstrap role password used by Compose initialization                    |
| `MIGRATION_DATABASE_URL` | Local administrative connection for schema migrations and development provisioning |
| `DATABASE_URL`           | API connection as the restricted `ark_app` role                                    |
| `TEST_DATABASE_URL`      | Administrative fixture connection to separate local `ark_test`                     |

`db:prepare` preserves the older administrative connection, creates a random runtime credential, and records both locally without printing their values. Running it again checks migrations and grants without rotating credentials. The runtime can use its assigned tables but cannot create tables or alter/delete audit records. This privilege boundary does not replace API permission checks.

## Daily work and verification

```powershell
pnpm.cmd dev
# Stop the API and web processes with Ctrl+C.
pnpm.cmd db:stop
```

For code checks:

```powershell
pnpm.cmd build
pnpm.cmd typecheck
pnpm.cmd lint
pnpm.cmd test:unit
pnpm.cmd db:test:prepare
pnpm.cmd test:integration
pnpm.cmd test:guard
```

`db:test:prepare` creates the dedicated test database if absent; tests use unique schemas there and remove those schemas afterwards. They reject a URL pointing to `ark_dev`. A killed test process may leave its own schema behind; inspect it before targeted cleanup. Never clear your development database to rerun setup tests.

## What the workspace currently means

The Sessions screen displays your saved organization, selected team, and roles. It states that execution is coming later. [Workspaces](07-workspaces.md) and [Agents](08-agents.md) have versioned configuration forms. Flows, compute, and secrets remain planned navigation entries. Invitations, password recovery, member administration, and real agent execution are also future work. The next bounded increment adds ordered flows with authorized resource references.

Keep this version on your own computer's loopback address. A hosted installation needs its own HTTPS, secure-cookie, trusted-origin, operational, and access-management work.
