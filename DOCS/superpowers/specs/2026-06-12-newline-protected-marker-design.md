# Newline Protected Marker Design

Date: 2026-06-12

## Purpose

Protect literal backslash escape sequences (`\\r` and `\\n`) in MT prompts by
routing them through the existing protected-marker token flow. These sequences
are too easy for providers to normalize, move, or render as actual line breaks,
so prompt wording alone is not a reliable preservation mechanism.

## Scope

In scope:

- Default CAT tag policy tokenization.
- Core display-to-token parsing.
- Core token-to-editor protected-marker serialization.
- Core editor protected-marker parsing back to tokens.
- Headless MT prompt payloads that already use `serializeTokensToEditorText`.
- Focused core and MT module tests.

Out of scope:

- Real carriage return and line feed characters. Actual line breaks should stay
  ordinary text.
- `tagPolicy: none`, which must keep all text ordinary and should not protect
  literal newline escape sequences as CAT markers.
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

Today, literal `\\r` and `\\n` sequences remain inside ordinary text tokens.
They can enter prompts looking like newline instructions or escaped line breaks,
where providers may normalize them despite instructions to preserve them.

## Design

Treat literal `\\r` and `\\n` sequences as standalone protected tag tokens under
the default tag policy. Do not protect actual CR or LF characters.

Example:

```text
source display text: A\\r\\nB
source tokens: text("A"), tag("\\r"), tag("\\n"), text("B")
prompt payload: A{1}{2}B
provider response: X{1}{2}Y
target display text: X\\r\\nY
```

The literal sequence `\\r\\n` is intentionally represented as two markers. This
keeps exact source text shape and avoids provider normalization of escaped line
break notation.

## Minimal Modification Points

1. `packages/core/src/tag/TagCodec.ts`
   - Split literal `\\r` and `\\n` sequences out of text during
     `parseDisplayTextToTokens` when `tagPolicy` is default.
   - Leave `tagPolicy: none` behavior unchanged.
   - Reuse `serializeTokensToEditorText` so newline tokens become `{n}`
     standalone markers.
   - Reuse `parseEditorTextToTokens` so `{n}` markers map back to the original
     newline token content.

2. `packages/core/src/tag/TagMapper.ts`
   - Preserve marker identity by occurrence, not only by unique content, for
     protected literal newline escape tokens. Repeated `\\n` markers must not
     collapse into the same marker number when count matters.

3. Tests
   - Add core tokenizer/editor serialization coverage for literal `\\r`,
     `\\n`, and `\\r\\n`, plus actual CR/LF remaining plain text.
   - Add an MT module prompt/response test proving prompt payloads use `{n}`
     markers and parsed target tokens display literal newline escape sequences.

## Alternatives Considered

1. Protect actual CR/LF characters.
   - Rejected after clarification because the problem input is escaped text such
     as `\\n\\n`, not real line breaks.

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
