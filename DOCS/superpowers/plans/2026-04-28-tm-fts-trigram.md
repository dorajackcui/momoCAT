# tm_fts Trigram Tokenizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Switch the `tm_fts` FTS5 virtual table from the default `unicode61` tokenizer to `trigram` so that CJK substring search works natively via FTS MATCH instead of falling back to LIKE full-table scans.

**Architecture:** Three files change. The DDL in `currentSchema.ts` gains `tokenize='trigram'`. The query builder in `TMRepo.searchConcordance` is rewritten for trigram MATCH syntax (quoted substrings, no column-scoped queries). The LIKE fallback is simplified to only catch terms < 3 chars. `TMService.findMatches` query construction is updated to produce trigram-compatible terms.

**Tech Stack:** SQLite FTS5 trigram tokenizer (built-in since SQLite 3.34), better-sqlite3, Vitest

**Note:** CJK regex ranges in code blocks below display as literal characters but MUST be written as `\u4e00-\u9fa5` in the actual `.ts` source to match existing codebase convention.

---

### Task 1: Update tm_fts DDL to use trigram tokenizer

**Files:**
- Modify: `packages/db/src/currentSchema.ts:217-222`

- [ ] **Step 1: Update the tm_fts CREATE VIRTUAL TABLE statement**

In `packages/db/src/currentSchema.ts`, change lines 217-222 from:

```typescript
      CREATE VIRTUAL TABLE tm_fts USING fts5(
        tmId UNINDEXED,
        srcText,
        tgtText,
        tmEntryId UNINDEXED
      );
```

to:

```typescript
      CREATE VIRTUAL TABLE tm_fts USING fts5(
        tmId UNINDEXED,
        srcText,
        tgtText,
        tmEntryId UNINDEXED,
        tokenize='trigram'
      );
```

- [ ] **Step 2: Run the existing schema tests to confirm DDL is valid**

Run: `npx vitest run packages/db/src/currentSchema.test.ts`
Expected: All 5 tests pass. The `ensureCurrentSchema` bootstrap test creates the DB from scratch, confirming the new DDL is syntactically valid.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/currentSchema.ts
git commit -m "feat: switch tm_fts tokenizer from unicode61 to trigram"
```

---

### Task 2: Rewrite searchConcordance FTS query for trigram syntax

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts:168-243` (searchConcordance method)
- Modify: `packages/db/src/repos/TMRepo.ts:245-304` (remove old helper methods)

Trigram FTS5 MATCH syntax differs from unicode61:
- No column-scoped queries (`srcText:(...)` is not supported)
- Each term must be quoted for exact substring matching: `"translation"` 
- Each term must be >= 3 characters (trigram minimum)
- Boolean `OR` works between quoted terms: `"term1" OR "term2"`
- `bm25()` is not meaningful for trigram — replace with `rank`

- [ ] **Step 1: Rewrite the FTS query construction in searchConcordance**

In `packages/db/src/repos/TMRepo.ts`, replace the `searchConcordance` method (lines 168-243) with:

```typescript
  public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
    const maxResults = 10;
    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) {
      return [];
    }

    const placeholders = resolvedTmIds.map(() => '?').join(',');

    const terms = this.extractSearchTerms(query);
    const ftsTerms = terms.filter((t) => t.length >= 3);
    const shortTerms = terms.filter((t) => t.length >= 2 && t.length < 3);

    const mergedRows: TMEntryDbRow[] = [];
    const seenIds = new Set<string>();

    if (ftsTerms.length > 0) {
      const ftsQuery = ftsTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');

      const rows = this.db
        .prepare(`
        SELECT tm_entries.*
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
        ORDER BY rank
        LIMIT ${maxResults}
      `)
        .all(...resolvedTmIds, ftsQuery) as TMEntryDbRow[];

      for (const row of rows) {
        seenIds.add(row.id);
        mergedRows.push(row);
      }
    }

    if (mergedRows.length < maxResults && shortTerms.length > 0) {
      const remaining = maxResults - mergedRows.length;
      const likeClauses = shortTerms
        .map(() => '(tm_fts.srcText LIKE ? ESCAPE \'/\' OR tm_fts.tgtText LIKE ? ESCAPE \'/\')')
        .join(' OR ');
      const likeParams = shortTerms.flatMap((term) => {
        const escaped = `%${this.escapeLikePattern(term)}%`;
        return [escaped, escaped] as const;
      });

      const likeRows = this.db
        .prepare(`
        SELECT tm_entries.*
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
        ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC
        LIMIT ${remaining}
      `)
        .all(...resolvedTmIds, ...likeParams) as TMEntryDbRow[];

      for (const row of likeRows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        mergedRows.push(row);
        if (mergedRows.length >= maxResults) break;
      }
    }

    return mergedRows.map((row) => ({
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson),
    }));
  }
```

- [ ] **Step 2: Add the extractSearchTerms helper, remove old CJK helpers**

Replace the old helper methods (`buildLikeFallbackFragments`, `buildCjkAnchorFragments`, `isCjkHeavyTerm`, `isLongCjkTerm`) at lines 245-299 with:

```typescript
  private extractSearchTerms(query: string): string[] {
    return query
      .replace(/["()]/g, ' ')
      .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  }
```

Keep `escapeLikePattern` (line 302-304) — it's still used by the LIKE fallback.

- [ ] **Step 3: Run existing tests to verify nothing regresses**

Run: `npx vitest run packages/db/src/currentSchema.test.ts`
Expected: All tests pass.

Run: `npx vitest run apps/desktop/src/main/services/TMService.test.ts`
Expected: All tests pass. These tests mock `searchConcordance` so they don't exercise the SQL directly — they verify the scoring/classification layer is still correct.

Run: `npx vitest run apps/desktop/src/main/services/modules/TMModule.test.ts`
Expected: All tests pass. The integration test at line 253 uses a real `CATDatabase(:memory:)`, so it exercises the new DDL + query path with the English text "Hello".

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/repos/TMRepo.ts
git commit -m "feat: rewrite searchConcordance for trigram FTS syntax

Replace unicode61 column-scoped MATCH with trigram quoted-substring
MATCH. Simplify LIKE fallback to only cover terms < 3 chars.
Remove obsolete CJK fragment helpers."
```

---

### Task 3: Update findMatches query construction in TMService

**Files:**
- Modify: `apps/desktop/src/main/services/TMService.ts:124-134`

The `findMatches` method in `TMService` builds a query string that gets passed to `searchConcordance`. Currently it joins words with unquoted `OR` (unicode61 syntax). For trigram, each term should be >= 3 chars (shorter terms will be handled by searchConcordance's LIKE fallback) and needs no special quoting since `searchConcordance` now handles that internally.

- [ ] **Step 1: Update the query construction in findMatches**

In `apps/desktop/src/main/services/TMService.ts`, replace lines 124-134:

```typescript
    // 2. Fuzzy matching using FTS as a candidate filter
    // Split on CJK/non-CJK boundaries so numbers don't fuse with surrounding
    // ideographs into a single FTS token (unicode61 treats digits and CJK as
    // separate token classes, so "消耗380个" becomes [消耗][380][个]).
    const query = sourceTextOnly
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
      .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !/^\d+$/.test(w))
      .join(' OR ');
```

with:

```typescript
    const query = sourceTextOnly
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
      .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !/^\d+$/.test(w))
      .join(' ');
```

The change: `.join(' OR ')` becomes `.join(' ')`. The `searchConcordance` method now parses the query string with `extractSearchTerms` and builds proper trigram MATCH syntax itself. Passing space-separated terms is the new contract — `searchConcordance` handles quoting and `OR` joining internally.

- [ ] **Step 2: Run tests**

Run: `npx vitest run apps/desktop/src/main/services/TMService.test.ts`
Expected: All tests pass.

Run: `npx vitest run apps/desktop/src/main/services/modules/TMModule.test.ts`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add apps/desktop/src/main/services/TMService.ts
git commit -m "refactor: simplify findMatches query for trigram searchConcordance

Pass space-separated terms instead of OR-joined query. The
searchConcordance method now handles FTS syntax internally."
```

---

### Task 4: Run full gate check

- [ ] **Step 1: Run gate:check**

Run: `npm run gate:check`
Expected: Typecheck, guardrails, lint, and smoke gate all pass.

- [ ] **Step 2: Run targeted TM tests end-to-end**

Run: `npx vitest run apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/modules/TMModule.test.ts packages/db/src/currentSchema.test.ts`
Expected: All tests pass.
