# Repository agent guide

This file applies to the entire repository. Keep it short and route durable detail to [`DOCS/`](DOCS/README.md).

## Start here

For every code change:

1. Read [`DOCS/ARCHITECTURE.md`](DOCS/ARCHITECTURE.md).
2. Read [`DOCS/DEVELOPMENT.md`](DOCS/DEVELOPMENT.md).
3. Identify the active OS and CPU with `node -p "process.platform + ' ' + process.arch"`; for path, native-module, worktree, build, or packaging work, follow the [cross-platform rules](DOCS/DEVELOPMENT.md#cross-platform-development).
4. Read the owning domain document selected in [`DOCS/README.md`](DOCS/README.md).
5. Inspect `git status` and preserve unrelated user changes.
6. Locate the implementation and nearest behavior tests before editing.

Documentation-only changes may start with [`DOCS/README.md`](DOCS/README.md) and the owning topic document.

## Working rules

- Put work in the owner layer defined by the architecture document; keep app shells and transport boundaries thin.
- Use `rg` / `rg --files` for discovery and follow existing adjacent tests and conventions.
- In Windows PowerShell, read repository text with `Get-Content -Encoding UTF8`; mojibake from the shell's legacy default is not evidence that the file is corrupt.
- Use root `npm run format` only for agent-owned docs/scripts/config. `format:all` is an intentional repository-wide rewrite and must not be used during an ordinary feature task.
- Preserve public contracts unless the task explicitly includes a migration.
- Treat tokens, tags, schema compatibility, provider privacy, and resume identity as correctness boundaries.
- For TM, TB, AI file-flow, or CLI smoke failures, follow the routing and data-safety rules in the [diagnostic playbooks](DOCS/DEVELOPMENT.md#diagnostic-playbooks) before changing matching or provider code.
- Do not overwrite unrelated work or clean the worktree destructively.
- Do not add permanent specs, plans, status reports, or dated reviews under `DOCS/`.
- One durable fact has one owner document. Link to it instead of copying it into another README.

## Validation

- Run the smallest relevant check before broad changes when practical, then rerun it after editing.
- Use the validation matrix in [`DOCS/DEVELOPMENT.md`](DOCS/DEVELOPMENT.md).
- Run `npm run docs:check` whenever documentation, package scripts, release markers, schema markers, or doc-linked paths change.
- Run `npm run gate:text` after adding or renaming tracked text files; run `npm run format:check` when agent-owned docs, scripts, or root configuration change.
- Treat `npm run gate:check` as the full repository audit. If it is not green before the task, record the failing stages and distinguish unchanged baseline failures from regressions; never claim the gate passed when it did not.
- Do not broaden a scoped task merely to repair unrelated baseline failures.

## Definition of done

- The requested behavior or documentation outcome is complete.
- Relevant focused checks pass, or exact blockers and unchanged baseline failures are reported.
- Public behavior, schema, commands, and owning docs agree.
- No secrets, private content, generated artifacts, or accidental dependency trees are added.
- The final handoff names changed files and validation actually run.
