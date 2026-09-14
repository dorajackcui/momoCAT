# Desktop application

## Scope

This document owns the Electron host, editor state and persistence, UI event coordination, and desktop extension points. Read [Architecture](ARCHITECTURE.md) for dependency rules, [Localization](LOCALIZATION.md) for translation/reference semantics, and [Data model](DATA_MODEL.md) for persisted shapes. Build, native ABI, e2e, and packaging commands belong to [Development](DEVELOPMENT.md).

## Ownership and tests

Paths below are relative to `apps/desktop/src` unless linked elsewhere. Start with the row matching the behavior; follow the facade to its collaborators instead of adding workflows to the shell.

| Concern                            | Implementation entrypoint                                                                                                                                                                               | Nearest behavior tests                                                                                                                                                                                                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup and user-data selection    | [main/index.ts](../apps/desktop/src/main/index.ts), [userDataPath.ts](../apps/desktop/src/main/userDataPath.ts)                                                                                         | [userDataPath.test.ts](../apps/desktop/src/main/userDataPath.test.ts), [singleInstance.test.ts](../apps/desktop/src/main/singleInstance.test.ts)                                                                                                                     |
| Typed IPC and preload              | [shared/ipc.ts](../apps/desktop/src/shared/ipc.ts), [main/ipc](../apps/desktop/src/main/ipc), [preload/api](../apps/desktop/src/preload/api)                                                            | [contractConsistency.test.ts](../apps/desktop/src/shared/contractConsistency.test.ts), [handlerRegistration.test.ts](../apps/desktop/src/main/ipc/handlerRegistration.test.ts), [createDesktopApi.test.ts](../apps/desktop/src/preload/api/createDesktopApi.test.ts) |
| Editor composition and local saves | [useEditor.ts](../apps/desktop/src/renderer/src/hooks/useEditor.ts), [useSegmentPersistence.ts](../apps/desktop/src/renderer/src/hooks/editor/useSegmentPersistence.ts)                                 | [useEditor.test.ts](../apps/desktop/src/renderer/src/hooks/useEditor.test.ts)                                                                                                                                                                                        |
| Segment store and remote events    | [editorSegmentStore.ts](../apps/desktop/src/renderer/src/hooks/editor/editorSegmentStore.ts), [useEditorDataLoader.ts](../apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.ts)            | [editorSegmentStore.test.ts](../apps/desktop/src/renderer/src/hooks/editor/editorSegmentStore.test.ts), [useEditorDataLoader.test.ts](../apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.test.ts)                                                     |
| Filters and batch actions          | [useEditorFilters.ts](../apps/desktop/src/renderer/src/hooks/useEditorFilters.ts), [useEditorBatchActions.ts](../apps/desktop/src/renderer/src/hooks/editor/useEditorBatchActions.ts)                   | [useEditorFilters.behavior.test.ts](../apps/desktop/src/renderer/src/hooks/useEditorFilters.behavior.test.ts), [useEditorBatchActions.behavior.test.ts](../apps/desktop/src/renderer/src/hooks/editor/useEditorBatchActions.behavior.test.ts)                        |
| Reference lookup and invalidation  | [useReferenceLookupController.ts](../apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts), [referenceDataInvalidation.ts](../apps/desktop/src/main/referenceDataInvalidation.ts) | [useReferenceLookupController.test.ts](../apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts), [referenceDataInvalidation.test.ts](../apps/desktop/src/main/referenceDataInvalidation.test.ts)                                          |
| Segment transactions               | [SegmentService.ts](../apps/desktop/src/main/services/SegmentService.ts)                                                                                                                                | [SegmentService.test.ts](../apps/desktop/src/main/services/SegmentService.test.ts)                                                                                                                                                                                   |
| Project files                      | [ProjectFileModule.ts](../apps/desktop/src/main/services/modules/ProjectFileModule.ts), [useProjectFileImport.ts](../apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.ts)         | [ProjectService.test.ts](../apps/desktop/src/main/services/ProjectService.test.ts), [useProjectFileImport.test.ts](../apps/desktop/src/renderer/src/hooks/projectDetail/useProjectFileImport.test.ts)                                                                |
| AI job UI and dispatch             | [useProjectAIController.ts](../apps/desktop/src/renderer/src/hooks/projectDetail/ai/useProjectAIController.ts), [aiHandlers.ts](../apps/desktop/src/main/ipc/aiHandlers.ts)                             | [useProjectAI.behavior.test.ts](../apps/desktop/src/renderer/src/hooks/projectDetail/useProjectAI.behavior.test.ts), [aiHandlers.test.ts](../apps/desktop/src/main/ipc/aiHandlers.test.ts)                                                                           |

## Editor persistence and events

`Editor` composes filters and batch actions with the `useEditor` state controller. `useEditor` composes the segment store, persistence, QA, data loading, and references. Rows edit token-backed local state optimistically; `useSegmentPersistence` coalesces writes per segment and serializes requests for that segment. Different segments may save concurrently.

Confirmation and explicit actions that require saved data must await `flushSegmentUpdate` or `flushAllSegmentUpdates`. A failed save rejects the flush, leaves a visible save error, and retains the latest unsaved target for retry. An older failed request must not replace a newer queued edit. Automatic debounce catches rejection only after recording the failure; an explicit flush must observe it.

`SegmentService` owns the database transaction. The renderer must not independently recalculate repeat propagation or commit Working TM entries. After commit, segment events update the renderer and reference-change events invalidate matching caches.

Remote event coordination belongs in `useEditorDataLoader`:

- Ignore events for other files and stale echoes identified by `clientRequestId`.
- Delay an event while its direct segment or any propagated follower is being edited or has an outstanding local save.
- Apply a batch through the segment store, preserving event order and publishing only the affected segment identities.

The editor's unload/pagehide hooks start a best-effort flush. They are not an awaited application-close protocol; do not use them as proof that pending writes survive immediate process termination.

## Files and background jobs

`ProjectFileModule` owns project file workflows behind `ProjectService`. Renderer file dialogs and hooks collect options and display outcomes; shared parsing and localization behavior stays behind the application adapter. File-level tag policy is persisted with import options and reused throughout the file lifecycle.

The CAT editor toolbar's AI Translate action defaults to the current filtered results when filters are active and offers the entire file as an alternative. Opening the dialog snapshots all matching segment IDs using the latest filter input, including context searches. Display sorting does not change translation order. The Files tab translates entire files. Planning, confirmed-row locking, and selected-scope result identity follow the [localization contract](LOCALIZATION.md#mt-request-planning).

Job handlers dispatch long operations through `JobManager` and the corresponding service/worker. The renderer tracks returned job identities and progress; progress notifications do not prove that a write committed. Preserve cooperative cancellation and the workflow's completion/failure outcome when adding UI actions. Reference export, source terminology precheck, and TM/TB sync retain their own [localization contracts](LOCALIZATION.md).

## Changing a desktop boundary

Project/file/segment, TM/TB, AI, job, and dialog handlers narrow incoming arguments before calling a service, lookup worker, job manager, or native dialog. [argumentValidation.ts](../apps/desktop/src/main/ipc/argumentValidation.ts) provides named argument readers and primitive guards. Domain shapes live in [projectPayloadValidation.ts](../apps/desktop/src/main/ipc/projectPayloadValidation.ts) for project/import/segment/token inputs, [referencePayloadValidation.ts](../apps/desktop/src/main/ipc/referencePayloadValidation.ts) for TM/TB inputs, [aiPayloadValidation.ts](../apps/desktop/src/main/ipc/aiPayloadValidation.ts) for AI settings and translation inputs, and [dialogPayloadValidation.ts](../apps/desktop/src/main/ipc/dialogPayloadValidation.ts) for file filters.

Primitive readers validate without coercing, trimming, or copying accepted values. Optional fields distinguish `undefined` from invalid supplied values, and legitimate extension metadata passes through unchanged. AI translation retains its shared [scope parser](../apps/desktop/src/shared/aiTranslationScope.ts), which validates and snapshots selected IDs; empty or sparse selections must fail before job creation. Services retain semantic checks such as resource existence, permissions, distinct sync columns, and mapping review.

Keep shape checks ahead of jobs, notifications, and native dialogs. [handlerArgumentValidation.test.ts](../apps/desktop/src/main/ipc/handlerArgumentValidation.test.ts) exercises malformed arguments, absence of side effects, and accepted payload compatibility. Registration and preload type tests alone do not prove those behaviors. System path handling and clipboard sender checks remain with their owning handlers.

1. Define the typed request/result in `shared/ipc.ts` or its focused shared contract and register the channel in `shared/ipcChannels.ts`.
2. Keep preload forwarding mechanical. Validate untrusted arguments in the owning main-process handler or service before mutation; TypeScript types alone are not runtime validation.
3. Put transactions and jobs in services/modules. Keep pure contracts in `@cat/core` and reusable headless workflows in `@cat/localization`.
4. Update the relevant handler and preload tests together. For UI async changes, test delayed completion, rejection, and newer edits arriving during an older request; use the editor smoke suite for interaction regressions.

Choose the commands from the [validation matrix](DEVELOPMENT.md#validation-strategy). Renderer changes use adjacent component/hook tests and [desktop e2e](DEVELOPMENT.md#desktop-e2e-and-packaging); IPC changes also require desktop typecheck and architecture validation.
