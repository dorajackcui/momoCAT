# Documentation

This directory documents the current, durable behavior of momoCAT. It is a navigation system for development and operation, not a storage area for implementation history. Repository agents enter through [`AGENTS.md`](../AGENTS.md).

## Agent reading order

For every implementation task, read these two foundations first:

1. [Architecture](ARCHITECTURE.md) for ownership and dependency direction.
2. [Development](DEVELOPMENT.md) for commands, focused validation, native ABI, and handoff rules.

Then read the owning domain document below. Documentation-only work may start here and proceed directly to the owning topic.

## Choose a document

| You need to…                                                           | Read                            |
| ---------------------------------------------------------------------- | ------------------------------- |
| Understand packages, layers, or dependency direction                   | [Architecture](ARCHITECTURE.md) |
| Set up the repo, choose tests, package, or troubleshoot tools          | [Development](DEVELOPMENT.md)   |
| Change SQLite schema, repositories, or persistent JSON                 | [Data model](DATA_MODEL.md)     |
| Build or operate the `momocat` CLI                                     | [CLI](CLI.md)                   |
| Change MT requests, tags, TM/TB matching, Runtime TM, or resource sync | [Localization](LOCALIZATION.md) |

## Common task map

| Task surface                          | Primary code home                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer/editor behavior              | [`apps/desktop/src/renderer/src/components`](../apps/desktop/src/renderer/src/components), [`hooks/editor`](../apps/desktop/src/renderer/src/hooks/editor)          |
| Desktop IPC and typed bridge          | [`apps/desktop/src/shared/ipc.ts`](../apps/desktop/src/shared/ipc.ts), [`main/ipc`](../apps/desktop/src/main/ipc), [`preload/api`](../apps/desktop/src/preload/api) |
| Project file import/export/inspect    | [`ProjectFileModule.ts`](../apps/desktop/src/main/services/modules/ProjectFileModule.ts)                                                                            |
| AI/provider and file translation      | [`modules/ai`](../apps/desktop/src/main/services/modules/ai), [`packages/localization`](../packages/localization/src)                                               |
| TM/TB matching and resource lifecycle | [`LOCALIZATION.md`](LOCALIZATION.md) and its entrypoint table                                                                                                       |
| SQLite/schema/repositories            | [`DATA_MODEL.md`](DATA_MODEL.md) and [`packages/db/src`](../packages/db/src)                                                                                        |
| CLI parsing and operation             | [`CLI.md`](CLI.md), [`apps/cli/src`](../apps/cli/src)                                                                                                               |
| TM/TB/AI flow diagnosis and CLI smoke | [`DEVELOPMENT.md`](DEVELOPMENT.md#diagnostic-playbooks)                                                                                                             |
| Repository scripts and generators     | [`DEVELOPMENT.md`](DEVELOPMENT.md#script-ownership-and-maintenance)                                                                                                 |
| Build, packaging, and updates         | [`DEVELOPMENT.md`](DEVELOPMENT.md), [`scripts/pack-platform.mjs`](../scripts/pack-platform.mjs)                                                                     |

The root [README](../README.md) is the product entrypoint. `AGENTS.md` is the agent entrypoint. Package-specific READMEs may contain a short build/usage pointer, but the topic document above owns operational defaults and detailed contracts.

## Source-of-truth order

When documentation and implementation disagree, verify in this order:

1. Executable tests and public types.
2. Package scripts and implementation at the linked code entrypoint.
3. The relevant topic document.
4. Comments, commit messages, issues, and old review notes.

Fix the owning topic document in the same change as the behavior. Do not copy a correction into several files.

## What belongs here

- Current architecture and stable boundaries.
- Commands that exist in `package.json` or a package manifest.
- Persistent schema and compatibility behavior.
- User-visible or integration-visible localization contracts.
- Failure handling that a contributor or operator needs repeatedly.

## What does not belong here

- Feature specs, execution plans, scratch notes, or task checklists.
- Dated status reports, roadmaps, commit reviews, or completed investigations.
- Large code excerpts that will drift from their source.
- Real local paths, project/customer names, source text, prompts, provider endpoints, model configuration, keys, or generated artifacts.

Keep temporary specs and plans in the task or pull request that needs them. When work lands, move only the durable result into the owning topic document and delete the temporary record.

## Maintenance rules

1. One fact has one owner. Link to it instead of restating it.
2. Describe current behavior in present tense; use Git history for history.
3. Prefer stable concepts and code entrypoints over line numbers or file-size snapshots.
4. Avoid “last updated” badges and live status sections; they age without proving correctness.
5. Keep examples generic and safe to commit.
6. Add a new top-level document only when none of the existing owners fits.
7. Never place `node_modules`, generated outputs, or local artifacts under `DOCS/`.
8. Run the documentation check before submitting changes:

```bash
npm run docs:check
```

The check validates the allowed document set, Markdown tables, local links, release/schema markers, root/workspace package-script context, and the absence of retired or generated documentation paths.
