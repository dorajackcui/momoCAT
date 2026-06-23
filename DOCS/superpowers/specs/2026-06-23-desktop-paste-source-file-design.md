# Desktop Paste Source File Design

Date: 2026-06-23

## Purpose

Let users create a project file directly inside the desktop app by pasting a
single source column from another spreadsheet. This removes the current extra
step of creating a separate CSV/XLSX file only so it can be imported.

The feature feels like direct file creation, while internally preserving the
existing project file, segment, AI, QA, TM, and export behavior.

## User Scenario

The expected primary input is copied from WPS, Feishu, Excel, Google Sheets, or
similar spreadsheet tools. The user copies one source column with several rows,
then chooses the desktop app's paste flow.

Example pasted content:

```text
A
BB
CCC
```

This creates one new project file with three segments:

- source `A`, empty target
- source `BB`, empty target
- source `CCC`, empty target

Rows whose source cell is empty are skipped.

## Recommended Approach

Use a new paste-create flow that generates an internal CSV cache file and then
reuses the existing spreadsheet import path.

Flow:

```text
+ Add File -> Paste -> clipboard content -> editable paste modal
  -> IPC -> ProjectFileModule -> internal CSV cache
  -> SpreadsheetFilter.import() -> segments
```

The internal CSV has two columns:

- `Source`
- `Target`

All accepted pasted source cells are written into `Source`; `Target` is blank.
The generated file is then imported with:

```ts
{
  hasHeader: true,
  sourceCol: 0,
  targetCol: 1,
  tagPolicy: 'default'
}
```

The user-facing result is still a normal project file. It can be opened,
edited, translated with AI, checked with QA, matched against TM, committed to
TM, exported, and deleted through the existing desktop workflows.

## Alternatives Considered

### Direct Segment Insertion

The app can parse pasted text and write `segments` directly without creating
any cached source file. This avoids one internal file write, but it creates a
separate virtual-file path for export and cleanup. The current desktop export
logic expects a stored source file, so this would split behavior unnecessarily.

### Temporary External File Import

The app can write the paste content to a temp file and feed it to the
existing import flow. This is simple, but temp-file lifetime and cleanup become
less direct than storing the generated CSV in the existing project file cache.

## UI Design

The project detail page keeps one `+ Add File` entry, but it becomes a small
menu with two short choices:

- `Import`
- `Paste`

`Import` preserves the current spreadsheet file selection and column selector
flow.

`Paste` reads available clipboard content and opens a `Paste Source` modal.
The modal contains:

- a large editable text area prefilled from the clipboard when possible
- a `Marker Handling` select, defaulting to `Protect CAT markers`
- a preview summary showing the number of source segments that will be created
- a preview list of the first few parsed source cells
- `Cancel` and `Create File` actions

If the clipboard is empty, unavailable, or not text/table content, the modal
still opens with an empty text area so the user can paste manually.

## Clipboard Parsing

The parser prefers structured spreadsheet clipboard data over plain text.

Priority:

1. Parse HTML table data when available.
2. Parse structured TSV/CSV text, including quoted multi-line cells.
3. Fall back to plain text line splitting.

For table-like input, only the first column is used as source. Extra columns are
ignored. This supports accidental multi-column copies such as source plus target
without importing target text.

Cell handling:

- trim leading and trailing whitespace from each source cell
- skip empty source cells
- preserve internal line breaks inside one source cell when the clipboard
  format carries enough structure to identify them
- do not deduplicate, sort, or merge source cells

If only flattened plain text is available, the app cannot reliably distinguish
between a row break and a cell-internal line break. The preview makes the final
segment count visible so the user can correct the text before creating the
file.

## File Naming

Generated files use the first accepted source cell plus a timestamp:

```text
<first-source-summary>-<yyyy-mm-dd-hh-mm>.csv
```

Example:

```text
Login failed-2026-06-23-16-30.csv
```

The source summary is derived from the first non-empty parsed source cell.
Before using it in the file name:

- remove characters that are invalid on Windows or macOS file systems
- collapse repeated whitespace into a single space
- trim the result
- truncate long names to a readable 40-character prefix

If the cleaned summary is empty, use `Pasted Source`.

If a generated cache path already exists, append a small numeric suffix before
the extension.

## Tag Policy

The default paste-created file policy is `tagPolicy: 'default'`, matching the
desktop spreadsheet import default.

The paste modal exposes the same conceptual marker handling choice as import:

- `Protect CAT markers` -> `tagPolicy: 'default'`
- `Plain marker-like text` -> `tagPolicy: 'none'`

This keeps the safe default for CAT marker preservation while still allowing
users to treat marker-like text as ordinary source text when needed.

## Error Handling

Validation:

- If parsing produces zero valid source cells, disable `Create File` and show a
  clear empty-source message.
- If parsing produces many rows, show a soft warning above a practical threshold
  such as 5,000 rows, but still allow creation.

Failure cleanup:

- If creating the file record, writing the generated CSV, importing segments,
  or persisting segments fails, remove any created DB file record and generated
  CSV.
- Cleanup behavior mirrors the existing `addFileToProject` failure
  cleanup path.

## Implementation Boundaries

Keep the desktop UI thin:

- renderer owns menu state, modal state, preview display, and user
  confirmation
- preload exposes one typed API method for paste-created files
- IPC handlers delegate directly to `ProjectService`
- `ProjectService` delegates to `ProjectFileModule`
- `ProjectFileModule` owns generated CSV storage and import reuse

Reusable parsing and filename helpers are small pure functions with
focused tests. Avoid adding new database columns or a separate virtual-file
model.

## Non-Goals

- No new persistent schema.
- No project-level paste defaults.
- No target-column paste import in this version.
- No deduplication or row merging.
- No automatic repair of flattened plain text where cell-internal line breaks
  cannot be distinguished from row breaks.
- No changes to TM/TB import behavior.

## Test Plan

Add focused tests for:

- HTML table clipboard parsing uses the first column and preserves cell-internal
  line breaks.
- Multi-column pasted data imports only the first column.
- Empty source rows are skipped.
- Quoted TSV/CSV fallback supports multi-line cells.
- Plain text fallback splits by line.
- Generated file names use the first accepted source, sanitize invalid
  characters, truncate long summaries, fall back when empty, and avoid
  collisions.
- `ProjectFileModule` creates a generated CSV and reuses
  `SpreadsheetFilter.import()`.
- Failure after file record creation cleans up the DB file record and generated
  CSV.
- IPC/preload contract exposes the paste-create operation consistently.
- Renderer menu shows `Import` and `Paste`, and the paste modal disables
  creation when there are zero valid sources.

Validation includes desktop typecheck and the relevant Vitest suites. If
the menu/modal interaction changes enough to affect desktop behavior, run the
desktop smoke suite as well.

## Success Criteria

- A user can copy a source column from a spreadsheet app, choose `+ Add File ->
  Paste`, review the parsed sources, and create a normal project file.
- Target cells are empty by default.
- Empty source rows are skipped.
- Extra pasted columns are ignored.
- Structured clipboard data preserves cell-internal line breaks when possible.
- Generated file names are recognizable from the first source cell and
  timestamp.
- Paste-created files behave like imported spreadsheet files for edit, AI, QA,
  TM, export, and delete.
