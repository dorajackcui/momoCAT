# Documentation

This directory documents the current, durable behavior of momoCAT. It is a navigation system for development and operation, not a storage area for implementation history. Repository agents enter through [`AGENTS.md`](../AGENTS.md).

## Agent entrypoint

Follow [AGENTS.md](../AGENTS.md), then use the task map below to read the relevant contract and open its implementation/test links. Read Architecture for dependency direction and the Development validation matrix for checks; setup, diagnostics, ABI, and packaging sections are needed only when the task touches them. Do not read all topic documents on every session. Expand when a change crosses an ownership boundary.

## Choose a document

| You need to…                                                           | Read                            |
| ---------------------------------------------------------------------- | ------------------------------- |
| Understand packages, layers, or dependency direction                   | [Architecture](ARCHITECTURE.md) |
| Set up the repo, choose tests, package, or troubleshoot tools          | [Development](DEVELOPMENT.md)   |
| Change desktop editing, async UI state, IPC, or background jobs        | [Desktop](DESKTOP.md)           |
| Change SQLite schema, repositories, or persistent JSON                 | [Data model](DATA_MODEL.md)     |
| Build or operate the `momocat` CLI                                     | [CLI](CLI.md)                   |
| Change MT requests, tags, TM/TB matching, Runtime TM, or resource sync | [Localization](LOCALIZATION.md) |

## Common task map

| Task surface                            | Primary code home                                                                                                     |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Renderer/editor state and behavior      | [Desktop ownership and tests](DESKTOP.md#ownership-and-tests)                                                         |
| Project/global settings and shared UI   | [Settings](DESKTOP.md#project-and-global-settings), [UI foundation](DESKTOP.md#ui-foundation)                         |
| Desktop IPC and typed bridge            | [Desktop boundary changes](DESKTOP.md#changing-a-desktop-boundary)                                                    |
| Project file import/export/inspect      | [Desktop files and background jobs](DESKTOP.md#files-and-background-jobs)                                             |
| AI/provider and file translation        | [`modules/ai`](../apps/desktop/src/main/services/modules/ai), [`packages/localization`](../packages/localization/src) |
| QA checks and QAtools comparison        | [QA entrypoints](LOCALIZATION.md#qa-entrypoints), [QAtools comparison](LOCALIZATION.md#qatools-comparison)            |
| QA retention, invalidation, and display | [Result lifecycle](LOCALIZATION.md#qa-result-lifecycle), [QA panel](DESKTOP.md#qa-panel-and-feedback)                 |
| TM/TB matching and resource lifecycle   | [`LOCALIZATION.md`](LOCALIZATION.md) and its entrypoint table                                                         |
| SQLite/schema/repositories              | [`DATA_MODEL.md`](DATA_MODEL.md) and [`packages/db/src`](../packages/db/src)                                          |
| CLI parsing and operation               | [`CLI.md`](CLI.md), [`apps/cli/src`](../apps/cli/src)                                                                 |
| TM/TB/AI flow diagnosis and CLI smoke   | [`DEVELOPMENT.md`](DEVELOPMENT.md#diagnostic-playbooks)                                                               |
| Repository scripts and generators       | [`DEVELOPMENT.md`](DEVELOPMENT.md#script-ownership-and-maintenance)                                                   |
| Build, packaging, and updates           | [`DEVELOPMENT.md`](DEVELOPMENT.md), [`scripts/pack-platform.mjs`](../scripts/pack-platform.mjs)                       |

The root [README](../README.md) is the product entrypoint. Package-specific READMEs contain short build/usage pointers; the topic document owns operational defaults and detailed contracts. Use the [validation matrix](DEVELOPMENT.md#validation-strategy) to choose commands, and the owning topic's code/test links to select the focused cases.

## Source-of-truth order

When documentation and implementation disagree, verify in this order:

1. Executable tests and public types.
2. Package scripts and implementation at the linked code entrypoint.
3. The relevant topic document.
4. Comments, commit messages, issues, and old review notes.

Fix the owning topic document in the same change as the behavior. Do not copy a correction into several files.

## What to record and where

| Information                                                                                                | Home                                              |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Current behavior, cross-layer contracts, ownership, defaults, compatibility, reusable operating procedures | The existing topic document                       |
| A stable constraint whose omission would lead to an incorrect implementation                               | Explain it briefly beside its contract            |
| Code changes and implementation history                                                                    | Git commits; link from a task/PR when useful      |
| Change-specific rationale, alternatives, reviews, plans, progress, and validation results                  | Task or PR                                        |
| Reproduction logs, screenshots, generated output, temporary scripts, and investigation notes               | Untracked task artifacts; do not add them to DOCS |
| Exact style values, exhaustive rule IDs, function inventories, and code-level test cases                   | Code/tests; link to the maintained entrypoint     |

A documentation update is warranted when a future maintainer needs a changed contract or procedure, not simply because work was completed. Maintain the [QAtools comparison](LOCALIZATION.md#qatools-comparison) as a versioned compatibility reference, including known differences; it is not a completed-review report.

## Maintenance rules

1. One fact has one owner. Revise or replace the existing description and link from other topics.
2. State current behavior. Keep old behavior only when a supported compatibility boundary requires it; Git owns the rest of the history.
3. Keep concise headings, contracts, and code/test entrypoints. Avoid long implementation narratives, copied code, live status sections, test-count snapshots, and “last updated” badges.
4. Keep examples generic. Never commit real local paths, customer/source text, provider metadata, prompts containing private content, keys, or generated artifacts.
5. Use existing topic sections before adding documents. Do not add specs, plans, archives, or dated reviews under DOCS. Keep AGENTS limited to repository-wide operating rules.
6. At handoff, absorb durable facts and remove obsolete repository notes; task/PR discussion remains the trace of the work. Do not copy it into a new summary document.

Run `npm run docs:check` after changing docs. The check validates the document set, Markdown tables, local links, release/schema markers, package-script context, and retired/generated paths. Semantic accuracy and duplication still require review against code and tests.
