# Literal Newline Escape Protected Markers Implementation Plan

> Correction note: The protected token is the literal two-character escape text
> (`\\r` / `\\n`), not real CR/LF line break characters.

**Goal:** Convert literal `\\r` and `\\n` escape sequences into `{n}` protected
markers in the default CAT token flow, then restore those literal sequences
after MT responses are parsed. Actual CR/LF characters stay ordinary text.

**Architecture:** Keep the behavior in `@cat/core`, where token parsing,
editor-marker serialization, editor-marker parsing, and tag QA already live.
Headless MT paths benefit automatically because they already use
`parseDisplayTextToTokens`, `serializeTokensToEditorText`,
`parseEditorTextToTokens`, and `TagValidator`.

**Tech Stack:** TypeScript, Vitest, `@cat/core/tag`, `@cat/core/qa`,
`@cat/localization` MT module tests.

## File Structure

- Modify `packages/core/src/tag/index.test.ts`: coverage for parsing literal
  `\\r`/`\\n`, serializing them as `{n}` markers, parsing them back, keeping
  actual CR/LF plain text, and keeping `tagPolicy: none` plain.
- Modify `packages/core/src/qa/index.test.ts`: coverage proving a missing
  repeated literal newline escape marker is an error.
- Modify `packages/localization/src/modules/MTModule.test.ts`: coverage for MT
  prompt markerization and retry when a repeated literal newline escape marker
  is dropped.
- Modify `packages/core/src/tag/TagCodec.ts`: split literal `\\r`/`\\n` into
  protected standalone tag tokens under default tag policy; leave real CR/LF as
  text; parse raw literal escape tokens in editor responses as tag tokens.
- Modify `packages/core/src/tag/TagMapper.ts`: keep ordinary duplicate tag
  behavior, but allocate separate marker numbers for repeated literal newline
  escape token occurrences.
- Modify `packages/core/src/qa/tagIntegrity.ts`: count duplicate tag
  occurrences when computing missing and extra tags so repeated protected
  literal newline escapes can trigger MT retry.

## Tasks

- [x] Write RED tests for literal `\\r`/`\\n` tokenization, marker
  serialization, QA count validation, and MT retry.
- [x] Replace the previous real-newline detector with a literal escape detector.
- [x] Keep default-policy real CR/LF as ordinary text.
- [x] Keep `tagPolicy: none` plain for both literal escapes and actual CR/LF.
- [x] Preserve occurrence-scoped marker numbering for repeated `\\r`/`\\n`
  tokens.
- [x] Count duplicate protected tags in QA missing/extra validation.
- [x] Verify MT prompts send `Hello{1}world{2}again` for source
  `Hello\\nworld\\nagain`, retry when `{2}` is dropped, and restore target text
  as `Bonjour\\nmonde\\nencore`.

## Verification

Run targeted tests:

```bash
npx vitest run packages/core/src/tag/index.test.ts packages/core/src/qa/index.test.ts packages/core/src/TagValidator.test.ts packages/localization/src/modules/MTModule.test.ts
```

Run package builds:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/localization
```
