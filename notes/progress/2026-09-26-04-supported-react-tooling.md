# Verify React tooling and record maintenance policy

Recorded 2026-09-26 (Asia/Kolkata). [Current progress](README.md)

## Purpose and result

The user asked whether Ark uses deprecated Create React App and explicitly required maintained technology. Source and lockfile inspection confirmed React 19.3.0, Vite 8.3.1, `@vitejs/plugin-react` 6.1.1, and Vite development/build/preview scripts. No `create-react-app` or `react-scripts` dependency was found. React's `createRoot()` rendering API is a separate concept from the CRA scaffolder.

Official React documentation confirms CRA's deprecation for new applications and documents Vite as a supported build-tool choice. Those references were checked live. No frontend migration or application change was necessary.

## Files and checks

- Expanded `notes/learning/01-tools-and-workspace.md` with the React/Vite flow, the `createRoot` distinction, and official documentation links.
- Added F009 to `notes/findings/codebase-and-tooling.md` and its index: avoid deprecated/end-of-life technology; verify maintenance status and compatibility before adopting or upgrading dependencies.
- Updated the progress index. Base commit: `a0afcf1` (architecture review).
- Read-only checks covered the web manifest, Vite configuration, HTML entrypoint, React entrypoint, and dependency lockfile; an independent read-only review confirmed the toolchain.
- Documentation-only change: application test suites were not rerun. Local Markdown links, staged whitespace, and the required publication guard are checked before committing.

This is a targeted React-tooling verification, not a complete lifecycle audit of transitive dependencies. Existing automated application verification remains the [architecture-review checkpoint](2026-09-26-03-architecture-review.md).

## Next step and Git record

The next implementation remains the first V0.2 team-owned workspace increment. Apply the maintenance policy when selecting its dependencies. This note belongs to the documentation commit `docs: clarify Vite setup and supported tooling policy`; use Git history for its resolved hash and synchronization state.
