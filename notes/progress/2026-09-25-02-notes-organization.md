# 2026-09-25 - Organize notes for future growth

[Current progress](README.md)

## Purpose

The user requested separate folders and topic files for learning, progress, and findings so the notebook stays usable as the codebase grows.

## Changes

- Split the original learning guide into tools/workspace, frontend/data flow, database/daily commands, and Git/synchronization guides.
- Split findings into codebase/tooling, database, and publication/Git topics while retaining the finding identifiers.
- Separated the current checkpoint from dated progress records. Preserved the initial bootstrap, checks, and successful GitHub synchronization evidence in its own historical entry.
- Added folder indexes, updated all inbound links, and changed contributor instructions to maintain the folder structure for future work.
- Kept application code, credentials, and database data unchanged during this documentation reorganization.

## Verification and publication

All 48 local Markdown links across 17 public documents resolve after the move; no stale paths to the removed notes remain. Independent review confirmed that learning topics, F001-F007, open decisions, and historical evidence were preserved. The staged-file credential guard passed for the 17 added/modified files. Build/lint and all seven guard tests passed during the earlier bootstrap recording; this docs-only change does not imply new application testing.

The first three commits through `7271c36` were already on GitHub before this reorganization. Follow-up publication status belongs in the progress index, not inferred from local files. A previous follow-up commit/push did not execute because its automatic approval review could not complete; subsequent approved Git permissions allowed the reviewed work to continue.

## Next step

Complete the reviewed documentation commit/sync, then begin the bounded V0.1 identity slice when requested. Keep each future step in its own dated file and add focused learning/findings pages as needed.
