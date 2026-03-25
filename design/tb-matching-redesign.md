# TB Matching Redesign

## Background

The current TB implementation uses a mixed strategy:

- Latin terms: case-insensitive regex with simple word boundaries
- CJK terms: case-insensitive substring search
- Source lookup: `serializeTokensToDisplayText(...)`
- Target QA: same matching logic reused against target display text

This is deterministic and simple, but it is not robust enough for the project's language profile:

- source: Chinese
- targets: Japanese, Korean, English, and additional European languages
- source/target text may contain tags or placeholders that split visible terms

## Problems With Current State

1. Matching is display-text based instead of text-only based.
   Tag content can interrupt term spans and cause misses.
2. CJK languages are treated as plain substring matching.
   This is acceptable for a prototype but too weak for Japanese and Korean QA.
3. Latin and European languages rely on one regex boundary rule.
   This does not generalize well across punctuation, width variants, and locale-sensitive casing.
4. The implementation has no language-aware normalization layer.
   Full-width and compatibility characters can cause false misses.
5. The current approach scales poorly as TB size grows because it scans mounted terms linearly.

## Design Goals

1. Keep TB business behavior in-project.
   Mounting, priority, import, QA, and AI prompt injection stay local.
2. Replace the matching kernel with mature capabilities where practical.
3. Improve multilingual behavior without adding heavy runtime dependencies in phase 1.
4. Preserve deterministic behavior for editor hints and QA.
5. Leave room for later FTS-based candidate retrieval.

## Recommended Architecture

### Phase 1

Use platform-native mature capabilities:

- `Intl.Segmenter` for locale-aware boundary detection
- Unicode `NFKC` normalization for width and compatibility normalization
- token-aware text extraction based on text tokens only

Implementation shape:

1. Build searchable text from text tokens only.
   Tags and placeholders are excluded from the linguistic search surface.
2. Normalize source text and TB terms with:
   - `NFKC`
   - locale-aware lowercasing
   - whitespace compaction
3. Search by normalized substring.
4. For Latin and other space-delimited scripts, require segment boundaries using `Intl.Segmenter`.
5. For Han, Kana, and Hangul terms, allow normalized substring matching without forced word boundaries.

This phase does not change DB schema.

### Phase 2

Add SQLite FTS5 candidate retrieval for mounted TB entries.

Purpose:

- avoid scanning all mounted terms per segment
- use `trigram` for CJK-heavy recall
- use `unicode61` for general multilingual token recall
- optionally use `porter` only for English candidate retrieval

FTS remains a candidate retrieval layer, not the final acceptance rule.

### Phase 3

Optional advanced language services:

- per-language normalization rules
- explicit TB variant tables
- optional sidecar NLP for high-end terminology workflows

This should be considered only if phase 1 and phase 2 prove insufficient.

## Why Not Replace TB With One External Library

No single lightweight JS library cleanly solves:

- Chinese source matching
- Japanese and Korean target QA
- English and broader European-language term boundaries
- project-scoped mounting, priority, and editor behavior

The right split is:

- mature primitives for segmentation and retrieval
- project-owned domain logic for final term decisions

## Language Strategy

### Chinese Source

- match on text-only content
- allow normalized substring recall
- avoid dependence on whitespace tokenization
- support terms split by tags in the token stream

### Japanese Target

- normalize width variants
- use locale-aware segmentation for boundaries where useful
- do not assume whitespace-delimited words
- keep final acceptance deterministic

### Korean Target

- normalize width variants
- use locale-aware segmentation instead of ad hoc regex rules
- preserve deterministic QA behavior

### English and Other European Languages

- use locale-aware lowercasing
- use segment boundaries instead of a single regex heuristic
- keep stemming out of phase 1
- treat stemming as retrieval-only, not final QA truth

## Data Model Impact

Phase 1: none

Phase 2:

- add TB FTS support or auxiliary lookup tables
- keep `tb_entries` as source of truth
- keep mounted TB priority resolution in app logic

## Testing Strategy

Phase 1 tests must cover:

1. source term match across tags
2. target QA match across tags
3. `NFKC` normalization behavior
4. Latin boundary protection against partial-word false positives
5. Japanese/Korean/CJK substring-compatible matching

## Rollout

1. Land phase 1 helpers and tests.
2. Validate editor term hits and QA behavior.
3. Measure mounted TB performance.
4. Only then decide whether phase 2 FTS work is needed.
