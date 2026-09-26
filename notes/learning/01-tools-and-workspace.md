# Tools and workspace

Updated 2026-09-26. [Learning index](README.md) | [Current progress](../progress/README.md)

## What happened so far

The assistant provided bootstrap instructions. You ran the installation and project setup commands yourself. The files now present show that a pnpm workspace, a React/Vite starter and a PostgreSQL Compose configuration were created. This does not establish that every proposed command ran successfully; each check has its own evidence.

You reported that Docker could not bind host port `5433`. You then used Docker assistance to change that port to `5434`, and showed PostgreSQL `17.11` running with a healthy container. Follow-up checks independently confirmed PostgreSQL `17.11`, the healthy container and the `127.0.0.1:5434` host mapping. Node `24.21` and pnpm `10.34.5` were also checked in the local terminal.

The first follow-up added development commands and notes. The next increment replaced the starter with working setup/login forms, a Fastify API, and database-backed identity records. See [identity and sessions](05-identity-and-sessions.md) for that implementation.

## What each tool does

| Tool or file   | Purpose in Ark                                                                                                       |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| Node.js        | Runs JavaScript tools and the API outside the browser. The runner comes later. The root manifest requires Node 24.15 or newer within 24.x, including the DOM test toolchain. |
| TypeScript     | Adds static checks to application code. A `.tsx` file is TypeScript that can contain React UI markup.                |
| pnpm           | Installs dependencies and runs package scripts. The root manifest pins pnpm `10.34.5`.                               |
| pnpm workspace | Groups several related packages in one repository and lets them share a lockfile and local dependencies.             |
| React          | Builds the interactive interface that executes in the browser.                                                       |
| Vite           | Serves the frontend during development and builds assets for production.                                             |
| Docker Desktop | Provides the container runtime used to run PostgreSQL locally.                                                       |
| Docker Compose | Reads the database service configuration and manages its container, port and volume.                                 |
| PostgreSQL     | Stores organizations, users, teams, memberships, login sessions, and audit records.                                  |
| Git            | Records selected file changes in local commits.                                                                      |
| GitHub         | Hosts the repository and its pushed Git history. It does not automatically run this application.                     |

The `.cmd` suffix selects the Windows launcher for npm/pnpm. It avoids accidentally selecting a PowerShell script launcher when local execution policy blocks that launcher; it does not change execution policy.

## React, Vite, and Create React App

Ark uses React with TypeScript and Vite. `apps/web/package.json` runs `vite` for development and `tsc -b && vite build` for production. `apps/web/vite.config.ts` enables `@vitejs/plugin-react` and forwards API requests to the separate Fastify backend. The lockfile currently resolves React 19.3.0 and Vite 8.3.1.

`createRoot()` in `apps/web/src/main.tsx` is React DOM's browser-rendering API: it mounts the application into the root element in `index.html`. It is unrelated to the `create-react-app` scaffolding tool. Neither `create-react-app` nor `react-scripts` is present in the project manifests or lockfile.

React [deprecated Create React App for new applications](https://react.dev/blog/2025/02/14/sunsetting-create-react-app) on February 14, 2025. React's [build-from-scratch guide](https://react.dev/learn/build-a-react-app-from-scratch) documents Vite as an option; frameworks are also supported choices. Ark's separate browser frontend and Fastify API already use the Vite approach, so no migration is needed. See the [Vite guide](https://vite.dev/guide/) and [React rendering reference](https://react.dev/reference/react-dom/client/createRoot).

The user explicitly requires maintained, supported technology. Before adopting or upgrading tooling, check official maintenance/deprecation status and compatibility with the project's pinned versions. A version older than the newest release is not automatically end-of-life; supported releases and reproducible checks matter. Do not introduce deprecated scaffolding or knowingly end-of-life dependencies.

## Understand the project files

[`package.json`](../../package.json) at the root describes shared project requirements and tooling. Immediately after the manual bootstrap, it had no root scripts. The follow-up setup adds these commands so you can work from the repository root:

| Root command            | Purpose                                                                        |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm.cmd dev`          | Build shared packages and start API and web development servers.               |
| `pnpm.cmd build`        | Build every workspace package in dependency order.                             |
| `pnpm.cmd lint`         | Run Oxlint across apps, shared packages, tests, and scripts.                   |
| `pnpm.cmd typecheck`    | Check strict package and test TypeScript.                                      |
| `pnpm.cmd db:prepare`   | Apply migrations and configure the local runtime role.                         |
| `pnpm.cmd db:up`        | Start the configured PostgreSQL service.                                       |
| `pnpm.cmd db:stop`      | Stop the database service while retaining its data.                            |
| `pnpm.cmd db:status`    | Show the database service status.                                              |
| `pnpm.cmd setup:env`    | Generate local environment configuration when needed through the setup helper. |
| `pnpm.cmd check:staged` | Check staged files for secret patterns before committing.                      |

[`scripts/setup-env.mjs`](../../scripts/setup-env.mjs) is a repeatable setup helper: rerunning it preserves existing local configuration rather than replacing credentials. Generated secret values belong in the ignored local environment file, not in Git. Review the staged-file check's output before committing; a successful automated check is not a guarantee that every possible sensitive value has been recognized.

[`pnpm-workspace.yaml`](../../pnpm-workspace.yaml) includes `apps/web`, `apps/api`, `packages/contracts`, and `packages/db`. Shared contracts run in the frontend and backend; the database package stays on the server/tooling side.

[`apps/web/package.json`](../../apps/web/package.json) declares the frontend's dependencies and runnable scripts:

| Script    | Current command        | What it checks or starts                                  |
| --------- | ---------------------- | --------------------------------------------------------- |
| `dev`     | `vite`                 | Frontend development server.                              |
| `build`   | `tsc -b && vite build` | TypeScript project checks followed by the frontend build. |
| `lint`    | `oxlint`               | Lint checks configured by the current starter.            |
| `preview` | `vite preview`         | Local preview of an already-built frontend.               |

The starter currently uses Oxlint. These notes describe the actual lint command rather than assuming a different tool was configured.

[`pnpm-lock.yaml`](../../pnpm-lock.yaml) records resolved dependency versions. Some package manifest entries allow a range of versions; the lockfile captures the actual selected versions. Commit the lockfile so other installations can reproduce those resolutions.

`node_modules` contains installed dependency files. It can be recreated from package manifests and the lockfile and is ignored by Git. `apps/web/dist` is generated build output and is also ignored.

The root manifest declares Vitest, Playwright and Prettier. There are now contract unit tests and real PostgreSQL integration tests. Browser acceptance uses a documented Playwright CLI walkthrough, not an automated browser suite. A frontend build alone does not prove authentication or database behavior.
