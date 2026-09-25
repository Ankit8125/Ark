# Tools and workspace

Recorded 2026-09-25. [Learning index](README.md) | [Current progress](../progress/README.md)

## What happened so far

The assistant provided bootstrap instructions. You ran the installation and project setup commands yourself. The files now present show that a pnpm workspace, a React/Vite starter and a PostgreSQL Compose configuration were created. This does not establish that every proposed command ran successfully; each check has its own evidence.

You reported that Docker could not bind host port `5433`. You then used Docker assistance to change that port to `5434`, and showed PostgreSQL `17.11` running with a healthy container. Follow-up checks independently confirmed PostgreSQL `17.11`, the healthy container and the `127.0.0.1:5434` host mapping. Node `24.21` and pnpm `10.34.5` were also checked in the local terminal.

The follow-up work adds convenient root commands and local setup helpers to the starter. These are small development-support changes; they do not implement application features.

The current frontend source defines Vite's starter page and a counter. It has no API, login, team management or database-backed application records yet.


## What each tool does

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


## Understand the project files

[`package.json`](../../package.json) at the root describes shared project requirements and tooling. Immediately after the manual bootstrap, it had no root scripts. The follow-up setup adds these commands so you can work from the repository root:

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

[`scripts/setup-env.mjs`](../../scripts/setup-env.mjs) is a repeatable setup helper: rerunning it preserves existing local configuration rather than replacing credentials. Generated secret values belong in the ignored local environment file, not in Git. Review the staged-file check's output before committing; a successful automated check is not a guarantee that every possible sensitive value has been recognized.

[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) includes packages under `apps/*` and `packages/*`. `apps/web` is the only application package currently present. `packages` is currently empty. Creating a directory alone does not create an application or a reusable package.

[`apps/web/package.json`](../../apps/web/package.json) declares the frontend's dependencies and runnable scripts:

| Script | Current command | What it checks or starts |
| --- | --- | --- |
| `dev` | `vite` | Frontend development server. |
| `build` | `tsc -b && vite build` | TypeScript project checks followed by the frontend build. |
| `lint` | `oxlint` | Lint checks configured by the current starter. |
| `preview` | `vite preview` | Local preview of an already-built frontend. |

The starter currently uses Oxlint. These notes describe the actual lint command rather than assuming a different tool was configured.

[`pnpm-lock.yaml`](../../pnpm-lock.yaml) records resolved dependency versions. Some package manifest entries allow a range of versions; the lockfile captures the actual selected versions. Commit the lockfile so other installations can reproduce those resolutions.

`node_modules` contains installed dependency files. It can be recreated from package manifests and the lockfile and is ignored by Git. `apps/web/dist` is generated build output and is also ignored.

The root manifest declares Vitest, Playwright and Prettier. Their presence means those tools are available as project dependencies after a successful installation. It does not mean Ark already has unit tests, browser tests, formatting scripts or a configured test suite. A successful frontend build also does not prove authentication or database behavior.
