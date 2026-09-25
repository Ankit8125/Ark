# Publication and Git findings

Recorded 2026-09-25. [Findings index](README.md)

## F005 - Public publication excludes private research

The destination repository is public. Four original root planning/research documents contain private-service references or internal research context. They remain unchanged and ignored locally. Removing only URLs would not necessarily remove confidential observations.

Public `docs/architecture.md` and `docs/roadmap.md` state the independent project design without those sources. Code/config/tests and the notebook are the published working context. Do not upload the excluded originals or copy their private passages into commits, issues, logs, or notes.


## F007 - Git safety is layered and local hooks are not automatic on clones

`.gitignore` excludes local/private material; the pre-commit hook scans the Git index; review of the staged diff remains required. The guard detects selected token formats, credential-bearing URLs, known local `.env` values, and forbidden paths. It is not an exhaustive content-classification system, encoded-secret detector, or organizational data-loss-prevention product.

Run `pnpm.cmd hooks:install` in every new clone. For the initial reviewed commits, a repository-local GitHub noreply identity avoids publishing the configured personal email; global Git settings remain unchanged.

Source and safe configuration belong in Git. Installed dependencies, build outputs, logs, database contents, credentials, and private research do not. Each meaningful step should include updated notes and actual check results. Git records the tracked files only; the local environment-port correction is described without committing its secret-bearing file.
