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

## Workspace navigation

The renderer has a project sidebar and one content area. Project pages order **Tasks | AI provider | Translation memory | Term bases | QA**; global Settings orders **AI Connections | Proxy | Term Extraction | Appearance | Updates**. Global TM/TB catalogs manage resources; project resource tabs manage mounting. Each task is an imported file.

CAT hides the sidebar. Returning to the project restores direct navigation. Project menus support keyboard dismissal, persistent pinning, and typed-name confirmation for deletion. Pinned and regular project sections collapse independently and restore their local preferences across launches. Project icons show T or C for Translation or Custom projects; an unspecified type uses T.

Clicking a task title or non-control row space opens the file; rename fields and actions handle their own clicks. Task actions stay visible with right-side breathing room and wrap on narrow windows. Rows distinguish confirmation progress, QA issue count, and background-job progress. Global TM/TB catalogs use responsive cards; their entry previews show at most ten rows.

[`useWorkspaceNavigation`](../apps/desktop/src/renderer/src/hooks/useWorkspaceNavigation.ts) owns guarded transitions. Leaving CAT awaits a save guard and makes the content inert during the transition. Failed saves retain the current editor and draft; overlapping transitions are blocked. Reopening a file restores its last active segment for the current session if that segment remains in the persisted filtered view.

[Navigation tests](../apps/desktop/src/renderer/src/hooks/useWorkspaceNavigation.test.ts), [sidebar tests](../apps/desktop/src/renderer/src/components/WorkspaceSidebar.test.tsx), and the [editor smoke suite](../apps/desktop/e2e/editor-engine.smoke.spec.ts) cover navigation, save failures, project actions, and CAT return.

## Project and global settings

### Layout and resources

Project configuration and global Settings share left alignment and content width; Tasks uses a wider list. The theme's muted page background separates independent surface-colored cards with neutral outlines. Headings use sentence case; helpers are secondary text. Headings and action rows have no separate fill.

TM/TB, saved connection, and provider cards keep content left and actions right, vertically centered. TM/TB counts sit beside the actions. Working TM places its update explanation below the section heading. Unmount and Reset use the danger tone. The extraction prompt library and editor sit side by side on wide windows and stack on narrower windows.

[`ProjectPanelParts`](../apps/desktop/src/renderer/src/components/project-detail/ProjectPanelParts.tsx) owns shared project sections, resource cards, and save footers. Shared layout classes live in [index.css](../apps/desktop/src/renderer/src/index.css); control geometry and colors follow the [UI foundation](#ui-foundation). Keep exact spacing in these owners rather than duplicating it in page components.

### Drafts and options

AI provider and QA keep independent drafts and persistence. Drafts survive tab switches; saving disables the active form, failed saves retain changes, and delayed saves cannot update another project. Save/Discard appears only while dirty or saving; the saved state has no footer. AI prompt preview and test disclosures place chevrons on the right and retain native keyboard toggling.

[QA settings](../apps/desktop/src/renderer/src/components/project-detail/ProjectQASettingsPane.tsx) uses the shared [QA presentation catalog](../apps/desktop/src/renderer/src/components/qaSections.ts) for category and check order, also used by the result panel. Options open a compact shared Modal and edit the page draft. Done, Close, Escape, and outside dismissal retain draft changes and restore focus; only page Save persists them, and Discard restores saved settings. Disabled checks can have their options edited without enabling them. Select all/Clear affects major checks and preserves child options. Check semantics and defaults belong to [Localization](LOCALIZATION.md#quality-assurance).

Settings > Appearance groups Color scheme and Fonts in separate cards; the CAT appearance popup uses the same controls in a compact layout. Settings > Updates renders the application package version and the controller from [`useAppUpdates`](../apps/desktop/src/renderer/src/hooks/useAppUpdates.ts), which owns app-wide update subscriptions and notifications.

[Settings behavior tests](../apps/desktop/src/renderer/src/components/project-detail/ProjectSettingsPane.test.tsx) and [settings E2E](../apps/desktop/e2e/project-settings.smoke.spec.ts) cover independent drafts, persistence, option dismissal, resource actions, tab order, and three-theme layouts at wide and narrow widths.

## QA panel and feedback

### Running and displaying results

CAT / Concordance / QA share the editor's right panel. Run QA flushes pending edits, then dispatches whole-file QA to a worker. Editing, filters, and navigation remain available; concurrent runs of the same file share one operation. Completion patches QA fields only. The renderer rejects results for another file or a changed local content revision, including unsaved edits. Persistence and result retention follow the [QA lifecycle](LOCALIZATION.md#qa-result-lifecycle).

The [QA panel](../apps/desktop/src/renderer/src/components/editor/QAPanel.tsx) groups findings by category, then by source or term pair where applicable. Known categories follow the settings catalog; unknown categories follow them. Category headers are visually stronger than group labels and separated by fine rules. Categories start expanded and collapse independently of filtering; groups remain expanded. Counts show numbers only, with units in accessible labels. Grouped rows show the current target (source for reverse consistency), avoiding repetition of the group's expected translation. Ungrouped checks retain diagnostic details.

Reference rows are deduplicated per group and excluded from finding counts. A summary opens a representative reference with affected rows; View all includes every reference row. Long previews truncate with full text on hover; terminology origins appear on group tooltips. Large reports use a single virtual viewport while counts and filtering still include all findings.

### Filtering and freshness

Category names and group buttons filter affected CAT rows, including collapsed categories. Row items navigate to their segment. Entering QA filtering clears ordinary filters; exiting clears all filters without restoring the previous state. The selected row set stays stable while editing.

| Result state                                      | Panel behavior                                   |
| ------------------------------------------------- | ------------------------------------------------ |
| No saved result                                   | Unchecked                                        |
| Reopened saved result, including an empty array   | Recheck warning: freshness is unverified         |
| Content changed after loading or checking         | Retain findings and mark for recheck             |
| Status-only change                                | Retain findings without marking a content change |
| Whole-file check running                          | Checking takes precedence over the stale warning |
| Whole-file check accepted for the current content | Clear the recheck warning                        |

Panel, inline feedback, and file counts use the segment result source. [`useSegmentConfirmation`](../apps/desktop/src/renderer/src/hooks/editor/useSegmentConfirmation.ts) owns confirmation; editor composition calls [`refreshInstantQA`](../apps/desktop/src/renderer/src/hooks/editor/refreshInstantQA.ts) for the optional follow-up described in [Confirm and instant QA](LOCALIZATION.md#confirm-and-instant-qa). Save errors and QA feedback remain separate.

[QA hook tests](../apps/desktop/src/renderer/src/hooks/editor/useEditorQA.test.tsx), [panel tests](../apps/desktop/src/renderer/src/components/editor/QAPanel.test.tsx), and [QA E2E](../apps/desktop/e2e/qa.smoke.spec.ts) cover retention, filters, late results, and large-file responsiveness.

## UI foundation

### Ownership and shared controls

[`components/ui`](../apps/desktop/src/renderer/src/components/ui/index.ts) is the shared control boundary for workspace and CAT. Radix Dialog/Tabs, Floating UI, and Class Variance Authority remain private to this layer. Pages use its controls and semantic roles; they do not import primitive libraries or recreate popup lifecycles.

| Owner                                                                   | Responsibility                          |
| ----------------------------------------------------------------------- | --------------------------------------- |
| [styles.css](../apps/desktop/src/renderer/src/components/ui/styles.css) | Shared control appearance               |
| [metrics.css](../apps/desktop/src/renderer/src/theme/metrics.css)       | Control sizes and radii                 |
| [palettes.css](../apps/desktop/src/renderer/src/theme/palettes.css)     | Palette values and semantic color roles |
| [typography.css](../apps/desktop/src/renderer/src/theme/typography.css) | Font stacks, type scales, reading roles |
| [index.css](../apps/desktop/src/renderer/src/index.css)                 | Application layout and editor rendering |

Portals inherit document-level tokens. Tailwind utilities map to those owners; page classes express layout, visibility, and content typography rather than overriding shared control appearance. The shared Icon catalog uses adopted Lucide shapes with its license in [public/licenses](../apps/desktop/src/renderer/public/licenses).

- `Modal` owns dialog semantics, scrolling, backdrop, focus trapping, Escape and focus restoration. Every dialog has a title. Omit `onClose` for a blocking operation; `closeOnBackdrop={false}` only disables outside dismissal. Shared controls defer their `autoFocus` until the modal's focus boundary mounts. Dialogs portal in opening order; callers do not assign stacking overrides. `FeedbackHost` owns confirmation queues and typed-name validation, while job controllers retain cancellation and completion handling.
- `Menu` and `Popover` share positioning, viewport collision handling, portals and dismissal. A menu uses `MenuItem` for keyboard navigation and closes before its action runs. Anchors are elements or element refs. Dismiss callbacks explicitly close their popup and tolerate repeated calls; they do not toggle visibility. Popups opened inside a modal stay inside its accessibility/focus boundary; Escape dismisses the popup first. Editor selection remains in the editor controller, not in the popup.
- `Tabs`, `TabsList`, and `TabsPanel` own tab roles, panel associations, roving focus, arrow/Home/End navigation and automatic activation. The page still owns the selected value and data loading. Inactive page content is unmounted. The `segmented` variant provides compact, softly selected reference tabs.
- `Button`, `IconButton`, `ToggleButton`, `Input`, `Select`, `Textarea`, `Checkbox`, and `Radio` preserve native events and refs. Buttons default to `type="button"`; form submission must opt into `type="submit"`. Button `variant` selects appearance, `tone` selects color (including `danger`), and `size` selects `xs` through `lg`. The `link` variant inherits surrounding typography and has no padding or size prop. Tone, variant, size, and field appearance belong to the control API; page `className` props express layout, visibility, and content typography only. Form appearance and sizing have one definition in `controlVariants`, shared with the button size scale. `SearchInput` owns its icon, inset spacing, and optional trailing action while forwarding the input ref and native events. `SearchInputGroup` owns the shared border, equal field widths, divider, and individual focus indication for paired searches. Native selects retain browser keyboard behavior.
- `Switch` exposes a controlled boolean through `role="switch"` and `aria-checked`, with native button keyboard behavior. Use it for on/off settings; its callback receives the next boolean value.
- `ControlGroup` groups related icon buttons in horizontal or vertical layouts without changing their individual callbacks, disabled states, focus, or popup anchors. Its outlined variant contains active-segment AI/tag actions; its plain variant groups CAT toolbar actions separated by vertical rules.
- `ChoiceGroup` presents a single selection as segments or cards using native radios; it owns checked/focus/disabled styles and browser radio navigation. Pages supply options, the selected value, and the business callback. `ToggleButton` remains the control for independent pressed states. Specialized workspace navigation, the editor resize handle, and token rendering stay in their domain components.

The [UI boundary check](../apps/desktop/src/renderer/src/components/ui/boundary.test.ts) and [design ownership check](../apps/desktop/src/renderer/src/theme/designBoundary.test.ts) enforce these boundaries through `npm run gate:style`. [Feedback tests](../apps/desktop/src/renderer/src/services/FeedbackHost.test.tsx) and [UI controls E2E](../apps/desktop/e2e/ui-controls.smoke.spec.ts) cover focus, nesting, menus, choices, and native form behavior.

### Appearance and semantic colors

Workspace and CAT have independent saved color and typography preferences. Workspace defaults to Sand; CAT defaults to Classic. Both also offer Nord through the shared [AppearancePicker](../apps/desktop/src/renderer/src/components/ui/AppearancePicker.tsx). [ThemeProvider](../apps/desktop/src/renderer/src/theme/ThemeProvider.tsx) applies the active scope's palette to the document root; switching scope restores its preference without remounting the editor. Storage failures do not block switching.

[colorThemes.ts](../apps/desktop/src/renderer/src/theme/colorThemes.ts) owns labels and defaults; [themePreferences.ts](../apps/desktop/src/renderer/src/theme/themePreferences.ts) owns restoration. Charcoal preferences migrate to Nord; unsupported values fall back to the active scope's default. Palette source comments identify upstream colors and application adjustments.

- Brand roles identify primary actions, selected choices, and running progress. `brand-solid` pairs with `brand-contrast` for filled actions; `brand` serves contrasting small text. Auxiliary actions and persistent in-use labels are neutral.
- Green identifies successful outcomes, confirmation progress, and added diff text. Import mapping uses brand for source/input, info for target/output, and neutral for context.
- `navigation`, `surface`, `surface-chrome`, and `surface-panel` distinguish sidebar, content, toolbars, and supporting panels. CAT chrome/panels alias `editor-surface`. Alternating rows use the filtered/sorted display order consistently across virtualized and full lists.
- `border-subtle` separates regions; `border` outlines controls. The active target and selected TM result use `shadow-active`. Status, match badges, QA, search, selection, caret, and focus have independent semantic roles.
- Reference badges use green for exact matches, blue for fuzzy, gold for TB, and neutral gray for concordance, with white lettering. Resource provenance remains in tooltips and accessible labels.

[Theme tests](../apps/desktop/src/renderer/src/theme/ThemeProvider.test.tsx) cover preference restoration and failures; [theme E2E](../apps/desktop/e2e/editor-themes.smoke.spec.ts) covers palettes, portals, editing continuity, and Custom projects.

### Typography

[typography.ts](../apps/desktop/src/renderer/src/theme/typography.ts) owns Chinese/Western font choices, sizes, and scoped preferences. The default is Noto Sans SC with Source Serif 4 at 16px; alternatives are Noto Serif SC, Source Sans 3, and 14px. Missing saved sizes use 16px; the retired Western Noto choice falls back to Source Serif 4 while preserving the Chinese choice.

[TypographyProvider](../apps/desktop/src/renderer/src/theme/TypographyProvider.tsx) applies choices without remounting content. Controls keep the interface sans-serif stack. CAT source/target, reference text, context, and workspace previews use separate named reading roles, so changing one does not resize unrelated labels. CAT Western body text uses the typography owner's fixed-weight aliases; Chinese fallback and interface weights remain independent. Context stays right-aligned, italic, single-line, and reveals full text on hover.

Pinned Fontsource packages bundle fonts offline with notices in [public/licenses](../apps/desktop/src/renderer/public/licenses). [Typography tests](../apps/desktop/src/renderer/src/theme/TypographyProvider.test.tsx) and [typography E2E](../apps/desktop/e2e/editor-typography.smoke.spec.ts) cover restoration, scripts, sizes, font loading, and editing continuity.

## Editor interaction

The CAT toolbar groups AI Translate/QA, selected-target actions, and display/appearance controls. Sort, paired source/target searches (including target/context switching), Filter, and Clear share one filter row. Search fields have equal widths independent of segment-column resizing. The header shows confirmation progress; reference tabs and resource provenance stay in the right panel.

Workflow status is separate from QA: Empty/Draft use a hollow circle and Confirmed a solid green circle beside the target, with accessible labels. QA uses neutral findings and tooltips without recoloring segment backgrounds; save failures use their own error indicator. Operational QA boundaries belong to [QA entrypoints](LOCALIZATION.md#qa-entrypoints).

The CAT filter popup contains Status (All, Empty, Draft, Confirmed), QA (All, QA problems, Save error), and String (First repetition). Status and QA allow multiple selections: choices within a group are ORed, and the groups plus First repetition are ANDed. All clears only its own group; no selected values means unrestricted. A shared settings icon button beside the search fields opens the search match mode menu (Contains, Exact, Regex); its tooltip names the current mode and the menu marks that selection. Repeat filtering reuses cached source roles. Saved filters restore the selected status array, QA array and repeat toggle; older single statuses and quick presets are converted at the storage boundary, and saved QA error/warning choices become QA problems. Segment persistence follows [Data model](DATA_MODEL.md#projects-and-files).

Segment selection uses Shift-click on row numbers, source cells, or target cells for a range in display order and Ctrl-click (Cmd-click on macOS) for individual toggles. Focused row numbers accept Enter or Space with the same selection modifiers. Ctrl/Cmd+Shift+A selects all current filter matches, including virtualized rows outside the viewport; ordinary text-selection shortcuts remain with the text editor. Contiguous selected targets share one focus outline. Selection reads the displayed list, including its sort order and search debounce, rather than resolving a separate filter scope. Selection follows the editor's stable filtered view; editing a result does not remove it until the filter criteria change. Changing filters drops hidden selected IDs without selecting newly visible rows. The toolbar exposes Clear target, Source → Target, and Confirm with tooltips. Ctrl/Cmd+Enter confirms a multi-selection. Clicking a segment body returns to single selection.

[`useEditorSelection.ts`](../apps/desktop/src/renderer/src/hooks/editor/useEditorSelection.ts) owns selection; [`useSelectedSegmentActions.ts`](../apps/desktop/src/renderer/src/hooks/editor/useSelectedSegmentActions.ts) snapshots selected IDs, flushes pending drafts, and submits the selected updates. Clear and copy set Empty or Draft according to target content. Selected rows commit together through `updateSelectedSegments`. This service transaction validates file membership, updates statistics and Working TM, and disables repeat propagation so no unselected target changes. Editing and navigation are blocked during the operation; failed writes leave targets and statuses intact. [`editor-selection.smoke.spec.ts`](../apps/desktop/e2e/editor-selection.smoke.spec.ts) covers selection, filtered actions, and persistence in Electron.

## Editor persistence and events

The active segment exposes one AI button: empty targets translate immediately; existing targets open a refinement popover with an instruction field and an explicit Retranslate action. Escape returns focus to the target editor, while outside dismissal respects the clicked control. Both AI actions await pending segment saves before dispatch. The tag insertion button remains separate. Rows have a shared 64px minimum/estimated height and grow with text and feedback; popovers do not participate in row sizing.

`Editor` composes filters and batch actions with the `useEditor` state controller. `useEditor` composes the segment store, persistence, QA, data loading, and references. Rows edit token-backed local state optimistically; `useSegmentPersistence` coalesces writes per segment and serializes requests for that segment. Different segments may save concurrently.

Confirmation and explicit actions that require saved data must await `flushSegmentUpdate` or `flushAllSegmentUpdates`. A failed save rejects the flush, leaves a visible save error, and retains the latest unsaved target for retry. An older failed request must not replace a newer queued edit. Automatic debounce catches rejection only after recording the failure; an explicit flush must observe it.

Confirmation flushes all pending segment saves, then applies the server's confirmed result and propagated IDs before advancing focus. This result supersedes queued draft echoes for the affected segments. Other remote updates retain the editing and persistence delay guards.

`SegmentService` owns the database transaction. The renderer must not independently recalculate repeat propagation or commit Working TM entries. After commit, segment events update the renderer and reference-change events invalidate matching caches.

Remote event coordination belongs in `useEditorDataLoader`:

- Ignore events for other files and stale echoes identified by `clientRequestId`.
- Delay an event while its direct segment or any propagated follower is being edited or has an outstanding local save.
- Apply a batch through the segment store, preserving event order and publishing only the affected segment identities.

The editor's unload/pagehide hooks start a best-effort flush. They are not an awaited application-close protocol; do not use them as proof that pending writes survive immediate process termination.

## Files and background jobs

`ProjectFileModule` owns project file workflows behind `ProjectService`. Renderer file dialogs and hooks collect options and display outcomes; shared parsing and localization behavior stays behind the application adapter. File-level tag policy is persisted with import options and reused throughout the file lifecycle.

Paste imports name the task from the first five filename-safe characters of the first non-empty segment plus the local date (`YYYY-MM-DD`), retaining the CSV extension and adding a numeric suffix on collisions.

For Translation and Custom projects, the CAT editor toolbar's AI Translate / AI Process action defaults to the current filtered results when filters are active and offers the entire file as an alternative. Opening the dialog snapshots all matching segment IDs using the latest filter input, including context searches. Display sorting does not change translation order. The Tasks tab processes entire files. Both project types offer preserving existing outputs or regenerating unconfirmed rows. Planning, confirmed-row locking, and selected-scope result identity follow the [localization contract](LOCALIZATION.md#mt-request-planning).

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
