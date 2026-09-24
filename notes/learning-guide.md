# Ark learning guide

This guide explains the starter that you created on Windows and how its pieces fit together. It records the state inspected on 2026-09-25. Use the separate progress and findings notes for later changes and check results.

## 1. What happened so far

The assistant provided bootstrap instructions. You ran the installation and project setup commands yourself. The files now present show that a pnpm workspace, a React/Vite starter and a PostgreSQL Compose configuration were created. This does not establish that every proposed command ran successfully; each check has its own evidence.

You reported that Docker could not bind host port `5433`. You then used Docker assistance to change that port to `5434`, and showed PostgreSQL `17.11` running with a healthy container. Follow-up checks independently confirmed PostgreSQL `17.11`, the healthy container and the `127.0.0.1:5434` host mapping. Node `24.21` and pnpm `10.34.5` were also checked in the local terminal.

The follow-up work adds convenient root commands and local setup helpers to the starter. These are small development-support changes; they do not implement application features.

The current frontend source defines Vite's starter page and a counter. It has no API, login, team management or database-backed application records yet.

## 2. Follow the path from your command to the browser

When you run this from the repository root:

```powershell
pnpm.cmd --dir apps/web dev
```

1. PowerShell starts pnpm's Windows command launcher.
2. `--dir apps/web` tells pnpm which package to work in.
3. pnpm reads that package's `dev` script, which is `vite`.
4. Node.js runs Vite on your computer.
5. Vite serves the web page and development assets to your browser.
6. The browser executes the React application and draws the interface.

The terminal prints the URL to open, normally `http://localhost:5173`. Keep that terminal running while you use the development server. Press `Ctrl+C` to stop it. Saving a frontend file triggers Vite's development update process.

The entry path is:

```text
apps/web/index.html
  -> apps/web/src/main.tsx
  -> apps/web/src/App.tsx
  -> the page in your browser
```

[`main.tsx`](../apps/web/src/main.tsx) connects React to the page's root element. [`App.tsx`](../apps/web/src/App.tsx) defines the current page. Its counter uses React state held in browser memory; reloading the page resets it. No PostgreSQL write happens when you click it.

## 3. What each tool does

| Tool or file | Purpose in Ark |
| --- | --- |
| Node.js | Runs JavaScript tools and, later, the API and runner outside the browser. The root manifest requires Node 24.x. |
| TypeScript | Adds static checks to application code. A `.tsx` file is TypeScript that can contain React UI markup. |
| pnpm | Installs dependencies and runs package scripts. The root manifest pins pnpm `10.34.5`. |
| pnpm workspace | Groups several related packages in one repository and lets them share a lockfile and local dependencies. |
| React | Builds the interactive interface that executes in the browser. |
| Vite | Serves the frontend during development and builds assets for production. |
| Docker Desktop | Provides the container runtime used to run PostgreSQL locally. |
| Docker Compose | Reads the database service configuration and manages its container, port and volume. |
| PostgreSQL | Stores durable records in tables. The server is running before Ark has defined its own tables. |
| Git | Records selected file changes in local commits. |
| GitHub | Hosts the repository and its pushed Git history. It does not automatically run this application. |

The `.cmd` suffix selects the Windows launcher for npm/pnpm. It avoids accidentally selecting a PowerShell script launcher when local execution policy blocks that launcher; it does not change execution policy.

## 4. Understand the project files

[`package.json`](../package.json) at the root describes shared project requirements and tooling. Immediately after the manual bootstrap, it had no root scripts. The follow-up setup adds these commands so you can work from the repository root:

| Root command | Purpose |
| --- | --- |
| `pnpm.cmd dev` | Start the web package's Vite development server. |
| `pnpm.cmd build` | Run the web package's TypeScript checks and build. |
| `pnpm.cmd lint` | Run the web package's lint checks. |
| `pnpm.cmd db:up` | Start the configured PostgreSQL service. |
| `pnpm.cmd db:stop` | Stop the database service while retaining its data. |
| `pnpm.cmd db:status` | Show the database service status. |
| `pnpm.cmd setup:env` | Generate local environment configuration when needed through the setup helper. |
| `pnpm.cmd check:staged` | Check staged files for secret patterns before committing. |

[`scripts/setup-env.mjs`](../scripts/setup-env.mjs) is a repeatable setup helper: rerunning it preserves existing local configuration rather than replacing credentials. Generated secret values belong in the ignored local environment file, not in Git. Review the staged-file check's output before committing; a successful automated check is not a guarantee that every possible sensitive value has been recognized.

[`pnpm-workspace.yaml`](../pnpm-workspace.yaml) includes packages under `apps/*` and `packages/*`. `apps/web` is the only application package currently present. `packages` is currently empty. Creating a directory alone does not create an application or a reusable package.

[`apps/web/package.json`](../apps/web/package.json) declares the frontend's dependencies and runnable scripts:

| Script | Current command | What it checks or starts |
| --- | --- | --- |
| `dev` | `vite` | Frontend development server. |
| `build` | `tsc -b && vite build` | TypeScript project checks followed by the frontend build. |
| `lint` | `oxlint` | Lint checks configured by the current starter. |
| `preview` | `vite preview` | Local preview of an already-built frontend. |

The starter currently uses Oxlint. These notes describe the actual lint command rather than assuming a different tool was configured.

[`pnpm-lock.yaml`](../pnpm-lock.yaml) records resolved dependency versions. Some package manifest entries allow a range of versions; the lockfile captures the actual selected versions. Commit the lockfile so other installations can reproduce those resolutions.

`node_modules` contains installed dependency files. It can be recreated from package manifests and the lockfile and is ignored by Git. `apps/web/dist` is generated build output and is also ignored.

The root manifest declares Vitest, Playwright and Prettier. Their presence means those tools are available as project dependencies after a successful installation. It does not mean Ark already has unit tests, browser tests, formatting scripts or a configured test suite. A successful frontend build also does not prove authentication or database behavior.

## 5. Understand the database container

[`infra/local/compose.yaml`](../infra/local/compose.yaml) describes one service named `postgres`:

- `image: postgres:17` selects the PostgreSQL 17 image series. A fresh pull can select a newer 17.x patch; this tag is not a fixed image digest.
- `POSTGRES_USER: ark` and `POSTGRES_DB: ark_dev` configure the initial database user and database.
- `POSTGRES_PASSWORD` is read from your local environment file. Its actual value belongs outside committed notes and source code.
- The health check runs `pg_isready` inside the container.
- A named volume stores PostgreSQL's files at `/var/lib/postgresql/data`, the correct default data mount for this PostgreSQL 17 image.

The port mapping has three parts:

```text
127.0.0.1 : 5434 : 5432
   |         |      |
   |         |      +-- PostgreSQL port inside the container
   |         +--------- port you connect to from Windows
   +------------------- bind only to this computer's loopback interface
```

Changing `5433` to `5434` changed the Windows-side listening port. PostgreSQL still listens on `5432` inside the container. A future API running directly on Windows must connect to `127.0.0.1:5434`. If the API later runs as another service on the same Compose network, its database address would normally be `postgres:5432` instead.

The reported port error establishes that Docker could not bind `5433`. By itself, it does not establish whether Windows had reserved that port or some other condition prevented binding. Changing to an available port allowed this setup to proceed.

The follow-up review also found that the local database connection URL still referred to `5433` after Compose had changed to `5434`. The host-side URL must match `5434` as well. Aligning its port is a configuration correction; it does not require changing the existing username or password. The values themselves are intentionally absent from these notes.

The database credentials in an environment file must match the credentials that initialized the data volume. Changing a password variable later does not automatically change an existing database user's password.

### Three checks prove different things

1. A healthy container means its configured readiness probe succeeded.
2. `psql` run through `docker compose exec` can prove the database accepts an internal connection and can execute SQL. Without a host argument, it generally uses a local socket inside the container and may not need the password used by a Windows client.
3. A real database connection from Windows to `127.0.0.1:5434`, using the intended application credentials, proves the host port and those credentials together. The eventual API needs this check too.

Therefore, successful internal `SELECT version()` output does not by itself prove that a future API can connect or authenticate. A TCP port check proves reachability, but also does not validate a database password.

## 6. Current setup and future data flow

What exists today:

```text
PowerShell -> pnpm -> Node.js -> Vite -> browser -> React starter

Docker Desktop -> PostgreSQL container -> persistent named volume

The React starter and PostgreSQL have no application connection yet.
```

The intended flow after the API is implemented:

```text
Browser / React UI
       |
       | HTTP request
       v
Fastify API running on Windows
       |
       | validate input, authenticate, check permissions
       | database connection to 127.0.0.1:5434
       v
Docker port forwarding
       |
       | container port 5432
       v
PostgreSQL -> tables -> persistent named volume

Result returns through the API to the browser.
```

For example, a future "Create team" form could send a name to the API. The API would check the signed-in user's permission, validate the name, write a row and return the saved record. The UI would display that record. This is a conceptual example of the planned architecture; that form, route, permission check and table have not been implemented.

Database credentials belong to the backend. The browser communicates with the API rather than connecting directly to PostgreSQL.

## 7. Useful commands for the current starter

Run these in PowerShell from the repository root. They refer to the root `.env` file without printing its values. Start Docker Desktop before database commands.

Check the tools selected by your current terminal:

```powershell
node --version
pnpm.cmd --version
docker --version
docker compose version
```

Create local environment configuration on a new checkout, then start or inspect the configured database:

```powershell
pnpm.cmd setup:env
pnpm.cmd db:up
pnpm.cmd db:status
docker compose --env-file .env -f infra/local/compose.yaml exec postgres psql -U ark -d ark_dev -c "SELECT version();"
Test-NetConnection -ComputerName 127.0.0.1 -Port 5434
```

The SQL command checks the database internally. `Test-NetConnection` checks the Windows-side TCP endpoint. See the three-check distinction above before interpreting their results.

Run frontend checks and start development:

```powershell
pnpm.cmd lint
pnpm.cmd build
pnpm.cmd dev
```

After a successful build, you can run `pnpm.cmd --dir apps/web preview` in a separate terminal to inspect the built frontend. Preview is a local build-checking server, not the planned production deployment.

Stop the database while retaining its data:

```powershell
pnpm.cmd db:stop
```

`docker compose down` removes the containers and network but normally retains the named volume. Adding `-v` removes that volume and its database data, so it is not a routine shutdown command.

## 8. How Git and GitHub fit in

Editing a file changes your working copy. Staging selects changes for the next commit. Committing records a local snapshot. Pushing sends commits to the configured GitHub repository.

Source files, package manifests, the lockfile, safe configuration and these notes belong in version control. Local secrets, `node_modules`, generated output and PostgreSQL's data volume do not. A Git push is not a database backup, and it does not deploy the app or transfer your running containers.

Keep future notes concrete: what changed, the command or check used, its result, and what remains unverified. Do not copy passwords or credential-bearing connection strings into them.

## 9. The next implementation milestone

This setup is a starting environment. The public [architecture](../docs/architecture.md) explains the intended components, and the [roadmap](../docs/roadmap.md) describes their implementation order. The V0.1 foundation still requires:

1. Shared configuration and schemas for validated data contracts.
2. Database migration tooling and tables for organizations, users, memberships, sessions, the bootstrap marker and initial audit records.
3. A Fastify API with health/readiness endpoints and database access.
4. One-time owner setup, password hashing, protected sessions and permission checks.
5. Setup/login screens, the application shell and current-user/team state backed by that API.
6. Checks that setup survives a restart, cannot run twice, rejects unauthenticated access, isolates teams and prevents orphaning an organization.

The runner, workflow engine, real AI adapter and GitHub publication actions belong to later increments. The first milestone is complete only when its actual behavior and acceptance checks exist and pass.
