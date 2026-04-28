# tm_fts Trigram Tokenizer

## Problem

The `tm_fts` FTS5 virtual table uses the default `unicode61` tokenizer, which treats contiguous CJK text as a single token. This makes FTS MATCH queries effectively useless for Chinese/Japanese/Korean text. The current workaround is a LIKE fallback that does full-table scans — functional but slow.

## Decision

Switch `tm_fts` from `unicode61` to `trigram`. This is a fresh-database-only change (project is not shipped). No migration or backward compatibility needed.

## Scope

### Files Changed

- `packages/db/src/currentSchema.ts` — add `tokenize='trigram'` to `tm_fts` DDL
- `packages/db/src/repos/TMRepo.ts` — rewrite `searchConcordance` FTS query for trigram syntax, simplify LIKE fallback, remove now-unnecessary CJK helper methods
- `apps/desktop/src/main/services/TMService.ts` — update `findMatches` query construction to produce trigram-compatible FTS terms

### What Doesn't Change

- `tb_fts` (already trigram)
- FTS write path (`insertTMFts`, `replaceTMFts`)
- Similarity scoring logic in `TMService`
- `packages/core/src/text/termMatching.ts` (already trigram-aware for TB)
- Schema version stays at 15

## Design Details

### 1. Schema: currentSchema.ts

```sql
CREATE VIRTUAL TABLE tm_fts USING fts5(
  tmId UNINDEXED,
  srcText,
  tgtText,
  tmEntryId UNINDEXED,
  tokenize='trigram'
);
```

### 2. FTS MATCH Query: TMRepo.searchConcordance

Trigram FTS5 uses substring matching, not word-based matching. Key differences from unicode61:

- No column-scoped queries like `srcText:(...)` — trigram matches across the whole row
- Quoted strings do exact substring matching: `"翻译记忆"` matches any row containing that substring
- Each MATCH term must be >= 3 characters (trigram minimum)
- Boolean `OR` still works between quoted terms

Current query: `(srcText:(cleanQuery) OR tgtText:(cleanQuery))`
New query: quote each term >= 3 chars, join with `OR`. Example: `"翻译记忆" OR "translation"`

### 3. findMatches Query Construction: TMService.ts

Current: splits source text into words, joins with `OR` (e.g., `word1 OR word2`).
New: same split, but quote each term and filter to >= 3 chars. Example: `"word1" OR "word2"`.

### 4. LIKE Fallback: Simplified

The elaborate CJK fragment machinery (`buildLikeFallbackFragments`, `buildCjkAnchorFragments`, `isCjkHeavyTerm`, `isLongCjkTerm`) was designed to compensate for unicode61's CJK blindness. With trigram handling CJK >= 3 chars natively, the fallback only needs to catch terms < 3 chars (e.g., CJK double-char words like "翻译").

Simplify to: extract 2-char terms from query, run a single LIKE pass if FTS results are insufficient.

Remove helper methods: `buildCjkAnchorFragments`, `isCjkHeavyTerm`, `isLongCjkTerm`.

## Performance Impact

- **CJK queries**: significant speedup — FTS index hit instead of LIKE full scan
- **Non-CJK queries**: neutral — trigram index is larger but query is still index-backed
- **Write path**: negligible impact at < 200k entries
- **Index size**: ~3-5x larger than unicode61, acceptable at < 200k entries

## Testing

- Run existing TM-related tests: `TMRepo`, `TMService`, `TMModule`, `currentSchema`
- Verify CJK concordance search returns results via FTS (not just LIKE fallback)
- Verify 2-char CJK terms still return results via LIKE fallback
- Verify non-CJK queries still work correctly
