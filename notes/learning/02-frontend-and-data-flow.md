# Frontend and application data flow

Recorded 2026-09-25. [Learning index](README.md) | [Current progress](../progress/README.md)

## Follow the path from your command to the browser

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

[`main.tsx`](../../apps/web/src/main.tsx) connects React to the page's root element. [`App.tsx`](../../apps/web/src/App.tsx) defines the current page. Its counter uses React state held in browser memory; reloading the page resets it. No PostgreSQL write happens when you click it.


## Current setup and future data flow

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


## The next implementation milestone

This setup is a starting environment. The public [architecture](../../docs/architecture.md) explains the intended components, and the [roadmap](../../docs/roadmap.md) describes their implementation order. The V0.1 foundation still requires:

1. Shared configuration and schemas for validated data contracts.
2. Database migration tooling and tables for organizations, users, memberships, sessions, the bootstrap marker and initial audit records.
3. A Fastify API with health/readiness endpoints and database access.
4. One-time owner setup, password hashing, protected sessions and permission checks.
5. Setup/login screens, the application shell and current-user/team state backed by that API.
6. Checks that setup survives a restart, cannot run twice, rejects unauthenticated access, isolates teams and prevents orphaning an organization.

The runner, workflow engine, real AI adapter and GitHub publication actions belong to later increments. The first milestone is complete only when its actual behavior and acceptance checks exist and pass.
