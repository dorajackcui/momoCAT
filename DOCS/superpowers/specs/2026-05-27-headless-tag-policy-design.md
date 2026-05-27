# Headless Tag Policy Design

Date: 2026-05-27

## Purpose

Add a clean tag/protected-marker policy for headless localization so file
translate and localization inspect can opt out of CAT tag recognition when
input text has already been filtered by an upstream process.

The first version supports only:

- `default`: current behavior.
- `none`: do not recognize, generate, parse, or validate CAT tags/protected
  markers.

## Background

Headless localization currently builds transient segments with
`parseDisplayTextToTokens(source/target)`. That uses the default
`@cat/core/tag` display tag patterns and recognizes text such as `{...}`,
`<...>`, and printf placeholders as tag tokens.

The MT path serializes tag tokens with `serializeTokensToEditorText`, producing
memoQ-like protected markers such as `{1>`, `<2}`, and `{3}`. Responses are
parsed with `parseEditorTextToTokens`, and tag preservation validation can
retry when tags are missing or reordered.

This is correct for unfiltered text that genuinely contains CAT-managed tags.
It is incorrect for business text, or upstream-filtered text, where strings
such as `{1}`, `{1>`, `<2}`, `{3}`, `<xxx>`, or `%s` are ordinary content that
must not be interpreted by this system.

## Scope

In scope:

- Headless `translate file`.
- Headless `inspect localization`.
- `LocalizationEngine` and `LocalizationInspector` transient segment creation.
- MT response parsing and tag preservation validation in `@cat/localization`.
- File translation resume identity.
- CLI argument parsing and forwarding.
- Core tokenizer/parser policy support in `@cat/core/tag`.

Out of scope for this version:

- Desktop editor behavior.
- Desktop project file import behavior.
- TM import behavior.
- New policies such as `html-only`, `memoq-only`, or `custom`.
- Prompt template redesign.

TM import currently uses the default tokenizer and will keep doing so. A
`tagPolicy: none` headless run may therefore produce match keys and tag
signatures that do not exactly align with TM entries imported under the default
policy. That is an accepted v1 boundary.

## Policy Semantics

`default` keeps all current behavior:

- Display text can become text and tag tokens.
- Source tag tokens can be serialized into CAT protected marker payloads.
- MT responses can map CAT protected markers back to source tags.
- Tag preservation validation runs for translation/review flows.
- Resume identity is compatible with current default behavior.

`none` means the upstream text is already prepared and CAT must not perform a
second tag/protected-marker pass:

- Display source and target text become plain text tokens.
- `{1}`, `{1>`, `<2}`, `{3}`, `<xxx>`, `</xxx>`, and `%s` remain ordinary text.
- MT response text remains ordinary text; CAT protected markers are not mapped
  back to source tags.
- Tag preservation validation and tag-based retry feedback are skipped.
- File translation resume identity includes the policy so checkpoints are not
  reused across `default` and `none`.

## Prompt Boundary

Prompt builders do not need to know tag policy.

This feature does not introduce separate prompt templates, prompt rules, or
prompt branches for `default` and `none`. Prompt construction continues to use
the existing inputs and existing prompt builders.

The only indirect prompt difference is the payload produced before the prompt
layer:

- Under `default`, tag tokens may serialize to CAT protected marker text.
- Under `none`, tokenization produces plain text tokens, so localization passes
  the original text through as ordinary payload.

If the original text contains `{1>`, `<2}`, or `{3}` under `none`, there is no
prompt-layer interpretation step to add. Those strings remain part of the plain
payload produced by localization.

## Architecture

### Core

`@cat/core/tag` owns the pure policy-aware parsing behavior.

Add a shared type:

```ts
export type TagPolicy = 'default' | 'none';
```

Extend parser options so callers can choose a policy:

```ts
parseDisplayTextToTokens(text, { tagPolicy: 'none' })
parseEditorTextToTokens(text, sourceTokens, { tagPolicy: 'none' })
```

Existing call sites that omit the option keep `default`.

For compatibility, the current custom display pattern argument should continue
to work. The implementation can accept either the legacy `RegExp[]` argument or
an options object.

### Localization

`@cat/localization` owns policy propagation for headless workflows.

Add `tagPolicy?: TagPolicy` to translation options used by:

- `TranslateUnitsOptions`.
- `TranslateFileOptions.options`.
- `InspectFileInput.options`.
- Localization command configs for inspect and translate.

Resolve missing policy to `default` inside localization so non-CLI callers get
the same behavior as today.

Use the resolved policy when:

- Creating transient segments from external units.
- Parsing MT text responses into target tokens.
- Deciding whether to run tag preservation validation.
- Computing file translation resume fingerprints.

### CLI

`apps/cli` remains a thin shell.

Add `--tag-policy default|none` to:

- `momocat inspect localization`.
- `momocat translate file`.

CLI validates the string and forwards it to `@cat/localization`. It does not
import `@cat/core` and does not implement policy logic.

## Data Flow

For `translate file`:

1. CLI parses `--tag-policy` and forwards it.
2. Localization command puts the policy into `TranslateFileInput.options`.
3. File parsing reads spreadsheet cells without policy logic.
4. File job preparation includes the policy in resume fingerprint material.
5. Task execution creates transient segments with the policy.
6. MT module composes prompts from the resulting tokens.
7. MT module parses responses with the policy.
8. MT module skips tag validation when policy is `none`.
9. Final output writes display text from target tokens.

For `inspect localization`:

1. CLI parses `--tag-policy` and forwards it.
2. Localization command puts the policy into inspect input options.
3. Inspector creates transient segments with the policy.
4. Inspector composes prompt artifacts from the resulting tokens.
5. JSON/XLSX inspect artifacts expose the policy effects through source
   payloads, token-derived metadata, and prompt text.

`inspect localization` and `translate file` must use the same policy semantics.

## Resume Identity

File translation source hashes already include a resume fingerprint. Add the
resolved `tagPolicy` to that fingerprint.

This prevents a resumed job from reusing checkpoints created under a different
policy, even when the explicit job id and sidecar paths are the same.

Default behavior remains stable: omitted policy and explicit `default` produce
the same fingerprint.

## Validation

For `default`, tag preservation validation remains unchanged.

For `none`, tag preservation validation is disabled because there are no
CAT-managed tag tokens to preserve. Strict JSON validation for Window Mode still
runs; only tag/protected-marker validation is skipped.

## Testing

Required coverage:

- Core tokenization:
  - `default` keeps current tag recognition.
  - `none` treats `{1}`, `{1>`, `<2}`, `{3}`, `<xxx>`, and `%s` as text.
- Transient segments:
  - `none` produces plain source/target text tokens.
  - `none` produces an empty tag signature for marker-like text.
- Prompt source payload:
  - `default` keeps current protected marker payload behavior.
  - `none` passes marker-like text through as ordinary payload.
- MT response parsing:
  - `none` treats marker-like response text as plain text.
  - `none` does not retry for missing/reordered tags.
- Window Mode and Partial Window Mode:
  - Batch translation uses the same policy semantics as single-unit paths.
  - Inspect and translate expose comparable source payloads.
- Resume:
  - Different policies produce different source hashes for explicit job ids.
  - Omitted policy and explicit `default` are compatible.
- CLI:
  - Inspect and translate parse and forward `--tag-policy`.
  - Invalid values fail before calling localization.

## Documentation Updates

Update `DOCS/40_CLI_OPERATION.md` with examples and a short policy note:

- Default behavior preserves the current marker detection.
- Use `--tag-policy none` when input text has already been filtered or contains
  marker-like business text that must remain ordinary text.

Do not document real local paths or private project content.
