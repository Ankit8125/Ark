# Git history and safe synchronization

Recorded 2026-09-25. [Learning index](README.md) | [Current progress](../progress/README.md)

## How Git and GitHub fit in

Editing a file changes your working copy. Staging selects changes for the next commit. Committing records a local snapshot. Pushing sends commits to the configured GitHub repository.

Source files, package manifests, the lockfile, safe configuration and these notes belong in version control. Local secrets, `node_modules`, generated output and PostgreSQL's data volume do not. A Git push is not a database backup, and it does not deploy the app or transfer your running containers.

Keep future notes concrete: what changed, the command or check used, its result, and what remains unverified. Do not copy passwords or credential-bearing connection strings into them.
