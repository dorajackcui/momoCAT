# Desktop File Inspect Design

Date: 2026-06-29

## Purpose

Add a desktop file action named `Inspect` that runs the same localization
inspection behavior currently available from the CLI:

```bash
momocat inspect localization --project-id <project-id> --input <file> --output <inspect.xlsx>
```

The action should produce an inspection workbook and JSON sidecar that show the
TM, concordance, TB, and prompt artifacts for source rows without sending
provider requests.

## User Flow

In a translation project, each file card gets an `Inspect` action alongside the
existing file actions. Clicking it opens a save-file dialog with a default name
such as `demo_inspect.xlsx`.

After the user chooses a path, desktop runs inspection and writes:

- The selected `.xlsx` inspection workbook.
- The inferred `.json` sidecar next to it, matching CLI inspect behavior.

Success and failure are reported through the existing feedback service.

## Design

Use the shared `@cat/localization` `LocalizationInspector` as the source of
truth. Desktop should only bridge file identity, import options, and output
selection into that shared inspector.

The renderer adds a small action to `ProjectFilesPane`:

- `Inspect` is shown only for translation projects.
- It asks for a `.xlsx` output path.
- It calls a new preload API method: `inspectFile(fileId, outputPath)`.

The preload and IPC layers add a thin file channel:

- `IPC_CHANNELS.file.inspect`
- `DesktopApi.inspectFile(fileId, outputPath)`
- `projectHandlers` delegates to `ProjectService.inspectFile`.

The main process resolves desktop file context:

- Load the file record by `fileId`.
- Load the owning project.
- Resolve the stored input path from `projectsDir/<projectId>/<fileId>_<fileName>`.
- Parse `importOptionsJson` for source, target, context, header, and tag policy.
- Call `LocalizationInspector.inspectFile`.

Inspector options must match the requested desktop behavior:

- `requestMode: 'window-partial'`
- `targetBaseline: 'ignore-current-targets'`
- `tagPolicy` from the file import options
- `columns` from the file import options

Using `ignore-current-targets` is intentional. This desktop action is for
inspecting source rows and their TM/TB/prompt artifacts; existing target cells
should not cause source rows to be skipped.

## Architecture

This follows the repository boundary direction:

- Renderer owns UI state and save-dialog orchestration.
- Preload stays a typed bridge.
- IPC handlers stay thin.
- Desktop service code owns app-level file lookup.
- Shared localization owns inspect behavior and artifact generation.

No TM/TB matching, prompt composition, or inspect workbook formatting should be
duplicated in desktop.

## Error Handling

The action fails before inspection when:

- The file record does not exist.
- The project record does not exist.
- Import options are missing or invalid enough that source/target columns cannot
  be resolved.
- The stored source workbook is missing.

The shared inspector continues to own row-level inspect errors. If a specific
row cannot inspect TM, TB, or prompt artifacts, that error is represented in the
inspect output the same way as CLI.

Renderer feedback should include the error message in a concise form, matching
the existing export and QA actions.

## Non-Goals

- No separate desktop-only TM/TB export format.
- No custom inspect modal or preview in this change.
- No provider requests.
- No changes to CLI syntax.
- No reinspection of current edited targets. Source-row inspection should not be
  gated by existing target content.

## Test Plan

Add focused coverage for:

- `ProjectFilesPane` renders and wires `Inspect` for translation projects.
- The renderer handler opens a save dialog and calls `apiClient.inspectFile`.
- Preload maps `inspectFile` to the new IPC channel.
- IPC handler registration includes the new file channel.
- `ProjectService.inspectFile` delegates to the file module.
- The main-process inspect path passes stored file path, import columns, file
  tag policy, `requestMode: 'window-partial'`, and
  `targetBaseline: 'ignore-current-targets'` to `LocalizationInspector`.

## Success Criteria

- Desktop file cards expose an `Inspect` action for translation projects.
- Running it creates the same kind of inspect workbook and JSON sidecar as CLI.
- TM/TB/prompt artifacts are generated from source rows even when target cells
  already contain text.
- Desktop does not duplicate shared inspect logic.
- Existing export, QA, AI translate, TM match, and file open actions keep their
  behavior.
