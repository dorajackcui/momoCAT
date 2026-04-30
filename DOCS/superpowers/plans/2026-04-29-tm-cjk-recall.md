# TM CJK Recall Candidate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor TM fuzzy/concordance candidate retrieval so CJK sources recall shorter reusable TM entries without flooding `TMService` with noise.

**Architecture:** Add `searchTMRecallCandidates()` as the neutral repository recall API. `TMRepo` builds a bounded tiered recall plan from the active source, retrieves candidates with FTS-backed tiers plus a constrained 2-character LIKE fallback, applies a lightweight source/target evidence gate, and returns bounded candidates. `TMService.findMatches()` keeps exact hash matching, fuzzy scoring, concordance classification, final sorting, and top-10 truncation.

**Tech Stack:** TypeScript, better-sqlite3, SQLite FTS5 trigram tokenizer, Vitest

---

## File Structure

- Modify `packages/db/src/types.ts`
  - Add `TMRecallScope` and `TMRecallOptions` shared by `CATDatabase` and `TMRepo`.
- Modify `packages/db/src/repos/TMRepo.ts`
  - Add `searchTMRecallCandidates()`.
  - Keep `searchConcordance()` as a compatibility facade.
  - Add private recall-plan, tier-query, and evidence-gate helpers.
- Modify `packages/db/src/index.ts`
  - Expose `CATDatabase.searchTMRecallCandidates()`.
- Modify `apps/desktop/src/main/services/ports.ts`
  - Add `TMRepository.searchTMRecallCandidates()`.
- Modify `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`
  - Delegate `searchTMRecallCandidates()` to `CATDatabase`.
- Modify `apps/desktop/src/main/services/TMService.ts`
  - Replace active-match candidate lookup with `searchTMRecallCandidates(projectId, sourceTextOnly, tmIds, { scope: 'source', limit: 50 })`.
- Modify `packages/db/src/index.test.ts`
  - Add DB-level CJK recall tests.
  - Adjust existing CJK concordance tests to target neutral recall behavior where needed.
- Modify `apps/desktop/src/main/services/TMService.test.ts`
  - Update mock repository and add a call-contract/classification test.
- Modify `DOCS/35_TM_MATCH_FLOW.md`
  - Update the documented flow after implementation.

---

### Task 1: Add Failing DB Recall Tests

**Files:**
- Modify: `packages/db/src/index.test.ts`

- [ ] **Step 1: Add tests for the new candidate recall API**

In `packages/db/src/index.test.ts`, inside the `describe("Multi-TM Architecture (v5)", ...)` block, add these tests after the existing `"should search concordance across multiple mounted TMs"` test:

```ts
    it("should recall shorter CJK TM source contained in longer active source", () => {
      const projectId = db.createProject("TM CJK Recall Contained", "zh", "fr");
      const mainTmId = db.createTM("Main CJK Recall", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "animal-party-entry",
        tmId: mainTmId,
        srcHash: "animal-party-hash",
        matchKey: "animal-party",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "动物变身聚会" }],
        targetTokens: [{ type: "text", content: "Fete de metamorphose animale" }],
        usageCount: 1,
      } as any);

      db.upsertTMEntry({
        id: "pillar-drawing-entry",
        tmId: mainTmId,
        srcHash: "pillar-drawing-hash",
        matchKey: "pillar-drawing",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "风荷立柱" }],
        targetTokens: [{ type: "text", content: "Colonne lotus venteux" }],
        usageCount: 1,
      } as any);

      const partyResults = db.searchTMRecallCandidates(
        projectId,
        "前往动物变身聚会（可选）",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(partyResults.map((row) => row.srcHash)).toContain("animal-party-hash");

      const pillarResults = db.searchTMRecallCandidates(
        projectId,
        "风荷立柱设计图",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(pillarResults.map((row) => row.srcHash)).toContain("pillar-drawing-hash");
    });

    it("should not return target-only hits for active source recall", () => {
      const projectId = db.createProject("TM Source Scope Recall", "zh", "fr");
      const mainTmId = db.createTM("Main Source Scope", "zh", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      db.upsertTMEntry({
        id: "target-only-entry",
        tmId: mainTmId,
        srcHash: "target-only-hash",
        matchKey: "unrelated-source",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "完全无关的来源文本" }],
        targetTokens: [{ type: "text", content: "风荷立柱设计图" }],
        usageCount: 100,
      } as any);

      const sourceScopeResults = db.searchTMRecallCandidates(
        projectId,
        "风荷立柱设计图",
        [mainTmId],
        { scope: "source", limit: 50 },
      );

      expect(sourceScopeResults.map((row) => row.srcHash)).not.toContain("target-only-hash");
    });
```

- [ ] **Step 2: Update existing failing CJK DB tests to use the neutral recall API**

In `packages/db/src/index.test.ts`, update these existing tests in `Multi-TM Architecture (v5)`:

1. In `"should keep highly relevant hit in top candidates under common-term noise"`, change the search call to:

```ts
      const results = db.searchTMRecallCandidates(
        projectId,
        "这份样本从录入到完成是需要时间的，没关系，我等你们！",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.length).toBeLessThanOrEqual(50);
      expect(results[0].srcHash).toBe("target-hash");
      expect(results.some((row) => row.srcHash === "target-hash")).toBe(true);
```

2. In `"should find near-identical CJK sentence when first character differs"`, change the search call to:

```ts
      const results = db.searchTMRecallCandidates(
        projectId,
        "乙组是怎么成为临时项目的负责人的？",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.length).toBeLessThanOrEqual(50);
      expect(results.some((row) => row.srcHash === "cjk-near-hash")).toBe(true);
```

3. In `"should find short CJK item names by overlapping fragments"`, change the `cloudwoodResults` call to:

```ts
      const cloudwoodResults = db.searchTMRecallCandidates(
        projectId,
        "织云木种子",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
```

and change the `dreamResults` call to:

```ts
      const dreamResults = db.searchTMRecallCandidates(
        projectId,
        "晴日裱花·困梦",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
```

4. In `"should not let single-character CJK fallback crowd out multi-character fragment matches"`, change the search call to:

```ts
      const results = db.searchTMRecallCandidates(
        projectId,
        "晴日裱花琉璃霜雪困梦",
        [mainTmId],
        { scope: "source", limit: 50 },
      );
      expect(results.map((row) => row.srcHash)).toContain("late-fragment");
```

- [ ] **Step 3: Run DB tests to verify the new tests fail for the right reason**

Run:

```bash
npx vitest run packages/db/src/index.test.ts
```

Expected: FAIL with TypeScript errors or runtime errors indicating `searchTMRecallCandidates` does not exist yet.

- [ ] **Step 4: Commit the failing tests**

```bash
git add packages/db/src/index.test.ts
git commit -m "test: cover tm cjk recall candidates"
```

---

### Task 2: Add Recall API Signatures and Temporary Delegation

**Files:**
- Modify: `packages/db/src/types.ts`
- Modify: `packages/db/src/repos/TMRepo.ts`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/desktop/src/main/services/ports.ts`
- Modify: `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`

- [ ] **Step 1: Add recall option types**

In `packages/db/src/types.ts`, after this existing interface:

```ts
export interface TMEntryRow extends TMEntry {
  tmId: string;
}
```

add:

```ts
export type TMRecallScope = 'source' | 'source-and-target';

export interface TMRecallOptions {
  scope?: TMRecallScope;
  limit?: number;
}
```

- [ ] **Step 2: Add `searchTMRecallCandidates` to `TMRepo` with temporary delegation**

In `packages/db/src/repos/TMRepo.ts`, update the import:

```ts
import type {
  MountedTMRecord,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
} from '../types';
```

Add this method immediately before `public searchConcordance(...)`:

```ts
  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    const limit = options.limit ?? 50;
    return this.searchConcordance(projectId, sourceText, tmIds).slice(0, limit);
  }
```

This temporary implementation exists only to make the API compile. Task 3 replaces it with tiered recall.

- [ ] **Step 3: Expose the method on `CATDatabase`**

In `packages/db/src/index.ts`, update the type import from `./types` so the block includes `TMRecallOptions`:

```ts
import {
  MountedTBRecord,
  MountedTMRecord,
  ProjectFileRecord,
  ProjectListRecord,
  ProjectTermEntryRecord,
  TBRecord,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
} from "./types";
```

Then add this method immediately before `public searchConcordance(...)`:

```ts
  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryRow[] {
    return this.tmRepo.searchTMRecallCandidates(projectId, sourceText, tmIds, options);
  }
```

- [ ] **Step 4: Add the method to the main-process repository port**

In `apps/desktop/src/main/services/ports.ts`, update the database type import to include `TMRecallOptions as DbTMRecallOptions`:

```ts
  TMRecallOptions as DbTMRecallOptions,
```

Then add this exported alias immediately after `export type TMType = DbTMType;`:

```ts
export type TMRecallOptions = DbTMRecallOptions;
```

Then update `export interface TMRepository` by adding the method after `searchConcordance(...)`:

```ts
  searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): TMEntryWithTmId[];
```

- [ ] **Step 5: Add the adapter delegation**

In `apps/desktop/src/main/services/adapters/SqliteTMRepository.ts`, update the imports:

```ts
import { MountedTMRecord, TMRecallOptions, TMRecord, TMRepository } from '../ports';
```

Add this method immediately after `searchConcordance(...)`:

```ts
  searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): Array<TMEntry & { tmId: string }> {
    return this.db.searchTMRecallCandidates(projectId, sourceText, tmIds, options) as Array<
      TMEntry & { tmId: string }
    >;
  }
```

- [ ] **Step 6: Run DB tests to verify API exists but behavior still fails**

Run:

```bash
npx vitest run packages/db/src/index.test.ts
```

Expected: FAIL in the new CJK recall assertions because the temporary implementation still uses exact phrase recall.

- [ ] **Step 7: Commit the API surface**

```bash
git add packages/db/src/types.ts packages/db/src/repos/TMRepo.ts packages/db/src/index.ts apps/desktop/src/main/services/ports.ts apps/desktop/src/main/services/adapters/SqliteTMRepository.ts
git commit -m "refactor: add tm recall candidate api"
```

---

### Task 3: Implement Tiered CJK Recall and Evidence Gate

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`

- [ ] **Step 1: Add recall helper types and constants**

In `packages/db/src/repos/TMRepo.ts`, after the closing `};` of `type TMEntryDbRow`, add:

```ts
type TMRecallDbRow = TMEntryDbRow & {
  ftsSrcText: string;
  ftsTgtText: string;
};

interface TMRecallQueryPlan {
  exactTerms: string[];
  primaryCjkFragments: string[];
  secondaryCjkFragments: string[];
  shortCjkTerms: string[];
  latinTerms: string[];
}

const TM_RECALL_DEFAULT_LIMIT = 50;
const TM_RECALL_MAX_LIMIT = 50;
const TM_RECALL_PRIMARY_FRAGMENT_LIMIT = 16;
const TM_RECALL_SECONDARY_FRAGMENT_LIMIT = 12;
const TM_RECALL_SHORT_TERM_LIMIT = 4;
const TM_RECALL_SHORT_ROW_LIMIT = 10;
const TM_RECALL_SECONDARY_TRIGGER = 8;
const TM_RECALL_SHORT_TRIGGER = 6;
const ONLY_CJK_RE = /^[\u4e00-\u9fa5]+$/;
const WEAK_SHORT_CJK_TERMS = new Set(['前往', '可选']);
```

- [ ] **Step 2: Replace temporary `searchTMRecallCandidates` with tiered flow**

Replace the temporary method from Task 2 with:

```ts
  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    const maxResults = Math.min(
      Math.max(options.limit ?? TM_RECALL_DEFAULT_LIMIT, 0),
      TM_RECALL_MAX_LIMIT,
    );
    if (maxResults === 0) return [];

    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) return [];

    const plan = this.buildTMRecallQueryPlan(sourceText);
    const accepted: TMRecallDbRow[] = [];
    const seenIds = new Set<string>();
    const scope = options.scope ?? 'source';

    this.collectFtsRecallTier({
      tmIds: resolvedTmIds,
      terms: [...plan.exactTerms, ...plan.latinTerms],
      sourceText,
      plan,
      scope,
      accepted,
      seenIds,
      maxResults,
      allowShortOnly: false,
    });

    if (accepted.length < maxResults) {
      this.collectFtsRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.primaryCjkFragments,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults,
        allowShortOnly: false,
      });
    }

    if (accepted.length < Math.min(maxResults, TM_RECALL_SECONDARY_TRIGGER)) {
      this.collectFtsRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.secondaryCjkFragments,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults,
        allowShortOnly: false,
      });
    }

    if (accepted.length < Math.min(maxResults, TM_RECALL_SHORT_TRIGGER)) {
      this.collectLikeRecallTier({
        tmIds: resolvedTmIds,
        terms: plan.shortCjkTerms,
        sourceText,
        plan,
        scope,
        accepted,
        seenIds,
        maxResults,
      });
    }

    return accepted.slice(0, maxResults).map((row) => this.mapTMEntryDbRow(row));
  }
```

- [ ] **Step 3: Make `searchConcordance` a facade over recall**

Replace the current `public searchConcordance(...)` method with:

```ts
  public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
    return this.searchTMRecallCandidates(projectId, query, tmIds, {
      scope: 'source-and-target',
      limit: 10,
    });
  }
```

- [ ] **Step 4: Add query tier collectors**

Add these private methods above `private extractSearchTerms(...)`:

```ts
  private collectFtsRecallTier(params: {
    tmIds: string[];
    terms: string[];
    sourceText: string;
    plan: TMRecallQueryPlan;
    scope: TMRecallOptions['scope'];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
    allowShortOnly: boolean;
  }): void {
    const terms = this.uniqueTerms(params.terms).filter((term) => term.length >= 3);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const placeholders = params.tmIds.map(() => '?').join(',');
    const ftsQuery = terms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
    const rawLimit = Math.max(params.maxResults * 3, 20);

    const rows = this.db
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
        ORDER BY rank
        LIMIT ${rawLimit}
      `)
      .all(...params.tmIds, ftsQuery) as TMRecallDbRow[];

    for (const row of rows) {
      if (params.seenIds.has(row.id)) continue;
      if (
        !this.hasRecallEvidence({
          sourceText: params.sourceText,
          candidate: row,
          plan: params.plan,
          scope: params.scope ?? 'source',
          allowShortOnly: params.allowShortOnly,
        })
      ) {
        continue;
      }

      params.seenIds.add(row.id);
      params.accepted.push(row);
      if (params.accepted.length >= params.maxResults) break;
    }
  }

  private collectLikeRecallTier(params: {
    tmIds: string[];
    terms: string[];
    sourceText: string;
    plan: TMRecallQueryPlan;
    scope: TMRecallOptions['scope'];
    accepted: TMRecallDbRow[];
    seenIds: Set<string>;
    maxResults: number;
  }): void {
    const terms = this.uniqueTerms(params.terms)
      .filter((term) => term.length === 2 && !WEAK_SHORT_CJK_TERMS.has(term))
      .slice(0, TM_RECALL_SHORT_TERM_LIMIT);
    if (terms.length === 0 || params.accepted.length >= params.maxResults) return;

    const remaining = Math.min(
      TM_RECALL_SHORT_ROW_LIMIT,
      params.maxResults - params.accepted.length,
    );
    const placeholders = params.tmIds.map(() => '?').join(',');
    const searchesTarget = params.scope === 'source-and-target';
    const likeClauses = terms
      .map(() =>
        searchesTarget
          ? '(tm_fts.srcText LIKE ? ESCAPE \'/\' OR tm_fts.tgtText LIKE ? ESCAPE \'/\')'
          : '(tm_fts.srcText LIKE ? ESCAPE \'/\')',
      )
      .join(' OR ');
    const likeParams = terms.flatMap((term) => {
      const escaped = `%${this.escapeLikePattern(term)}%`;
      return searchesTarget ? [escaped, escaped] : [escaped];
    });

    const rows = this.db
      .prepare(`
        SELECT tm_entries.*, tm_fts.srcText AS ftsSrcText, tm_fts.tgtText AS ftsTgtText
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
        ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC
        LIMIT ${remaining * 3}
      `)
      .all(...params.tmIds, ...likeParams) as TMRecallDbRow[];

    for (const row of rows) {
      if (params.seenIds.has(row.id)) continue;
      if (
        !this.hasRecallEvidence({
          sourceText: params.sourceText,
          candidate: row,
          plan: params.plan,
          scope: params.scope ?? 'source',
          allowShortOnly: true,
        })
      ) {
        continue;
      }

      params.seenIds.add(row.id);
      params.accepted.push(row);
      if (params.accepted.length >= params.maxResults) break;
    }
  }
```

- [ ] **Step 5: Add recall plan and evidence helpers**

Add these private methods above `private escapeLikePattern(...)`:

```ts
  private buildTMRecallQueryPlan(sourceText: string): TMRecallQueryPlan {
    const terms = this.extractSearchTerms(sourceText);
    const cjkComponents = this.uniqueTerms(terms.flatMap((term) => this.extractCjkComponents(term)));
    const primary4 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 4));
    const primary5 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 5));
    const primary6 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 6));
    const secondary3 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 3));
    const short2 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 2));

    return {
      exactTerms: this.uniqueTerms(terms.filter((term) => term.length >= 3)),
      primaryCjkFragments: this.selectSpreadFragments(
        this.uniqueTerms([...primary4, ...primary5, ...primary6]),
        TM_RECALL_PRIMARY_FRAGMENT_LIMIT,
      ),
      secondaryCjkFragments: this.selectSpreadFragments(
        this.uniqueTerms(secondary3),
        TM_RECALL_SECONDARY_FRAGMENT_LIMIT,
      ),
      shortCjkTerms: this.selectSpreadFragments(
        this.uniqueTerms(short2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
        TM_RECALL_SHORT_TERM_LIMIT,
      ),
      latinTerms: this.uniqueTerms(
        terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term)),
      ),
    };
  }

  private hasRecallEvidence(params: {
    sourceText: string;
    candidate: TMRecallDbRow;
    plan: TMRecallQueryPlan;
    scope: 'source' | 'source-and-target';
    allowShortOnly: boolean;
  }): boolean {
    const targets =
      params.scope === 'source-and-target'
        ? [params.candidate.ftsSrcText, params.candidate.ftsTgtText]
        : [params.candidate.ftsSrcText];

    return targets.some((target) =>
      this.hasRecallEvidenceInText(params.sourceText, target, params.plan, params.allowShortOnly),
    );
  }

  private hasRecallEvidenceInText(
    sourceText: string,
    candidateText: string,
    plan: TMRecallQueryPlan,
    allowShortOnly: boolean,
  ): boolean {
    const normalizedCandidate = candidateText.toLowerCase();

    if (plan.primaryCjkFragments.some((fragment) => normalizedCandidate.includes(fragment))) {
      return true;
    }

    const sharedSecondaryCount = plan.secondaryCjkFragments.filter((fragment) =>
      normalizedCandidate.includes(fragment),
    ).length;
    if (sharedSecondaryCount >= 2) {
      return true;
    }

    if (
      plan.latinTerms.some((term) => term.length >= 3 && normalizedCandidate.includes(term.toLowerCase()))
    ) {
      return true;
    }

    if (!allowShortOnly) {
      return false;
    }

    const sourceComponents = this.extractCjkComponents(sourceText);
    const candidateComponents = this.extractCjkComponents(candidateText);
    const sharedShortTerms = plan.shortCjkTerms.filter((term) => normalizedCandidate.includes(term));
    if (sharedShortTerms.length >= 2) {
      return true;
    }

    return sharedShortTerms.some((term) => {
      if (WEAK_SHORT_CJK_TERMS.has(term)) return false;
      return (
        sourceComponents.some(
          (component) => component === term || (component.length <= 4 && component.includes(term)),
        ) ||
        candidateComponents.some(
          (component) => component === term || (component.length <= 4 && component.includes(term)),
        )
      );
    });
  }

  private extractCjkComponents(text: string): string[] {
    return text
      .split(/[^\u4e00-\u9fa5]+/g)
      .map((component) => component.trim())
      .filter((component) => component.length > 0);
  }

  private buildCjkWindows(text: string, size: number): string[] {
    const chars = Array.from(text);
    if (chars.length < size) return chars.length === size ? [text] : [];

    const windows: string[] = [];
    for (let index = 0; index <= chars.length - size; index += 1) {
      windows.push(chars.slice(index, index + size).join(''));
    }
    return windows;
  }

  private uniqueTerms(terms: string[]): string[] {
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const term of terms) {
      const normalized = term.trim();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      unique.push(normalized);
    }
    return unique;
  }

  private selectSpreadFragments(fragments: string[], limit: number): string[] {
    const unique = this.uniqueTerms(fragments);
    if (unique.length <= limit) return unique;
    if (limit <= 1) return unique.slice(0, limit);

    const selected: string[] = [];
    const selectedIndexes = new Set<number>();
    for (let index = 0; index < limit; index += 1) {
      const sourceIndex = Math.round((index * (unique.length - 1)) / (limit - 1));
      if (selectedIndexes.has(sourceIndex)) continue;
      selectedIndexes.add(sourceIndex);
      selected.push(unique[sourceIndex]);
    }
    return selected;
  }

  private mapTMEntryDbRow(row: TMEntryDbRow): TMEntryRow {
    return {
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson),
    };
  }
```

- [ ] **Step 6: Tighten `extractSearchTerms` for recall plan use**

Replace `private extractSearchTerms(query: string): string[]` with:

```ts
  private extractSearchTerms(query: string): string[] {
    return query
      .replace(/["()]/g, ' ')
      .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .replace(/([\u4e00-\u9fa5])(\d)/g, '$1 $2')
      .replace(/(\d)([\u4e00-\u9fa5])/g, '$1 $2')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2 && !/^\d+$/.test(term));
  }
```

- [ ] **Step 7: Run DB tests**

Run:

```bash
npx vitest run packages/db/src/index.test.ts
```

Expected: PASS for DB tests, including the new CJK recall tests.

- [ ] **Step 8: Commit tiered recall implementation**

```bash
git add packages/db/src/repos/TMRepo.ts packages/db/src/index.test.ts
git commit -m "feat: add tiered tm cjk recall"
```

---

### Task 4: Wire Active TM Matching to Recall Candidates

**Files:**
- Modify: `apps/desktop/src/main/services/TMService.ts`
- Modify: `apps/desktop/src/main/services/TMService.test.ts`

- [ ] **Step 1: Update the TMService test mock**

In `apps/desktop/src/main/services/TMService.test.ts`, update `createService()` so the mock repository contains both methods:

```ts
function createService(params: {
  mountedTMs: Array<{ id: string; name: string; type: 'working' | 'main' }>;
  exactMatchByHash?: Record<string, TMEntry | undefined>;
  concordanceEntries?: Array<TMEntry & { tmId: string }>;
  recallEntries?: Array<TMEntry & { tmId: string }>;
  searchTMRecallCandidates?: ReturnType<typeof vi.fn>;
}): TMService {
```

Inside the `tmRepo` object, replace the existing `searchConcordance` line with:

```ts
    searchConcordance: vi.fn().mockReturnValue(params.concordanceEntries ?? []),
    searchTMRecallCandidates:
      params.searchTMRecallCandidates ??
      vi.fn().mockReturnValue(params.recallEntries ?? params.concordanceEntries ?? []),
```

- [ ] **Step 2: Add a test for the active-match recall contract**

In `apps/desktop/src/main/services/TMService.test.ts`, add this test after `"returns at most top 10 matches"`:

```ts
  it('uses source-scoped recall candidates for fuzzy matching', async () => {
    const source = '风荷立柱设计图';
    const searchTMRecallCandidates = vi.fn().mockReturnValue([
      createConcordanceEntry('tm-main', {
        srcHash: 'pillar-drawing-hash',
        sourceText: '风荷立柱',
      }),
    ]);
    const service = createService({
      mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
      searchTMRecallCandidates,
    });

    const matches = await service.findMatches(1, createSegment(source, 'source-hash'));

    expect(searchTMRecallCandidates).toHaveBeenCalledWith(1, source, ['tm-main'], {
      scope: 'source',
      limit: 50,
    });
    expect(matches.map((match) => match.srcHash)).toContain('pillar-drawing-hash');
  });
```

- [ ] **Step 3: Run the TMService tests and verify the new test fails**

Run:

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: FAIL because `TMService.findMatches()` still calls `searchConcordance()`.

- [ ] **Step 4: Update `TMService.findMatches()`**

In `apps/desktop/src/main/services/TMService.ts`, remove the `const query = sourceTextOnly...join(' ')` block and the surrounding `if (query) { ... }` wrapper. Replace it with:

```ts
    const tmIds = mountedTMs.map((tm) => tm.id);
    const candidates = this.tmRepo.searchTMRecallCandidates(
      projectId,
      sourceTextOnly,
      tmIds,
      { scope: 'source', limit: 50 },
    );

    for (const cand of candidates) {
      if (seenHashes.has(cand.srcHash)) continue;

      const candTextOnly = serializeTokensToTextOnly(cand.sourceTokens);
      const candNormalized = this.normalizeForSimilarity(candTextOnly);

      let standardSimilarity = 0;
      let localOverlap: LocalOverlapResult = {
        score: 0,
        matchedSourceText: '',
        sourceCoverage: 0,
        entryCoverage: 0,
      };

      if (sourceNormalized === candNormalized) {
        standardSimilarity = 99;
      } else {
        localOverlap = this.computeLocalOverlapSimilarity(sourceNormalized, candNormalized);
        const maxPossibleByLength = this.computeMaxLengthBound(sourceNormalized, candNormalized);

        if (maxPossibleByLength >= TMService.MIN_SIMILARITY) {
          const levSimilarity = this.computeLevenshteinSimilarity(sourceNormalized, candNormalized);
          const diceSimilarity = this.computeDiceSimilarity(sourceNormalized, candNormalized);
          const bonus = this.computeSimilarityBonus(sourceNormalized, candNormalized);
          standardSimilarity = Math.min(
            99,
            Math.round(
              levSimilarity * TMService.LEVENSHTEIN_WEIGHT +
                diceSimilarity * TMService.DICE_WEIGHT +
                bonus,
            ),
          );
        }
      }

      const tm = mountedTMs.find((t) => t.id === cand.tmId);
      const baseMatch = {
        ...cand,
        tmName: tm?.name || 'Unknown TM',
        tmType: tm?.type || 'main',
      } as const;

      if (standardSimilarity >= TMService.MIN_SIMILARITY) {
        results.push({
          ...baseMatch,
          kind: 'tm',
          similarity: standardSimilarity,
          rank: standardSimilarity,
        });
        seenHashes.add(cand.srcHash);
        continue;
      }

      if (localOverlap.score >= TMService.MIN_SIMILARITY) {
        results.push({
          ...baseMatch,
          kind: 'concordance',
          rank: localOverlap.score,
          matchedSourceText: localOverlap.matchedSourceText,
          sourceCoverage: localOverlap.sourceCoverage,
          entryCoverage: localOverlap.entryCoverage,
        });
        seenHashes.add(cand.srcHash);
      }
    }
```

This preserves the existing scoring and classification block while changing only candidate retrieval.

- [ ] **Step 5: Run TMService tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit active matching integration**

```bash
git add apps/desktop/src/main/services/TMService.ts apps/desktop/src/main/services/TMService.test.ts
git commit -m "refactor: use tm recall candidates for active matching"
```

---

### Task 5: Verify Main-Process TM Module Integration

**Files:**
- Modify: `apps/desktop/src/main/services/modules/TMModule.test.ts`

- [ ] **Step 1: Add an integration test for active CJK recall through `TMModule.findMatches()`**

In `apps/desktop/src/main/services/modules/TMModule.test.ts`, add this test near the existing TM module integration tests that instantiate `CATDatabase(':memory:')`:

```ts
  it('finds CJK recall candidates through TMModule.findMatches', async () => {
    let db: CATDatabase | undefined;
    try {
      db = new CATDatabase(':memory:');
      const projectId = db.createProject('CJK Recall Project', 'zh', 'fr');
      const mainTmId = db.createTM('Main CJK Recall', 'zh', 'fr', 'main');
      db.mountTMToProject(projectId, mainTmId, 10, 'read');

      const now = new Date().toISOString();
      const entryId = db.upsertTMEntryBySrcHash({
        id: 'pillar-entry',
        tmId: mainTmId,
        projectId: 0,
        srcLang: 'zh',
        tgtLang: 'fr',
        srcHash: 'pillar-hash',
        matchKey: '风荷立柱',
        tagsSignature: '',
        sourceTokens: [{ type: 'text', content: '风荷立柱' }],
        targetTokens: [{ type: 'text', content: 'Colonne lotus venteux' }],
        createdAt: now,
        updatedAt: now,
        usageCount: 1,
      });
      db.replaceTMFts(mainTmId, '风荷立柱', 'Colonne lotus venteux', entryId);

      const projectRepo = new SqliteProjectRepository(db);
      const segmentRepo = new SqliteSegmentRepository(db);
      const tmRepo = new SqliteTMRepository(db);
      const tx = new SqliteTransactionManager(db);
      const tmService = new TMService(projectRepo, tmRepo);
      const segmentService = new SegmentService(segmentRepo, tmService, tx);
      const module = new TMModule(
        projectRepo,
        segmentRepo,
        tmRepo,
        tx,
        tmService,
        segmentService,
        ':memory:',
        vi.fn(),
      );

      const matches = await module.findMatches(projectId, {
        segmentId: 'active-cjk',
        fileId: 1,
        orderIndex: 0,
        sourceTokens: [{ type: 'text', content: '风荷立柱设计图' }],
        targetTokens: [],
        status: 'new',
        tagsSignature: '',
        matchKey: '风荷立柱设计图',
        srcHash: 'active-cjk-hash',
        meta: { updatedAt: now },
      });

      expect(matches.map((match) => match.srcHash)).toContain('pillar-hash');
    } finally {
      db?.close();
    }
  });
```

- [ ] **Step 2: Run TMModule tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/TMModule.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit integration coverage**

```bash
git add apps/desktop/src/main/services/modules/TMModule.test.ts
git commit -m "test: cover tm module cjk recall"
```

---

### Task 6: Update TM Match Flow Documentation

**Files:**
- Modify: `DOCS/35_TM_MATCH_FLOW.md`

- [ ] **Step 1: Update Step 3 and Step 4**

In `DOCS/35_TM_MATCH_FLOW.md`, replace the current "Step 3 — 构建 FTS 查询字符串" and "Step 4 — searchConcordance" sections with this markdown:

````markdown
### Step 3 — 召回候选 TM 条目

`TMService.findMatches()` 调用：

```typescript
tmRepo.searchTMRecallCandidates(projectId, sourceTextOnly, tmIds, {
  scope: 'source',
  limit: 50,
});
```

这一层只负责召回候选，不决定 `kind: 'tm'` 或 `kind: 'concordance'`。

### Step 4 — CJK-aware recall plan

`TMRepo.searchTMRecallCandidates()` 将 source 构造成分层查询计划：

| Tier | 内容 | 用途 |
|---|---|---|
| exact terms | 清洗后的完整 term | 保留当前精确 phrase 行为 |
| primary CJK fragments | 最多 16 个 4-6 字 CJK 片段 | 召回 `风荷立柱设计图` -> `风荷立柱` 这类短条目 |
| secondary CJK fragments | 最多 12 个 3 字片段 | primary 不足时补召回 |
| short CJK fallback | 最多 4 个 2 字 term，最多 10 行 LIKE fallback | 兜底短词，不作为主路径 |

每个 tier 返回的 row 还会经过 evidence gate：

- 共享 >=4 字连续 CJK 片段，接受。
- 共享至少两个不同 3 字 CJK 片段，接受。
- 只有 2 字命中时，要求 source 或 candidate 存在短 CJK component。
- active segment 匹配只使用 source-side evidence，不接受 target-only 命中。
````

- [ ] **Step 2: Update later step numbers**

Renumber the existing scoring/classification/sorting sections so the flow remains sequential:

- Similarity scoring becomes Step 5.
- Classification becomes Step 6.
- Sorting and truncation becomes Step 7.

- [ ] **Step 3: Correct the FTS write-path note**

In the "FTS 索引写入路径" section, replace:

```markdown
所有路径使用 `serializeTokensToTextOnly()` 提取纯文本写入 FTS，确保与查询端一致（无 tag 标记干扰 trigram 序列）。
```

with:

```markdown
当前写入路径使用 display text 或导入原始文本写入 FTS。`findMatches()` 的评分仍使用 `serializeTokensToTextOnly()`；candidate recall 通过 evidence gate 抵消 tag/display text 对召回的影响。后续若统一 FTS 写入为 text-only，应同步更新导入、确认 Segment、批量提交主 TM 三条路径。
```

- [ ] **Step 4: Run documentation check**

Run:

```bash
py -3.11 scripts\validate_docs.py
```

Expected: PASS. If Python 3.11 is unavailable, run:

```bash
py -3 scripts\validate_docs.py
```

Expected: PASS.

- [ ] **Step 5: Commit docs**

```bash
git add DOCS/35_TM_MATCH_FLOW.md
git commit -m "docs: update tm match recall flow"
```

---

### Task 7: Final Verification

**Files:**
- No code changes expected.

- [ ] **Step 1: Run targeted TM and DB tests**

Run:

```bash
npx vitest run packages/db/src/index.test.ts apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/modules/TMModule.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run the repo gate if targeted checks pass**

Run:

```bash
npm run gate:check
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git log --oneline -6
```

Expected:

- `git status --short` has no unexpected tracked changes from this task.
- Recent commits include the task commits from this plan.
