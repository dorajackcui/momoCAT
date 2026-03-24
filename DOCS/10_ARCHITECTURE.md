# 10_ARCHITECTURE

## Purpose

Describe current system boundaries and module responsibilities so implementation changes stay local and predictable.

## When to Read

Read before modifying module boundaries, cross-layer contracts, or multi-subsystem workflows.

## Source of Truth

- Runtime behavior: implementation in `apps` and `packages`
- Guardrails: `DOCS/architecture/GATE05_GUARDRAILS.json`

## Last Updated

2026-03-24

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

4. Packages

- `@cat/core`: domain models and pure/domain algorithms.
- `@cat/db`: persistence, current-schema bootstrap/validation, repositories.

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
- dialogue/prompt helpers under `services/modules/ai/*`

### TM internal services

- `TMQueryService`
- `TMImportService`
- `TMBatchOpsService`

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

### File-level AI translation

Renderer action -> `apiClient.aiTranslateFile` -> `ProjectService` -> `AIModule` -> AI orchestration -> segment updates -> job progress events

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

@cat/core is consumed by renderer/main/db for shared domain types and algorithms.
```

## Do / Don't Boundary Rules

### Do

1. Keep `ProjectService` orchestration-only.
2. Add business behavior in modules/services, not in IPC registration code.
3. Keep IPC types centralized in `apps/desktop/src/shared/ipc.ts`.
4. Use repository/service abstractions from ports instead of coupling UI to persistence details.

### Don't

1. Don't put domain logic in preload.
2. Don't bypass `apiClient` in renderer.
3. Don't add cross-repo orchestration into `CATDatabase`.
4. Don't introduce new large monolithic files when a focused internal service is appropriate.

## Architecture Evolution Guidance

1. Prefer vertical extraction with compatibility facades.
2. Preserve IPC/public signatures unless an explicit migration is planned.
3. Add tests on touched boundary seams (module API, IPC contract, migration behavior).
