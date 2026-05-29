# English TB Recall Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve TB recall for English source projects with conservative English variants while preserving current CJK/default strict matching behavior.

**Architecture:** Keep the existing strict term matching core as the single shared foundation. Add a profile layer resolved from `project.srcLang`: `en*` uses strict core plus a bounded English overlay, while CJK/default profiles delegate directly to the strict core. Candidate recall and final position matching both use the profile API so English aliases do not drift from final matching.

**Tech Stack:** TypeScript, Vitest, SQLite/better-sqlite3, existing `@cat/core/text` utilities, existing desktop/localization TB services.

---

## Non-Negotiable Constraints

- Do not change the semantics of existing CJK/default strict matching.
- Do not put English plural, possessive, hyphen, acronym, or stemming logic into global `normalizeTermForLookup`.
- Do not fork or duplicate the current CJK/strict matcher.
- English behavior is an overlay selected only by `project.srcLang` matching `en` or `en-*`.
- If English overlay produces no match, behavior should remain equivalent to current strict matching.
- Keep English v1 conservative: regular plural/singular, possessive, hyphen/space equivalence, dotted acronym equivalence. No general stemming, no edit-distance fuzzy matching, no irregular plural expansion in v1.

## File Structure

- Create `packages/core/src/text/termMatchingProfiles.ts`
  - Owns profile resolution and profile-level APIs.
  - Delegates strict behavior to existing `termMatching.ts`.
  - Contains English overlay helpers scoped to this file or small adjacent helpers if the file becomes too large.

- Modify `packages/core/src/text/index.ts`
  - Re-export profile APIs.

- Modify `packages/core/src/text/index.test.ts`
  - Add profile unit tests.
  - Add CJK/default strict parity tests.

- Modify `packages/db/src/repos/TBRepo.ts`
  - Replace direct candidate search-plan call with profile search-plan call.
  - Keep SQL shape, FTS schema, ordering, caps, and exact lookup batching unchanged.

- Modify `apps/desktop/src/main/services/TBService.ts`
  - Replace final position matching call with profile position matching.
  - Keep sorting, dedupe, and nested suppression unchanged.

- Modify `packages/localization/src/services/TBService.ts`
  - Mirror the desktop TBService final matching change.

- Modify `apps/desktop/src/main/services/TBService.test.ts`
  - Add service-level tests for English final matching and non-English strict behavior.

- Modify `apps/desktop/src/main/services/TBMatchFlow.test.ts`
  - Add memory-DB flow tests proving repo recall plus final matching works for English variants.
  - Add CJK trace/parity guard if current tests do not already cover the profile path.

- Optional docs update after implementation: `DOCS/60_TM_TB_REFERENCE.md`
  - Mention source-language profile dispatch and English v1 behavior.

---

### Task 1: Add Profile API Unit Tests

**Files:**
- Modify: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Add imports for planned profile APIs**

Add the future APIs to the existing import from `./index`:

```ts
import {
  buildTermSearchPlan,
  buildTermSearchPlanForLocale,
  buildTermSearchFragments,
  computeMatchKey,
  findTermPositionsInText,
  findTermPositionsInTextForLocale,
  normalizeTermForLookup,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToTextOnly,
  suppressNestedTermMatches,
} from './index';
```

- [ ] **Step 2: Add English final-position profile tests**

Append this test inside `describe('Term Matching Helpers', ...)`:

```ts
it('adds conservative English profile variants while keeping non-English strict', () => {
  expect(
    findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'en-US' }),
  ).toHaveLength(1);
  expect(
    findTermPositionsInTextForLocale("User's profile opens.", 'user', { locale: 'en-US' }),
  ).toHaveLength(1);
  expect(
    findTermPositionsInTextForLocale('real-time updates are enabled.', 'real time', {
      locale: 'en-US',
    }),
  ).toHaveLength(1);
  expect(
    findTermPositionsInTextForLocale('U.S. market support is enabled.', 'US', {
      locale: 'en-US',
    }),
  ).toHaveLength(1);

  expect(
    findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'fr-FR' }),
  ).toHaveLength(0);
  expect(
    findTermPositionsInTextForLocale('winter event', 'win', { locale: 'en-US' }),
  ).toHaveLength(0);
});
```

- [ ] **Step 3: Add English search-plan alias and CJK parity tests**

Append this test near the existing search-plan tests:

```ts
it('adds bounded English aliases to search plans without changing CJK plans', () => {
  const englishPlan = buildTermSearchPlanForLocale('Accounts use real-time U.S. settings.', {
    locale: 'en-US',
    maxFragments: 12,
  });

  expect(englishPlan.exactLookupTerms).toEqual(
    expect.arrayContaining(['account', 'real time', 'real-time', 'us']),
  );
  expect(englishPlan.ftsFragments.length).toBeLessThanOrEqual(24);

  const cjkText = '请检查AI、3D和奖励';
  expect(
    buildTermSearchPlanForLocale(cjkText, { locale: 'zh-CN', maxFragments: 18 }),
  ).toEqual(buildTermSearchPlan(cjkText, { locale: 'zh-CN', maxFragments: 18 }));
});
```

- [ ] **Step 4: Run tests and confirm RED**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts
```

Expected: FAIL because `buildTermSearchPlanForLocale` and `findTermPositionsInTextForLocale` are not exported yet.

---

### Task 2: Implement Profile API With Strict Core Delegation

**Files:**
- Create: `packages/core/src/text/termMatchingProfiles.ts`
- Modify: `packages/core/src/text/index.ts`

- [ ] **Step 1: Create profile module skeleton**

Create `packages/core/src/text/termMatchingProfiles.ts`:

```ts
import {
  buildTermSearchPlan,
  findTermPositionsInText,
  normalizeTermForLookup,
  type TermMatchPosition,
  type TermSearchFragmentOptions,
  type TermSearchOptions,
  type TermSearchPlan,
} from './termMatching';

const ENGLISH_ALIAS_LIMIT = 16;
const LETTER_RE = /\p{L}/u;
const CJK_LIKE_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function buildTermSearchPlanForLocale(
  value: string,
  options?: TermSearchFragmentOptions,
): TermSearchPlan {
  if (!isEnglishLocale(options?.locale) || hasCjkLikeText(value)) {
    return buildTermSearchPlan(value, options);
  }

  const strictPlan = buildTermSearchPlan(value, options);
  const aliases = buildEnglishSourceAliases(value, options?.locale).slice(0, ENGLISH_ALIAS_LIMIT);
  return {
    ftsFragments: mergeUnique(strictPlan.ftsFragments, aliases),
    exactLookupTerms: mergeUnique(strictPlan.exactLookupTerms, aliases),
  };
}

export function findTermPositionsInTextForLocale(
  text: string,
  term: string,
  options?: TermSearchOptions,
): TermMatchPosition[] {
  const strictPositions = findTermPositionsInText(text, term, options);
  if (strictPositions.length > 0) return strictPositions;
  if (!isEnglishLocale(options?.locale) || hasCjkLikeText(term)) return [];

  for (const variant of buildEnglishTermVariants(term, options?.locale)) {
    const positions = findTermPositionsInText(text, variant, options);
    if (positions.length > 0) return positions;
  }

  return [];
}

function isEnglishLocale(locale?: string): boolean {
  const normalized = locale?.trim().toLowerCase();
  return normalized === 'en' || Boolean(normalized?.startsWith('en-'));
}

function hasCjkLikeText(value: string): boolean {
  return CJK_LIKE_RE.test(value);
}

function mergeUnique(base: string[], additions: string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const value of [...base, ...additions]) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }
  return merged;
}

function buildEnglishSourceAliases(value: string, locale?: string): string[] {
  const normalized = normalizeTermForLookup(value, { locale });
  const aliases: string[] = [];
  const tokens = normalized.match(/[\p{L}\p{N}.']+(?:[-\s][\p{L}\p{N}.']+)*/gu) ?? [];

  for (const token of tokens) {
    aliases.push(...buildEnglishTermVariants(token, locale));
  }

  return mergeUnique([], aliases);
}

function buildEnglishTermVariants(term: string, locale?: string): string[] {
  const normalized = normalizeTermForLookup(term, { locale });
  if (!LETTER_RE.test(normalized) || normalized.length < 2) return [];

  const variants: string[] = [];
  addPluralSingularVariants(variants, normalized);
  addPossessiveVariants(variants, normalized);
  addHyphenSpaceVariants(variants, normalized);
  addDottedAcronymVariants(variants, normalized);
  return mergeUnique([], variants.filter((variant) => variant !== normalized));
}

function addPluralSingularVariants(target: string[], value: string) {
  const parts = value.split(/\s+/g);
  if (parts.length !== 1) return;
  const word = parts[0];
  if (word.length < 3 || /[.'-]/u.test(word)) return;

  if (word.endsWith('ies') && word.length > 4) {
    target.push(`${word.slice(0, -3)}y`);
    return;
  }
  if (/(ches|shes|xes|zes|ses)$/u.test(word) && word.length > 4) {
    target.push(word.slice(0, -2));
    return;
  }
  if (word.endsWith('s') && !word.endsWith('ss') && word.length > 3) {
    target.push(word.slice(0, -1));
    return;
  }

  if (word.endsWith('y') && word.length > 3 && !/[aeiou]y$/u.test(word)) {
    target.push(`${word.slice(0, -1)}ies`);
    return;
  }
  if (/(ch|sh|x|z|s)$/u.test(word)) {
    target.push(`${word}es`);
    return;
  }
  target.push(`${word}s`);
}

function addPossessiveVariants(target: string[], value: string) {
  if (value.length < 3 || /\s/u.test(value)) return;
  if (value.endsWith("'s")) {
    target.push(value.slice(0, -2));
    return;
  }
  if (value.endsWith("'")) {
    target.push(value.slice(0, -1));
    return;
  }
  target.push(`${value}'s`, `${value}s'`);
}

function addHyphenSpaceVariants(target: string[], value: string) {
  if (value.includes('-')) target.push(value.replace(/-+/g, ' '));
  if (value.includes(' ')) target.push(value.replace(/\s+/g, '-'));
}

function addDottedAcronymVariants(target: string[], value: string) {
  if (/^(?:[a-z]\.){2,}$/u.test(value)) {
    target.push(value.replace(/\./g, ''));
    return;
  }
  if (/^[a-z]{2,5}$/u.test(value)) {
    target.push(Array.from(value).join('.') + '.');
  }
}
```

- [ ] **Step 2: Re-export profile APIs**

Update `packages/core/src/text/index.ts`:

```ts
export {
  buildTermSearchPlanForLocale,
  findTermPositionsInTextForLocale,
} from './termMatchingProfiles';
```

- [ ] **Step 3: Run tests and confirm GREEN**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts
```

Expected: PASS.

- [ ] **Step 4: Refactor only if needed**

If `termMatchingProfiles.ts` becomes difficult to read, extract private helpers into `packages/core/src/text/englishTermVariants.ts`. Do not change public API names in this task.

---

### Task 3: Add Service-Level Final Matching Tests

**Files:**
- Modify: `apps/desktop/src/main/services/TBService.test.ts`

- [ ] **Step 1: Add English variant service test**

Insert after the existing width-normalized Latin test:

```ts
it('matches conservative English variants during final term matching', async () => {
  const service = createServiceWithEntries([
    {
      id: 'tb-account',
      tbId: 'tb-en',
      srcTerm: 'account',
      tgtTerm: 'compte',
      srcNorm: 'account',
      note: null,
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      tbName: 'English TB',
      priority: 1,
    },
    {
      id: 'tb-user',
      tbId: 'tb-en',
      srcTerm: 'user',
      tgtTerm: 'utilisateur',
      srcNorm: 'user',
      note: null,
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      tbName: 'English TB',
      priority: 1,
    },
    {
      id: 'tb-real-time',
      tbId: 'tb-en',
      srcTerm: 'real time',
      tgtTerm: 'temps reel',
      srcNorm: 'real time',
      note: null,
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      tbName: 'English TB',
      priority: 1,
    },
    {
      id: 'tb-us',
      tbId: 'tb-en',
      srcTerm: 'US',
      tgtTerm: 'Etats-Unis',
      srcNorm: 'us',
      note: null,
      createdAt: '',
      updatedAt: '',
      usageCount: 1,
      tbName: 'English TB',
      priority: 1,
    },
  ]);

  const matches = await service.findMatches(
    1,
    buildSegment("Accounts sync from the user's real-time U.S. profile."),
  );

  expect(matches.map((match) => match.srcTerm)).toEqual(['real time', 'account', 'user', 'US']);
});
```

- [ ] **Step 2: Add non-English strict service test**

Add:

```ts
it('keeps non-English profiles strict for English inflections', async () => {
  const service = createServiceWithEntries(
    [
      {
        id: 'tb-account-strict',
        tbId: 'tb-fr',
        srcTerm: 'account',
        tgtTerm: 'compte',
        srcNorm: 'account',
        note: null,
        createdAt: '',
        updatedAt: '',
        usageCount: 1,
        tbName: 'Strict TB',
        priority: 1,
      },
    ],
    { srcLang: 'fr-FR' },
  );

  const matches = await service.findMatches(1, buildSegment('Accounts are synced.'));
  expect(matches).toHaveLength(0);
});
```

- [ ] **Step 3: Run test and confirm RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBService.test.ts
```

Expected: FAIL because `TBService` still calls strict `findTermPositionsInText`.

---

### Task 4: Wire Final Matching Through Profile API

**Files:**
- Modify: `apps/desktop/src/main/services/TBService.ts`
- Modify: `packages/localization/src/services/TBService.ts`

- [ ] **Step 1: Update desktop TBService import**

Change:

```ts
import {
  findTermPositionsInText,
  serializeTokensToSearchText,
  suppressNestedTermMatches,
} from '@cat/core/text';
```

To:

```ts
import {
  findTermPositionsInTextForLocale,
  serializeTokensToSearchText,
  suppressNestedTermMatches,
} from '@cat/core/text';
```

- [ ] **Step 2: Update desktop final matching call**

Change:

```ts
const positions = findTermPositionsInText(sourceText, entry.srcTerm, {
  locale: project.srcLang,
});
```

To:

```ts
const positions = findTermPositionsInTextForLocale(sourceText, entry.srcTerm, {
  locale: project.srcLang,
});
```

- [ ] **Step 3: Mirror the same import and call in localization TBService**

Apply the same two-line functional change in `packages/localization/src/services/TBService.ts`.

- [ ] **Step 4: Run service tests and confirm GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBService.test.ts
```

Expected: PASS.

---

### Task 5: Add Repository/Flow Recall Tests

**Files:**
- Modify: `apps/desktop/src/main/services/TBMatchFlow.test.ts`

- [ ] **Step 1: Add memory DB flow test for English candidate recall**

Add this test inside `describe('TB match flow trace', ...)`:

```ts
it('recalls English inflection and punctuation aliases through repo candidates', async () => {
  const db = new CATDatabase(':memory:');
  try {
    const projectId = db.createProject('English Alias Recall', 'en-US', 'fr-FR');
    const tbId = db.createTermBase('English Terms', 'en-US', 'fr-FR');
    db.mountTermBaseToProject(projectId, tbId, 1);
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'tb-account',
      tbId,
      srcLang: 'en-US',
      srcTerm: 'account',
      tgtTerm: 'compte',
    });
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'tb-real-time',
      tbId,
      srcLang: 'en-US',
      srcTerm: 'real time',
      tgtTerm: 'temps reel',
    });
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'tb-us',
      tbId,
      srcLang: 'en-US',
      srcTerm: 'US',
      tgtTerm: 'Etats-Unis',
    });

    const trace = await traceTBMatchFlow({
      db,
      projectId,
      source: 'Accounts use real-time U.S. settings.',
      focusSrcTerms: ['account', 'real time', 'US'],
    });

    expect(trace.step3RepoCandidateRecall.focusCandidates.map((entry) => entry.srcTerm)).toEqual(
      expect.arrayContaining(['account', 'real time', 'US']),
    );
    expect(trace.step6FinalMatches.focusMatches.map((match) => match.srcTerm)).toEqual(
      expect.arrayContaining(['account', 'real time', 'US']),
    );
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Add non-English repo recall guard**

Add:

```ts
it('does not apply English alias recall for non-English source projects', async () => {
  const db = new CATDatabase(':memory:');
  try {
    const projectId = db.createProject('Strict Non-English Recall', 'fr-FR', 'en-US');
    const tbId = db.createTermBase('Strict Terms', 'fr-FR', 'en-US');
    db.mountTermBaseToProject(projectId, tbId, 1);
    db.insertTBEntryIfAbsentBySrcTerm({
      id: 'tb-account-strict',
      tbId,
      srcLang: 'fr-FR',
      srcTerm: 'account',
      tgtTerm: 'compte',
    });

    const trace = await traceTBMatchFlow({
      db,
      projectId,
      source: 'Accounts are synced.',
      focusSrcTerms: ['account'],
    });

    expect(trace.step3RepoCandidateRecall.focusCandidates).toEqual([]);
    expect(trace.step6FinalMatches.focusMatches).toEqual([]);
  } finally {
    db.close();
  }
});
```

- [ ] **Step 3: Run flow tests and confirm RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts
```

Expected: FAIL because `TBRepo` still builds strict candidate plans.

---

### Task 6: Wire Repository Recall Through Profile API

**Files:**
- Modify: `packages/db/src/repos/TBRepo.ts`

- [ ] **Step 1: Update import**

Change:

```ts
import { buildTermSearchPlan, normalizeTermForLookup } from '@cat/core/text';
```

To:

```ts
import { buildTermSearchPlanForLocale, normalizeTermForLookup } from '@cat/core/text';
```

- [ ] **Step 2: Update search plan creation**

Change:

```ts
const searchPlan = buildTermSearchPlan(sourceText, {
  locale: options?.srcLang,
  maxFragments: 36,
});
```

To:

```ts
const searchPlan = buildTermSearchPlanForLocale(sourceText, {
  locale: options?.srcLang,
  maxFragments: 36,
});
```

- [ ] **Step 3: Leave SQL and caps unchanged**

Do not change:

```ts
const limit = Math.max(1, Math.min(options?.limit ?? 200, 500));
```

Do not change `EXACT_CJK_BATCH_SIZE`, FTS query construction, ordering, or `mergeSearchCandidates`.

- [ ] **Step 4: Run flow tests and confirm GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBMatchFlow.test.ts
```

Expected: PASS.

---

### Task 7: CJK Regression Verification

**Files:**
- Inspect: `packages/core/src/text/index.test.ts`
- Inspect: `apps/desktop/src/main/services/TBService.test.ts`
- Inspect: `packages/localization/src/modules/TBModule.test.ts`
- Modify tests only if an existing CJK path is not covered.

- [ ] **Step 1: Run existing core text tests**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts
```

Expected: PASS. Existing CJK fragment tests should remain unchanged.

- [ ] **Step 2: Run existing desktop TB service parity tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBService.test.ts
```

Expected: PASS. Existing CJK service tests should remain unchanged. Desktop
coverage is parity coverage for the shared TB service behavior.

- [ ] **Step 3: Run shared localization module integration tests**

Run:

```powershell
npx vitest run packages/localization/src/modules/TBModule.test.ts
```

Expected: PASS. `TBModule.test.ts` proves the shared package-level
CLI/headless path recalls English TB references through repo candidates and
final TB matching, with a non-English strict guard.

- [ ] **Step 4: Add a CJK profile parity test only if coverage is missing**

If the tests do not already compare strict and profile search plans for CJK, add:

```ts
const source = '完成任务后可获得限定称号【示例项·通用标题】';
expect(buildTermSearchPlanForLocale(source, { locale: 'zh-CN', maxFragments: 18 })).toEqual(
  buildTermSearchPlan(source, { locale: 'zh-CN', maxFragments: 18 }),
);
```

- [ ] **Step 5: Confirm no English helper is called for CJK/default**

Review `termMatchingProfiles.ts` and confirm CJK/default exits before alias generation:

```ts
if (!isEnglishLocale(options?.locale) || hasCjkLikeText(value)) {
  return buildTermSearchPlan(value, options);
}
```

---

### Task 8: Documentation Update

**Files:**
- Modify: `DOCS/60_TM_TB_REFERENCE.md`

- [ ] **Step 1: Add TB profile behavior paragraph**

Under `## TB Behavior`, add:

```md
TB matching resolves a source-language profile from the project source locale.
The default/CJK profile uses strict normalized term matching. English source
projects add a conservative overlay for regular plural/singular forms,
possessives, hyphen/space equivalents, and dotted acronym equivalents. The
English overlay is bounded and does not enable fuzzy edit-distance matching.
```

- [ ] **Step 2: Add debugging note**

Under `## Debugging Path`, add:

```md
For English source projects, inspect both candidate recall and final TB matches
when debugging terminology. Candidate aliases and final variant matching should
agree; if candidates appear without final matches, check the profile variant
rules before changing SQL recall.
```

---

### Task 9: Final Verification

**Files:**
- No additional source files.

- [ ] **Step 1: Run focused test set**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts apps/desktop/src/main/services/TBService.test.ts packages/localization/src/modules/TBModule.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run package builds/typechecks**

Run:

```powershell
npm run build --workspace=packages/core
npx tsc --noEmit -p packages/db/tsconfig.json
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Check diff hygiene**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors. Status should include only planned files plus any pre-existing unrelated dirty files.

---

## Self-Review Checklist

- Every behavior change is behind `en*` profile dispatch.
- CJK/default calls still delegate to the existing strict core.
- Existing `normalizeTermForLookup` semantics remain unchanged.
- Candidate recall and final matching use matching profile APIs.
- English aliases are bounded and deduplicated.
- No fuzzy edit-distance or broad stemming was added.
- No DB migration or FTS schema change is required.
