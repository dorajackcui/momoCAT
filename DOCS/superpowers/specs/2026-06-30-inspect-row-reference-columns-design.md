# Inspect Row Reference Columns Design

## Goal

Make file inspect output usable as a row-level TM/TB reference API.

Today, inspect runs window or window-partial prompt composition in batches. The
`MT User Prompt` field correctly shows the full prompt sent for the window, but
the per-row `TM for MT` and `TB for MT` spreadsheet columns also use the full
window-level reference blocks. That makes a single inspect row look like it used
TM/TB references from neighboring rows.

The desired behavior is:

- `MT User Prompt` stays unchanged and continues to show the real full window
  prompt.
- `TM for MT` shows only the current row's selected TM and concordance
  references.
- `TB for MT` shows only the current row's selected TB references.

## Scope

This change is owned by `@cat/localization`, not by desktop renderer code.
Desktop `Inspect` already delegates to the shared `LocalizationInspector`, so
the fix should automatically apply to desktop and CLI inspect.

In scope:

- `packages/localization/src/LocalizationInspector.ts`
- `packages/localization/src/LocalizationInspectorArtifacts.ts`
- Tests for inspect artifact or spreadsheet-field generation

Out of scope:

- Changing the actual MT batch prompt.
- Changing TM/TB matching or selection policy.
- Changing desktop IPC, preload, file-card UI, or save dialog behavior.
- Changing the JSON artifact schema unless tests show a small compatible helper
  field is necessary.

## Design

Add a row-level xlsx field builder for inspect units.

The existing `buildXlsxFields(mt, unitIndex, maxCellChars)` derives all xlsx
prompt helper fields from a batch `PromptArtifact`. For window prompts,
`mt.tmPromptBlock`, `mt.concordancePromptBlock`, and `mt.tbPromptBlock` are
window-level blocks by design.

Introduce a helper shaped like:

```ts
buildUnitXlsxFields({
  mt,
  unit,
  unitIndex,
  maxCellChars,
})
```

The helper should build:

- `mtUserPrompt` from `mt.userPrompt`, preserving the full batch prompt.
- `tmForMt` from `unit.tm.selectedReferences.tmReferences` and
  `unit.tm.selectedReferences.concordanceReferences`.
- `tbForMt` from `unit.tb.selectedReferences`.

The formatting should mirror the existing window reference block style closely:

- TM header: `TM References`
- Concordance header: `Concordance Suggestions`
- TB header: `Terminology References`
- Preserve TM names, similarity, matched source text, source text, target text,
  term source, term target, and term note when available.

Continue to use `truncateForCell` for every spreadsheet cell, with JSON refs
that point at the current unit.

## Data Flow

`LocalizationInspector.inspectRowsWindowMode` and
`LocalizationInspector.inspectRowsWindowPartialMode` already compute row-level
reference artifacts through `inspectRowReferences`.

After composing the batch prompt:

1. Keep assigning the shared batch `mt` artifact to each ready unit.
2. Build each unit's xlsx fields from that unit's own `tm` and `tb` artifacts.
3. Leave `unit.mt.userPrompt` and `unit.mt.batch` as the real batch prompt
   evidence.

This gives inspect consumers both views:

- Full prompt evidence in `mt` / `MT User Prompt`.
- Row-scoped reference API output in `TM for MT` and `TB for MT`.

## Error Handling

Reference inspection errors are unchanged. If TM or TB inspection fails for a
row, that row remains an error unit and keeps empty xlsx fields.

Prompt composition errors are unchanged. If composing the batch prompt fails,
the affected ready rows become error units with their already-collected TM/TB
artifacts preserved for JSON inspection.

## Testing

Add focused tests that construct a window inspect batch with at least two ready
rows where each row has distinct TM/TB selected references.

Assertions:

- Row 1 `xlsx.tmForMt` contains only row 1 TM/concordance references.
- Row 1 `xlsx.tbForMt` contains only row 1 TB references.
- Row 2 `xlsx.tmForMt` contains only row 2 TM/concordance references.
- Row 2 `xlsx.tbForMt` contains only row 2 TB references.
- `mt.userPrompt` still contains the real batch prompt and can mention multiple
  current ids.

Also keep or add a helper-level test for truncation so the new row-level fields
continue to honor `maxCellChars`.

## Success Criteria

- Desktop and CLI inspect outputs show row-specific TM/TB helper columns.
- Full window prompt output remains unchanged.
- No desktop IPC or UI changes are needed.
- Existing inspect tests pass after updating expected row-level TM/TB behavior.
