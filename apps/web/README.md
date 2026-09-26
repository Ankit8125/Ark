# Ark web

React/Vite frontend for the local identity foundation. Start the full application from the repository root with `pnpm.cmd dev`; setup and role-aware commands are documented in the [root README](../../README.md).

- `src/App.tsx`: setup/session guards and routing.
- `src/AuthPage.tsx`: shared-contract setup/login forms and accessible errors.
- `src/Shell.tsx`: explicit team access, current context, account menu, honest future-feature states.
- `src/api.ts`: validated API responses and same-origin cookie requests.
- `src/index.css` and `src/App.module.css`: tokens and responsive components.

The Vite server binds 127.0.0.1:5173 and proxies /api to 127.0.0.1:3001. It refuses to silently choose another port because the API enforces exact browser origins. `ARK_API_TARGET` is an optional loopback-only proxy override for browser fixtures. Static preview has no API proxy.

Use root build, typecheck, lint, and test commands. See [browser verification](../../notes/findings/browser-verification.md) for acceptance evidence. There is no runner or session-execution UI yet.
