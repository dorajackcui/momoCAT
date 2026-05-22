# 10_ARCHITECTURE

## Purpose

Describe current system boundaries and module responsibilities so implementation changes stay local and predictable.

For the `agent-first-batch-ai-mvp` branch, architecture decisions should optimize for agent-first CLI/headless workflows and shared localization capability. The legacy desktop UI remains supported, but it is not the primary target for new TM/TB/MT capabilities on this branch.

## When to Read

Read before modifying module boundaries, cross-layer contracts, or multi-subsystem workflows.

## Source of Truth

- Runtime behavior: implementation in `apps` and `packages`
- Guardrails: `DOCS/architecture/GATE05_GUARDRAILS.json`

## Last Updated

2026-05-22

## Owner

Core maintainers of `simple-cat-tool`

## Layered Boundaries

1. Renderer (`apps/desktop/src/renderer/src`)

- Uses `apiClient` as the only entry to desktop APIs.
- Owns view orchestration and UI state.

2. Preload (`apps/desktop/src/preload`)

- Exposes typed bridge through `window.api`.
- Must stay thin; no domain logic.

3. Main (`apps/desktop/src/main`)

- `ProjectService` is the application facade.
- Domain logic lives in modules/services, not IPC handlers.

4. CLI (`apps/cli`)

- Exposes the `momocat` app.
- Owns command grammar, argument parsing, help text, stdout/stderr behavior, and exit codes.
- Calls `@cat/localization` for agent-first workflows.
- Must not import `apps/desktop`, `@cat/db`, or `@cat/core` directly.

5. Packages

- `@cat/core`: domain models and pure/domain algorithms.
- `@cat/db`: persistence, current-schema bootstrap/validation, repositories.
- `@cat/localization`: agent-first/headless localization orchestration, including file adapters, job runner, checkpoint/events/artifacts, LocalizationEngine, LocalizationInspector, and headless TM/TB/MT adapter modules.

The branch focus is shared core capability plus agent-first orchestration:

- Core capability: TM/TB/MT contracts, tag/protected-marker handling, prompt builders, response parsers, validation helpers, and persistence boundaries.
- Agent-first operation: CLI commands and headless workflows that are inspectable, resumable, and automation-friendly.
- Desktop interaction: retained as legacy host/UI surface unless a separate desktop migration is explicitly designed.

### `@cat/core` internal slices

- `@cat/core/models`: shared domain types only.
- `@cat/core/project`: project-level enums, AI model registry, QA defaults, and project/file report types.
- `@cat/core/tag`: tag parsing, markers, signatures, display helpers, and tag services.
- `@cat/core/text`: token text serialization, term matching, TM key/hash helpers.
- `@cat/core/qa`: tag/terminology QA and validation adapters.

Internal dependency direction:

- `models` -> no internal dependencies
- `project` -> `models`
- `tag` -> `models`
- `text` -> `models`
- `qa` -> `models`, `project`, `tag`, `text`

## Current Module Responsibilities

### Main modules (facades)

- `ProjectFileModule`: project/file import-export orchestration.
- `AIModule`: AI facade delegating to `services/modules/ai/*`.
- `TMModule`: TM facade delegating to `services/modules/tm/*`.
- `TBModule`: TB management and lookup.

### AI internal services

- `AISettingsService`
- `AITranslationOrchestrator`
- `fileTranslationWorkflow` (standard file batch translation loop)
- `dialogueTranslationWorkflow` (dialogue grouping + fallback path)
- `segmentTranslationWorkflow` (segment translate/refine/test workflows)
- `translationTargetScope` (blank-only / overwrite-non-confirmed scope rules)
- `AITextTranslator`
- `SegmentPagingIterator`
- dialogue helpers under `services/modules/ai/*`

### TM internal services

- `TMQueryService`
- `TMImportService`
- `TMBatchOpsService`

### Core package boundaries

- Use `@cat/core/models` for shared entities and token/segment types.
- Use `@cat/core/project` for project-facing config/constants and QA settings.
- Use `@cat/core/tag` for tag parsing, markers, display, and signatures.
- Use `@cat/core/text` for linguistic text serialization and term matching.
- Use `@cat/core/qa` for QA evaluation and `TagValidator`.
- Use `@cat/core/project` as the current home for AI prompt builders and future pure MT prompt/response helpers; desktop main and localization should consume pure helpers rather than keep local prompt template copies.
- Keep root `@cat/core` as a compatibility barrel only; repo code should import from a slice entrypoint instead.

### Editor domain split (renderer)

- Container: `components/Editor.tsx`
- UI subcomponents: `components/editor/*`
- Controller aggregation: `hooks/useEditor.ts`
- Domain hooks: `hooks/editor/*`
- Project AI controller facade: `hooks/projectDetail/useProjectAI.ts`
- Project AI internals: `hooks/projectDetail/ai/*`
- Editor filters facade: `hooks/useEditorFilters.ts`
- Editor filter internals:
  - `hooks/editor/editorFilterStateStorage.ts`
  - `hooks/editor/editorSearchableSegments.ts`
  - `hooks/editor/useEditorFilterMenus.ts`
- Row orchestrator: `components/EditorRow.tsx`
- Row internals: `components/editor-row/*`
- Row hooks:
  - `useEditorRowDraftController.ts` (draft sync, focus/blur flush, textarea resize)
  - `useEditorRowCommandHandlers.ts` (shortcut resolution, tag insertion, AI refine input flow)
  - `useEditorRowDisplayModel.ts` (status/highlight/non-printing/action-visibility derivation)

## Key Call Chains

### Segment edit and confirm

`EditorRow` -> `useEditor` -> `apiClient` -> IPC handler -> `ProjectService` -> `SegmentService` -> repo/db

### Legacy desktop file-level AI translation

Renderer action -> `apiClient.aiTranslateFile` -> `ProjectService` -> `AIModule` -> AI orchestration -> segment updates -> job progress events

This is the existing CAT editor workflow. Standard file processing uses bounded concurrent segment requests for translation default, review, and custom projects. Translation dialogue mode remains serial because each dialogue unit may depend on the previous translated group for consistency context.

Do not use this desktop workflow as the model for new agent-first MT request scheduling.

### Agent-first file localization

`momocat` (`apps/cli`) -> `@cat/localization` command API -> `LocalizationEngine` / `LocalizationInspector` -> file/job adapters -> TM/TB/MT modules -> `@cat/db` + `@cat/core`

Agent-first file translation keeps external spreadsheets out of project `files` and `segments`, writes per-unit checkpoints, and treats prompt artifacts as inspect-only or explicit diagnostic output.

### TM import and batch match

Renderer import flow -> IPC -> `ProjectService` -> `TMModule` -> TM import/query/batch services -> repos/db

## Dependency Map

```text
renderer components/hooks
  -> renderer/services/apiClient
  -> preload typed bridge
  -> shared ipc channels + types
  -> main ipc handlers
  -> ProjectService
  -> services/modules + domain services
  -> adapters/repos
  -> @cat/db + SQLite

apps/cli -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization

@cat/core is consumed by renderer/main/db for shared domain types and algorithms.
`apps/desktop` is a peer consumer of `@cat/localization`, not a dependency of CLI.
`apps/cli` must own only the `momocat` app surface and must keep domain and persistence work behind `@cat/localization`.
```

## Do / Don't Boundary Rules

### Do

1. Keep `ProjectService` orchestration-only.
2. Add business behavior in modules/services, not in IPC registration code.
3. Keep IPC types centralized in `apps/desktop/src/shared/ipc.ts`.
4. Use repository/service abstractions from ports instead of coupling UI to persistence details.
5. Import `@cat/core` through slice entrypoints in repo code; avoid the root barrel except for explicit compatibility tests.
6. `@cat/localization` may depend on `@cat/core` and `@cat/db`, but must not import `apps/desktop/src/main/*`. Desktop and CLI code call localization APIs instead of owning headless engine code.
7. Put pure MT prompt contracts, builders, parsers, and schema validation in `@cat/core`; keep request orchestration in `@cat/localization`.
8. Design new localization capability for shared packages and agent-first CLI/headless use before considering desktop UI integration.

### Don't

1. Don't put domain logic in preload.
2. Don't bypass `apiClient` in renderer.
3. Don't add cross-repo orchestration into `CATDatabase`.
4. Don't introduce new large monolithic files when a focused internal service is appropriate.
5. Don't import `packages/core/src/index.ts` from inside `packages/core`; import the needed slice or sibling module directly.
6. Don't add new agent-first MT batching behavior to the legacy desktop GUI workflow.
7. Don't make desktop UI state the source of truth for TM/TB/MT behavior needed by agents or CLI workflows.

## Architecture Evolution Guidance

1. Prefer vertical extraction with compatibility facades.
2. Preserve IPC/public signatures unless an explicit migration is planned.
3. Add tests on touched boundary seams (module API, IPC contract, migration behavior).
