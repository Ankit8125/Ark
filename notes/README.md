# Project notebook

This folder keeps the project understandable across development sessions.

| File | Purpose | When to update |
| --- | --- | --- |
| [learning-guide.md](learning-guide.md) | Explain the setup, commands, concepts, and flow with examples | When a new concept or workflow is introduced |
| [progress.md](progress.md) | Current checkpoint, dated changes, verification results, next step | Every meaningful development step |
| [findings.md](findings.md) | Durable codebase facts, decisions, caveats, and unresolved questions | When evidence changes our understanding |

Read progress first when returning to work. Read the learning guide when you want to understand why a command or component exists. Consult findings before making a change that depends on earlier decisions.

## How the source of truth works

```text
Actual code/config + reproducible checks -> what exists and works
notes/progress.md                       -> current verified checkpoint
notes/findings.md                       -> facts, decisions, open questions
docs/architecture.md + docs/roadmap.md   -> intended future behavior
notes/learning-guide.md                 -> explanations for future reading
Git commits                            -> exact history of recorded changes
```

These roles avoid treating a design proposal as implemented code. If they disagree, inspect the code/checks and update the notes explicitly. Historical entries retain their date and limitations.

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

Never record secrets, full credential-bearing connection strings, private service links, or resolved environment dumps. Use placeholders and safe metadata such as the database host port. Local private research is intentionally outside the published notebook; the public architecture and roadmap are self-contained.
