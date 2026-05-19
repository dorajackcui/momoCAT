# 00_START_HERE

## Purpose

Provide a deterministic onboarding entrypoint for humans and AI agents to start work in under 10 minutes.

## When to Read

Read first for every new task, new session, or handoff.

## Source of Truth

- Runtime behavior: code + tests
- Process and guardrails: `DOCS/20_ENGINEERING_RUNBOOK.md`
- Current project status and priorities: `DOCS/40_STATUS_AND_ROADMAP.md`

## Last Updated

2026-05-08

## Owner

Core maintainers of `simple-cat-tool`

## 10-Minute Boot Path

1. Read `DOCS/40_STATUS_AND_ROADMAP.md` (current status, current risks, now/next/later).
2. Read `DOCS/20_ENGINEERING_RUNBOOK.md` (workflow rules, gates, PR checklist).
3. Read `DOCS/10_ARCHITECTURE.md` for boundaries and entrypoints.
4. If data-layer changes are involved, read `DOCS/30_DATA_MODEL.md`.
5. Implement and validate with the canonical command checklist below.

## Dual-Platform Quick Boot (Windows + macOS)

Run from repo root:

```bash
npm ci
npm run rebuild:electron
npm run dev
```

Package validation by target OS:

1. Windows: `npm run pack:win`
2. macOS: `npm run pack:mac`

Windows note:

- Packaging and Electron rebuild scripts invoke `npm`/`npx` through the Windows shell to avoid `.cmd` spawn failures such as `spawnSync npm.cmd EINVAL` in some PowerShell/Volta setups.
- Packaging entrypoints rebuild native modules and refresh the production renderer bundle before `electron-builder` runs, so release validation does not rely on stale `out/` artifacts.

AI debug logs:

- Enable prompt debugging with `CAT_AI_DEBUG_PROMPTS=1` before `npm run dev`, or add it to `apps/desktop/proxy.env` / `.cat_data/proxy.env`. In dev, prompt logs are written to `.cat_data/ai_prompt_debug.log` unless `CAT_AI_DEBUG_PROMPTS_FILE` overrides the path.
- Enable batch workflow diagnostics with `CAT_AI_DEBUG_BATCH=1`. In dev, JSONL batch logs are written to `.cat_data/ai_batch_translate_debug.log` unless `CAT_AI_DEBUG_BATCH_FILE` overrides the path. `CAT_AI_DEBUG_PROMPTS=1` also enables batch diagnostics.
- For batch AI translate blank-line triage, run one translation pass, then inspect `segment_start`, `segment_translated`, `segment_write_success`, and `segment_failed` events. `stage=translate` means provider/prompt/validation failed before writeback; `stage=write` means translated tokens existed but persistence failed.
- Leave these flags unset for normal work because prompt logs may contain source text, target text, TM/TB references, and provider response context.

TM match workflow diagnostics:

- For active TM panel recall/scoring/ranking triage, run `npm run trace:tm-flow -- --project-id <id> --source "<source text>"` or `npm run trace:tm-flow -- --project-id <id> --segment-id <segment id>`.
- Add `--focus-src-hash <hash[,hash]>` when checking whether specific TM entries were recalled, scored, or dropped before the final top results.
- Read `DOCS/20_ENGINEERING_RUNBOOK.md` -> "TM match workflow triage" for how to interpret the trace.

Headless AI file flow diagnostics:

- To run a project file through mounted TM/TB reference preview and the existing AI batch translation workflow, run `npm run trace:ai-file -- --project-id <id> --file-id <id>`.
- To import an external spreadsheet first, run `npm run trace:ai-file -- --project-name "<name>" --file <path>`. The import path auto-detects `source` and `target` header columns by default.
- The command writes translations back through the normal segment update path. Use `--target-scope overwrite-non-confirmed` only when replacing non-confirmed target text is intended.
- Use `--source-col <n>` and `--target-col <n>` only when overriding header detection for `--file`; column indexes are zero-based.
- Use `--preview-limit <n>` to control how many leading segments print TM/TB reference preview events before translation starts.
- The command emits JSONL-style events from the dynamic Vitest runner: `ai_file_flow_start`, `ai_file_flow_resources`, `ai_file_flow_reference_preview`, `ai_file_flow_progress`, and `ai_file_flow_complete`.

Headless project/API inspection:

- To list projects with mounted TM/TB resources, files, target coverage, and AI provider status, run `npm run inspect:projects -- --db <path>`.
- Use `--project-id <id>` to narrow the output and `--json` for automation-friendly output.
- The command opens SQLite read-only and only prints API key status plus last four characters; it never prints full API keys.

External LocalizationEngine file translation:

- To translate an external spreadsheet through a project as a TM+TB+MT engine without importing the file into the project, run `npm run translate:file -- --db <path> --project-id <id> --input <path> --output <path>`.
- The command reads project settings, mounted TM/TB resources, and AI provider configuration, but does not create `files` or `segments` records.
- The input file is not modified in place. The translated spreadsheet is written to `--output`.
- By default, the file adapter detects `source` and `target` headers and translates only blank targets.

LocalizationEngine inspection:

- To inspect an external spreadsheet through a project as a TM+TB+MT prompt preview without importing or translating it, run `npm run inspect:localization -- --db <path> --project-id <id> --input <path> --output <inspect.xlsx>`.
- The command writes an inspect workbook with `Segments` and `MT_SystemPrompt` sheets, plus a JSON sidecar next to the `.xlsx` output.
- `Segments` preserves the original rows and appends `_tm_for_mt`, `_tb_for_mt`, `_mt_user_prompt`, `_inspect_status`, and `_inspect_json_ref`.
- The command reads project settings and mounted TM/TB resources, but does not create project `files` or `segments` records and does not send API requests.
- Use `--unit-limit <n>` to cap inspected units, `--json-output <path>` to override the sidecar path, and `--max-cell-chars <n>` to cap large workbook cell values.

## Platform Command Matrix

Run from repo root `simple-cat-tool`.

| Task                          | When to use                                                          | Command                                                 | Platform        | Expected result                                                 |
| ----------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------- | --------------- | --------------------------------------------------------------- |
| Start local development       | First boot or manual app verification                                | `npm ci` -> `npm run rebuild:electron` -> `npm run dev` | Windows + macOS | Electron app starts with native module rebuilt for current host |
| Run unit/integration baseline | Any code change before deeper validation                             | `npm test`                                              | Windows + macOS | Vitest suites pass                                              |
| Run repo quality gate         | Default cross-platform baseline before pack guesses                  | `npm run gate:check`                                    | Windows + macOS | Typecheck + guardrails + lint + smoke gate pass                 |
| Run desktop smoke e2e         | UI/editor behavior changed, need fastest desktop confidence          | `npm run test:e2e:smoke --workspace=apps/desktop`       | Windows + macOS | Smoke Playwright suite passes against built desktop app         |
| Run full desktop e2e          | Smoke is not enough or broader desktop regression coverage is needed | `npm run test:e2e --workspace=apps/desktop`             | Windows + macOS | Full Playwright suite passes                                    |
| Validate Windows packaging    | Need native Windows installer artifact validation                    | `npm run pack:win`                                      | Windows only    | `.exe` packaging flow completes on Windows host                 |
| Validate macOS packaging      | Need native macOS installer artifact validation                      | `npm run pack:mac`                                      | macOS only      | `.dmg` packaging flow completes on macOS host                   |

Notes:

- `npm run pack` only packages for the current host platform; do not treat it as Win/mac release signoff.
- CI covers `npm ci` -> `npm run rebuild:electron` -> `npm run gate:check` on both Windows and macOS, but platform packaging still requires native hosts.

## Agent Guardrails

1. Start with `npm run gate:check` for cross-platform baseline validation; do not guess packaging commands first.
2. Use `npm run test:e2e:smoke --workspace=apps/desktop` before full e2e when you need desktop behavior confidence quickly.
3. Never mix `pack:win` and `pack:mac` across hosts; packaging validation is platform-native only.
4. If Windows/macOS commands behave differently, run `npm run rebuild:electron` before deeper debugging.
5. On Windows, do not rely on PowerShell's default text encoding for non-ASCII files or output. Read files with explicit UTF-8 such as `Get-Content -Raw -Encoding UTF8 <path>`, prefer patch/editor tools for writes, and if PowerShell must write text, specify UTF-8 (`-Encoding utf8NoBOM` in PowerShell 7 or `-Encoding UTF8` in Windows PowerShell) and verify with `git diff`.

## If Task Is X, Open Y

| Task type                            | Open first                                                     |
| ------------------------------------ | -------------------------------------------------------------- |
| New feature touching renderer flow   | `DOCS/10_ARCHITECTURE.md`                                      |
| Main process service/module changes  | `DOCS/10_ARCHITECTURE.md`                                      |
| IPC contract changes                 | `DOCS/10_ARCHITECTURE.md` and `DOCS/20_ENGINEERING_RUNBOOK.md` |
| Schema/repo SQL work                 | `DOCS/30_DATA_MODEL.md`                                        |
| Build/test/gate failures             | `DOCS/20_ENGINEERING_RUNBOOK.md`                               |
| Priorities and risk decisions        | `DOCS/40_STATUS_AND_ROADMAP.md`                                |
| Historical context for old decisions | `DOCS/90_HISTORY_CONSOLIDATED.md`                              |

## Canonical Command Checklist

Run from repo root `simple-cat-tool`.

```bash
npm run gate:check
npm run test:e2e:smoke --workspace=apps/desktop
```

Targeted tests (run when touching corresponding areas):

```bash
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts
npx vitest run apps/desktop/src/main/services/modules/ai/AITranslationWorkflows.test.ts
npx vitest run apps/desktop/src/main/services/modules/TMModule.test.ts
npm run test:tm-flow
npx vitest run apps/desktop/src/renderer/src/hooks/useEditor.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.behavior.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/useEditorFilters.test.ts
npx vitest run apps/desktop/src/renderer/src/hooks/useEditorFilters.behavior.test.ts
npx vitest run apps/desktop/src/renderer/src/components/EditorRow.integration.test.ts
npx vitest run apps/desktop/src/renderer/src/components/editor-row/useEditorRowDisplayModel.test.ts
npx vitest run apps/desktop/src/renderer/src/components/editor-row/useEditorRowCommandHandlers.test.ts
npx vitest run packages/db/src/currentSchema.test.ts
npx vitest run packages/core/src/TagManager.test.ts
```

## Test Layout

1. Default to colocated tests: keep unit, behavior, and integration tests next to the code they exercise.
2. Use `*.test.ts` or `*.test.tsx` so targeted `vitest run <path>` stays predictable during refactors.
3. Keep end-to-end coverage centralized under `apps/desktop/e2e`.
4. Extract shared fixtures/helpers only when reused across multiple nearby tests; do not move entire suites into a repo-level `tests/` folder by default.

## Fast Code Entry Index

- Renderer root: `apps/desktop/src/renderer/src`
- Main process root: `apps/desktop/src/main`
- Shared IPC contract: `apps/desktop/src/shared/ipc.ts`
- Core package: `packages/core/src`
- AI prompt templates: `packages/core/src/project/prompts`
- DB package: `packages/db/src`

## Documentation Rules

1. Keep this file short and deterministic.
2. Do not duplicate architecture or schema details here.
3. Add links, not long narrative, when adding new subsystems.
