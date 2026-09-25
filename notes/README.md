# Project notebook

Start with [current progress](progress/README.md) whenever returning to the project. The notebook is divided into folders so explanations, history, and findings can grow without becoming one large file.

```text
notes/
  README.md
  learning/
    README.md
    01-tools-and-workspace.md
    02-frontend-and-data-flow.md
    03-local-database.md
    04-git-and-safe-sync.md
  progress/
    README.md
    2026-09-25-01-bootstrap.md
    2026-09-25-02-notes-organization.md
  findings/
    README.md
    codebase-and-tooling.md
    database.md
    publication-and-git.md
```

| Folder | Purpose | How it grows |
| --- | --- | --- |
| [Learning](learning/README.md) | Explain concepts, commands, and flows for future reading | Add one guide per topic or feature |
| [Progress](progress/README.md) | Current checkpoint, actual checks, chronological changes, next step | Add a dated file per meaningful step; keep the index current |
| [Findings](findings/README.md) | Durable facts, decisions, constraints, unresolved questions | Add or revise focused topic files with evidence |

## Source of truth

```text
Actual code/config + reproducible checks -> what exists and works
notes/progress/README.md                 -> current verified checkpoint
notes/progress/YYYY-MM-DD-NN-topic.md     -> dated history and evidence
notes/findings/                          -> facts, decisions, open questions
docs/architecture.md + docs/roadmap.md    -> intended future behavior
notes/learning/                          -> explanations for future reading
Git commits                             -> exact history of recorded changes
```

If these disagree, inspect the code/checks and update the notes explicitly. A plan is not evidence of implemented behavior. Historical entries retain their date and limitations.

## Recording a new step

```text
Date / step:
Purpose:
Changed files:
Behavior or configuration change:
Checks actually run and results:
Skipped checks / limitations:
Decision or finding links:
Next bounded step:
Commit reference (once known):
```

Use descriptive filenames and update the relevant index when adding a page. Keep the current-state index short; put detailed evidence in the dated log. Split a topic further when it becomes difficult to scan. Link to an existing fact instead of duplicating it across many pages.

Never record secrets, full credential-bearing connection strings, private service links, or resolved environment dumps. Local private research stays outside this published notebook; the public architecture and roadmap are self-contained.
