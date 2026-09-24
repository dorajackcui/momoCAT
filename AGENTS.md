# Repository agent guide

Applies to the whole repository. This file owns agent rules; [DOCS](DOCS/README.md) owns durable product and engineering contracts.

## Start here

1. Inspect `git status`; preserve unrelated changes.
2. For code changes, read [Architecture](DOCS/ARCHITECTURE.md), the [validation matrix](DOCS/DEVELOPMENT.md#validation-strategy), and the task's section selected in the [document map](DOCS/README.md). Read other Development sections only as relevant. Documentation-only work starts with the map and owner.
3. Identify the host with `node -p "process.platform + ' ' + process.arch"`; follow the [cross-platform rules](DOCS/DEVELOPMENT.md#cross-platform-development).
4. Locate implementation and adjacent behavior tests before editing.

## Working rules

- Keep behavior in its owner layer and app/transport shells thin. Preserve public contracts unless a migration is in scope.
- Treat tokens/tags, schema compatibility, provider privacy, and resume identity as correctness boundaries.
- Use `rg` / `rg --files`. In PowerShell read text with `Get-Content -Encoding UTF8`; legacy shell decoding is not evidence of file corruption.
- Follow the [diagnostic playbooks](DOCS/DEVELOPMENT.md#diagnostic-playbooks) for TM/TB/AI/CLI failures before changing matching or provider code.
- Do not overwrite unrelated work, clean the worktree destructively, or run `format:all` during a scoped task. Root `format` is only for agent-owned docs/scripts/config.

## Documentation and traceability

- Update docs when current behavior, a public contract, ownership, compatibility, or a reusable operating procedure changes. A completed task alone does not require a doc update.
- Revise the existing owner paragraph; do not append a second account of the same fact. Keep current rules and necessary constraints, not the sequence of changes.
- Keep plans, reviews, decisions specific to the change, test counts, logs, screenshots, and temporary investigations in the task/PR or untracked artifacts. Git records code history; do not create completion reports in `DOCS/`.
- Keep exact styling values and implementation mechanics in code/tests unless callers need them as a contract. Link to their owner; preserve maintained compatibility references and boundary cases.
- Use the [retention rules](DOCS/README.md#what-to-record-and-where) before adding content. Do not grow this guide with feature-specific rules or add a document when an existing owner fits.

## Validation and handoff

- Use the [validation matrix](DOCS/DEVELOPMENT.md#validation-strategy); run the smallest relevant check before/after changes when practical.
- Run `npm run docs:check` for docs, package scripts, release/schema markers, or doc-linked path changes; `npm run format:check` for agent-owned docs/scripts/root config; `npm run gate:text` for added/renamed tracked text.
- `npm run gate:check` is the full audit. Distinguish baseline failures from regressions and report only checks actually run; do not broaden scope to repair unrelated failures.
- Finish with behavior, code, and owning docs in agreement, no private/generated artifacts added, and a handoff naming changed files, validation, and any remaining blockers.
