# Newline Protected Marker Design

Date: 2026-06-12

## Purpose

Protect real carriage return and line feed characters in MT prompts by routing
them through the existing protected-marker token flow. Raw `\r` and `\n` are
too easy for providers to normalize, move, or render as actual line breaks, so
prompt wording alone is not a reliable preservation mechanism.

## Scope

In scope:

- Default CAT tag policy tokenization.
- Core display-to-token parsing.
- Core token-to-editor protected-marker serialization.
- Core editor protected-marker parsing back to tokens.
- Headless MT prompt payloads that already use `serializeTokensToEditorText`.
- Focused core and MT module tests.

Out of scope:

- `tagPolicy: none`, which must keep all text ordinary and should not protect
  newline characters as CAT markers.
- CLI argument changes.
- Prompt template redesign.
- Desktop UI changes.
- New token type semantics outside the existing protected-marker path.

## Current Flow

Headless localization creates transient segments with
`parseDisplayTextToTokens`. MT prompt payloads are built with
`serializeTokensToEditorText`, and provider responses are parsed with
`parseEditorTextToTokens`. Tag validation then checks whether protected markers
from the source are preserved in the target.

Today, real newline characters remain inside ordinary text tokens. They can
enter prompts as actual line breaks, where providers may normalize them despite
instructions to preserve `\r` and `\n`.

## Design

Treat real `\r` and `\n` characters as standalone protected tag tokens under
the default tag policy.

Example:

```text
source display text: A\r\nB
source tokens: text("A"), tag("\r"), tag("\n"), text("B")
prompt payload: A{1}{2}B
provider response: X{1}{2}Y
target display text: X\r\nY
```

CRLF is intentionally represented as two markers. This keeps exact source text
shape and avoids introducing platform-specific newline normalization.

## Minimal Modification Points

1. `packages/core/src/tag/TagCodec.ts`
   - Split `\r` and `\n` out of text during `parseDisplayTextToTokens` when
     `tagPolicy` is default.
   - Leave `tagPolicy: none` behavior unchanged.
   - Reuse `serializeTokensToEditorText` so newline tokens become `{n}`
     standalone markers.
   - Reuse `parseEditorTextToTokens` so `{n}` markers map back to the original
     newline token content.

2. `packages/core/src/tag/TagMapper.ts`
   - Preserve marker identity by occurrence, not only by unique content, for
     protected newline tokens. Repeated `\n` markers must not collapse into the
     same marker number when count matters.

3. Tests
   - Add core tokenizer/editor serialization coverage for `\r`, `\n`, and
     `\r\n`.
   - Add an MT module prompt/response test proving prompt payloads use `{n}`
     markers and parsed target tokens display real newlines.

## Alternatives Considered

1. Escape newline text as literal `\\r` and `\\n`.
   - Rejected because these would not use the existing marker validation and
     retry path.

2. Add a new `ws` token validation path.
   - Rejected for this change because it would require new signature,
     serialization, parsing, and QA semantics. The existing protected marker
     flow already covers the needed behavior.

3. Treat CRLF as a single marker.
   - Rejected because it loses exact character-level preservation and makes
     mixed newline inputs harder to reason about.

## Validation

Run targeted tests:

```bash
npx vitest run packages/core/src/tag/index.test.ts packages/localization/src/modules/MTModule.test.ts
```

If implementation touches broader text hashing or matching behavior, also run:

```bash
npx vitest run packages/core/src/text/index.test.ts packages/localization/src/transientSegment.test.ts
```
