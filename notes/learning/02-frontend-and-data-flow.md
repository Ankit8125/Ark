# Frontend and application data flow

Updated 2026-09-26. [Learning index](README.md) | [Current progress](../progress/README.md)

## From your terminal to a working page

Run `pnpm.cmd dev` from the repository root. It builds the shared packages, then starts the API and Vite frontend together. Open **http://127.0.0.1:5173**. Keep the terminal running; Ctrl+C stops both processes.

```text
apps/web/index.html
  -> src/main.tsx mounts React
  -> src/App.tsx checks setup status and the current login
  -> src/AuthPage.tsx or src/Shell.tsx displays the result
```

On a new installation, the API reports that setup is required. The browser shows a form for owner, organization, and first team. After setup, the API validates the login cookie and returns allowed user and team details. A missing or expired cookie leads to login.

## One actual request

```text
Create organization button
  -> browser validates packages/contracts schema
  -> POST /api/bootstrap through the Vite proxy
  -> Fastify independently validates the request
  -> database transaction creates related identity records
  -> API sets a protected cookie and returns current identity
  -> React opens /sessions and checks the selected team
```

The form does not write directly to PostgreSQL. Database URLs stay in the server's environment. Passwords are hashed before storage. Browser JavaScript cannot read the HttpOnly cookie. Local storage holds only a selected team ID, never an authentication token.

The counter page from the scaffold is gone. Organization, identity, and membership records survive a reload and API process restart because PostgreSQL stores them. Unsaved form fields remain temporary.

## Development and production output

Vite updates the frontend after source edits. The API development process restarts for its own source edits. After changing shared package source, rerun `pnpm.cmd build:shared` and restart development so both sides use rebuilt packages.

`pnpm.cmd build` generates compiled API/shared files and frontend assets. It does not deploy a site. `pnpm.cmd --dir apps/web preview` can inspect static output but has no API proxy. Use `pnpm.cmd dev` for the working authenticated local application.

Read [identity and sessions](05-identity-and-sessions.md) for commands and permissions. The next increment adds team-owned workspace editing; execution and AI calls remain later work.
