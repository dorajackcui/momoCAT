# Desktop File Tag Policy Design

Date: 2026-06-23

## Purpose

Add a desktop equivalent of the existing headless `tagPolicy: none` behavior for
project files. The policy must be chosen when a file is imported, stored as a
file-level rule, and then reused everywhere that file text is converted between
plain strings and CAT tokens.

The goal is simple: if marker-like text is ordinary business text in a file, the
desktop app must not protect, validate, render, or repair it as CAT tags.

## Why This Is Necessary

CLI file translation already supports `--tag-policy none`. Desktop does not.
That makes some files safe in CLI but unsafe in the CAT editor.

The desktop gap starts at import time. `SpreadsheetFilter.import()` currently
parses source and target cells with the default tag policy. Text such as `{1}`,
`{1>`, `<2}`, `<xxx>`, or `%s` can become tag tokens before AI translation even
starts. A translate-time-only option would be too late because `sourceTokens`,
`tagsSignature`, `matchKey`, and `srcHash` have already been built under the
wrong interpretation.

Therefore the policy belongs to the file, not to one AI request.

## Policy

Use the existing core policy values:

- `default`: current behavior. Marker-like text can become CAT tag tokens.
- `none`: marker-like text remains ordinary text. CAT tag parsing, protected
  marker parsing, and tag validation are skipped for this file.

Omitted policy means `default` so existing files and projects keep current
behavior.

## Design

### Import

Extend desktop `ImportOptions` with:

```ts
tagPolicy?: 'default' | 'none';
```

The file import UI exposes this as an import option, defaulting to `default`.
The selected value is saved in the existing `files.importOptionsJson` field.

`SpreadsheetFilter.import()` resolves the import policy and passes it into:

- `parseDisplayTextToTokens(sourceText, { tagPolicy })`
- `parseDisplayTextToTokens(targetText, { tagPolicy })`

It then computes `tagsSignature`, `matchKey`, and `srcHash` from those tokens as
it does today.

### File Policy Resolver

Add one small desktop helper that reads `ProjectFileRecord.importOptionsJson`
and returns a normalized policy:

```ts
resolveFileTagPolicy(file): 'default' | 'none'
```

Invalid, missing, or unknown values resolve to `default`. This keeps old files
safe and avoids scattering JSON parsing across renderer and main-process code.

### Editor

When the editor opens a file, it already loads the file record before loading
segments. Store the resolved file tag policy in editor state.

All editor text-to-token paths must use the file policy:

- Manual target edits.
- Applying a term to the active target.
- Any local conversion of editor text back into `targetTokens`.

Rendering should remain token-driven:

- Text tokens render as ordinary text.
- Tag tokens render as CAT tags.
- Source tag insertion controls derive from `sourceTokens` with
  `token.type === 'tag'`.

No separate "hide tag rendering" mode is needed. If a `tagPolicy: none` file was
imported correctly, marker-like text is already text tokens and the existing
renderer naturally treats it as ordinary text.

### AI Workflows

Every desktop AI path that converts between strings and tokens must use the file
policy:

- File translation through `runLocalizationFileTranslation`.
- Standard file translation fallback.
- Dialogue file translation.
- Single-segment translate.
- Single-segment refine.
- `AITextTranslator` response parsing and validation.

For `tagPolicy: none`:

- Source payloads should be plain display text, not protected-marker text.
- Provider responses should parse as plain text tokens.
- Tag validation and tag-repair retry should be skipped.

For `default`, behavior remains unchanged.

### QA, Export, And TM

QA should keep using segment tokens. A `tagPolicy: none` file has no CAT tag
tokens for marker-like text, so tag QA naturally has nothing to preserve.

Export should keep writing token content back to the target cell. This preserves
both real tag tokens under `default` and ordinary marker-like text under `none`.

Commit-to-main-TM should keep storing the segment tokens, `matchKey`, `srcHash`,
and `tagsSignature` that were created under the file policy.

External TM import remains out of scope for this version and continues to use
the default policy. If a `tagPolicy: none` project file needs exact matches
against marker-like ordinary text, the TM data must already have compatible
tokens or a later TM-import policy feature will be needed.

## Non-Goals

- No migration or reparse tool for files that were already imported.
- No project-level default policy.
- No TM/TB import policy changes.
- No new policies such as `html-only` or `custom`.
- No prompt template rewrite beyond passing and honoring the policy in desktop
  AI paths.

Already imported files that need marker-like text treated as ordinary text
should be re-imported with `tagPolicy: none`.

## Affected Areas

- Shared IPC types for `ImportOptions`.
- File import UI (`ColumnSelector`) and import flow.
- `SpreadsheetFilter.import()`.
- File-policy resolver for main and renderer use.
- Editor data loading and editor text-to-token conversion.
- Desktop AI file translation and segment translation workflows.
- `AITextTranslator` tag-policy-aware parsing and validation.
- Focused tests around import, editor editing, AI writeback, and default
  backwards compatibility.

## Risks

- Partial propagation is worse than no feature. If one path still parses with
  the default policy, marker-like text can silently turn back into tag tokens.
- Single-segment AI paths are easy to miss because they do not use the
  localization `MTModule`.
- Prompt wording may still mention protected markers in some legacy desktop
  text prompts. This is acceptable only if `tagPolicy: none` responses are
  parsed and validated as plain text; prompt cleanup can follow separately.
- TM imported under the default policy may not match a `tagPolicy: none` file
  exactly. This is an accepted v1 boundary.

## Test Plan

Add focused tests for:

- Importing `Save {1} <xxx> %s` with default policy creates tag tokens.
- Importing the same text with `tagPolicy: none` creates a single text token and
  an empty tag signature.
- Opening a `tagPolicy: none` file and editing target text with `{1}` keeps it as
  text tokens.
- Applying terms or AI results containing marker-like text in a `tagPolicy:
  none` file keeps them as text tokens.
- File translation forwards `tagPolicy: none` into localization runtime.
- Single-segment translate/refine parse provider output as text under
  `tagPolicy: none`.
- Existing default-policy tests remain unchanged.

## Success Criteria

- Default desktop import, editor, AI, QA, TM, and export behavior is unchanged.
- A newly imported `tagPolicy: none` file never treats marker-like source,
  target, editor, or AI output text as CAT tags.
- The policy is visible as file-level import configuration and is saved with the
  file.
- The implementation is small enough that every string-to-token conversion for a
  project file has an obvious policy source.
