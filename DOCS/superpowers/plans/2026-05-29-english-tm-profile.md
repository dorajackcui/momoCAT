# English TM Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an English-only TM profile that improves active TM fuzzy and conservative phrase concordance matching without changing CJK/default behavior.

**Architecture:** Keep the existing TM flow as the shared spine: mounted TMs, exact hash, candidate merge, sorting, diversity, and caps remain shared. Add a small `@cat/core/text` TM profile helper, thread an optional `profile: 'english'` through recall options, and use explicit profile dispatch in service/repository code so default/CJK paths stay behavior-equivalent.

**Tech Stack:** TypeScript, Vitest, SQLite/better-sqlite3, `@cat/core/text`, `@cat/localization`, `@cat/db`, existing desktop TM service flow tests.

---

## Non-Negotiable Implementation Rules

- Do not put English plural, hyphen, acronym, or phrase-concordance rules into CJK/default branches.
- Default/CJK callers must omit `profile`; omitted profile must preserve the current code path.
- Do not change CJK local-overlap thresholds, contained-CJK promotion, diversity bucketing, sorting, or caps.
- English recall variants are candidates only; final scoring/evidence gates decide whether a match is emitted.
- Do not add schema changes or import-time alias materialization in this version.

## File Structure

- Create `packages/core/src/text/tmMatchingProfiles.ts`
  - Owns TM profile resolution, default TM similarity normalization, English canonicalization, English recall terms, and conservative English phrase evidence.
  - Does not import DB or service code.

- Modify `packages/core/src/text/index.ts`
  - Re-export TM profile helper APIs.

- Modify `packages/core/src/text/index.test.ts`
  - Add focused helper tests for profile resolution, English canonicalization, recall terms, and phrase evidence.

- Modify `packages/db/src/types.ts`
  - Add optional `profile?: 'english'` to TM recall option types.

- Modify `packages/db/src/repos/TMRepo.ts`
  - Extend recall query plans behind `options.profile === 'english'`.
  - Preserve current default query-plan construction when profile is omitted.
  - Use English phrase evidence only in the English profile branch.

- Modify `packages/localization/src/services/TMService.ts`
  - Resolve project source profile.
  - Pass profile to repo recall only for English projects.
  - Keep default/CJK scoring exactly on the existing normalization/scoring path.
  - Apply English canonical scoring overlay only for English profile candidates.

- Modify `apps/desktop/src/main/services/TMService.test.ts`
  - Add service dispatch and scoring tests.
  - Keep existing CJK tests unchanged.

- Modify `apps/desktop/src/main/services/TMMatchFlow.test.ts`
  - Add memory-DB flow tests for English acronym and `Lumie Tree` phrase concordance.
  - Add rejection test proving `Tree` alone does not emit `Lumie Tree`.

- Modify `DOCS/60_TM_TB_REFERENCE.md`
  - Document English TM profile behavior after implementation.

---

### Task 1: Add Core TM Profile Helper

**Files:**
- Create: `packages/core/src/text/tmMatchingProfiles.ts`
- Modify: `packages/core/src/text/index.ts`
- Modify: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Add failing helper tests**

Add the planned imports to the existing import block in `packages/core/src/text/index.test.ts`:

```ts
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  resolveTMTextProfile,
```

Append this `describe` block near the existing text helper tests:

```ts
describe('TM Matching Profiles', () => {
  it('resolves only English locales to the English TM profile', () => {
    expect(resolveTMTextProfile('en')).toBe('english');
    expect(resolveTMTextProfile('en-US')).toBe('english');
    expect(resolveTMTextProfile('EN-gb')).toBe('english');
    expect(resolveTMTextProfile('zh-CN')).toBe('default');
    expect(resolveTMTextProfile('ja-JP')).toBe('default');
    expect(resolveTMTextProfile('fr-FR')).toBe('default');
    expect(resolveTMTextProfile(undefined)).toBe('default');
  });

  it('keeps default TM similarity normalization equivalent to current behavior', () => {
    expect(normalizeTextForTMSimilarity('  A.P.I.   KEY  ', 'default')).toBe('a.p.i. key');
  });

  it('canonicalizes conservative English TM variants', () => {
    expect(normalizeTextForTMSimilarity('A.P.I.', 'english')).toBe('api');
    expect(normalizeTextForTMSimilarity('real-time updates', 'english')).toBe(
      'real time update',
    );
    expect(normalizeTextForTMSimilarity('Lumie Trees', 'english')).toBe('lumie tree');
    expect(normalizeTextForTMSimilarity('Masquerade Lynxes', 'english')).toBe(
      'masquerade lynx',
    );
  });

  it('builds bounded English TM recall terms without ordinary acronym overreach', () => {
    expect(buildEnglishTMRecallTerms('API limits for Lumie Trees')).toEqual(
      expect.arrayContaining(['api', 'a.p.i.', 'lumie tree', 'lumie trees']),
    );
    expect(buildEnglishTMRecallTerms('A.P.I. limits')).toEqual(expect.arrayContaining(['api']));
    expect(buildEnglishTMRecallTerms('real-time updates')).toEqual(
      expect.arrayContaining(['real time', 'real-time']),
    );
    expect(buildEnglishTMRecallTerms('real time is ready')).not.toEqual(
      expect.arrayContaining(['r.e.a.l.', 't.i.m.e.', 'i.s.', 'r.e.a.d.y.']),
    );
    expect(buildEnglishTMRecallTerms('a '.repeat(80)).length).toBeLessThanOrEqual(32);
  });

  it('requires phrase-level evidence for English TM concordance', () => {
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie Tree now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie Trees now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Look at Lumie-Tree now.', 'Lumie Tree')).toBe(
      true,
    );
    expect(hasEnglishTMConcordanceEvidence('Tree', 'Lumie Tree')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('Open the menu.', 'The Curator')).toBe(false);
    expect(hasEnglishTMConcordanceEvidence('The value changed.', 'The Truth')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the helper tests and verify RED**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts
```

Expected: FAIL because `buildEnglishTMRecallTerms`, `hasEnglishTMConcordanceEvidence`, `normalizeTextForTMSimilarity`, and `resolveTMTextProfile` are not exported.

- [ ] **Step 3: Create the helper implementation**

Create `packages/core/src/text/tmMatchingProfiles.ts` with this implementation:

```ts
export type TMTextProfile = 'default' | 'english';

const MAX_ENGLISH_TM_RECALL_TERMS = 32;
const WORD_RE = /[\p{L}\p{N}]+(?:[.'-][\p{L}\p{N}]+)*/gu;
const LETTER_RE = /\p{L}/u;
const ENGLISH_STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'for',
  'from',
  'in',
  'is',
  'it',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

export function resolveTMTextProfile(locale?: string): TMTextProfile {
  const normalized = locale?.toLowerCase();
  if (normalized === 'en' || normalized?.startsWith('en-')) return 'english';
  return 'default';
}

export function normalizeTextForTMSimilarity(
  text: string,
  profile: TMTextProfile = 'default',
): string {
  if (profile !== 'english') {
    return text.toLowerCase().replace(/\s+/g, ' ').trim();
  }

  return text
    .normalize('NFKC')
    .replace(/([A-Z])\.(?=[A-Z](?:\.|$))/g, '$1')
    .replace(/['’]s\b/gi, '')
    .replace(/[-_]+/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => singularizeRegularWord(token) ?? token)
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildEnglishTMRecallTerms(text: string): string[] {
  const terms = new Set<string>();
  const rawTokens = Array.from(text.normalize('NFKC').matchAll(WORD_RE)).map((match) => match[0]);
  const canonicalTokens = normalizeTextForTMSimilarity(text, 'english').split(/\s+/).filter(Boolean);

  for (const rawToken of rawTokens) {
    addRecallTerm(terms, undotAcronym(rawToken));
    addRecallTerm(terms, dottedAcronym(rawToken));
  }

  for (const token of canonicalTokens) {
    if (isSignificantEnglishToken(token)) {
      addRecallTerm(terms, token);
      addRecallTerm(terms, singularizeRegularWord(token));
      addRecallTerm(terms, pluralizeRegularWord(token));
    }
  }

  for (const phrase of buildSignificantEnglishPhrases(canonicalTokens)) {
    addRecallTerm(terms, phrase);
    addRecallTerm(terms, phrase.replace(/\s+/g, '-'));
    addTrailingWordInflectionTerms(terms, phrase);
    addTrailingWordInflectionTerms(terms, phrase.replace(/\s+/g, '-'));
  }

  return Array.from(terms).slice(0, MAX_ENGLISH_TM_RECALL_TERMS);
}

export function hasEnglishTMConcordanceEvidence(queryText: string, candidateText: string): boolean {
  const query = normalizeTextForTMSimilarity(queryText, 'english');
  const candidate = normalizeTextForTMSimilarity(candidateText, 'english');
  const queryTokens = query.split(/\s+/).filter(Boolean);
  const candidateTokens = candidate.split(/\s+/).filter(Boolean);

  if (queryTokens.length === 0 || candidateTokens.length === 0) return false;

  if (queryTokens.length === 1 || candidateTokens.length === 1) {
    return (
      queryTokens.length === 1 &&
      candidateTokens.length === 1 &&
      queryTokens[0] === candidateTokens[0] &&
      isSignificantEnglishToken(queryTokens[0])
    );
  }

  const queryPhrases = buildSignificantEnglishPhrases(queryTokens);
  const candidatePhrases = buildSignificantEnglishPhrases(candidateTokens);

  if (candidatePhrases.some((phrase) => containsCanonicalPhrase(query, phrase))) return true;
  if (queryPhrases.some((phrase) => containsCanonicalPhrase(candidate, phrase))) return true;

  const overlap = longestCommonTokenRun(queryTokens, candidateTokens);
  if (overlap < 2) return false;

  const candidateCoverage = overlap / candidateTokens.length;
  const queryCoverage = overlap / queryTokens.length;
  return candidateCoverage >= 0.9 && queryCoverage < 0.9;
}

function addRecallTerm(target: Set<string>, value: string | null): void {
  const term = value?.trim();
  if (!term || target.size >= MAX_ENGLISH_TM_RECALL_TERMS) return;
  if (term.length < 3 && !/^[a-z]{2,5}$/i.test(term)) return;
  target.add(term.toLowerCase());
}

function isSignificantEnglishToken(token: string): boolean {
  return token.length >= 3 && !ENGLISH_STOPWORDS.has(token) && LETTER_RE.test(token);
}

function containsCanonicalPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function buildSignificantEnglishPhrases(tokens: string[]): string[] {
  const phrases: string[] = [];
  const maxWindow = Math.min(4, tokens.length);

  for (let windowSize = 2; windowSize <= maxWindow; windowSize += 1) {
    for (let index = 0; index <= tokens.length - windowSize; index += 1) {
      const slice = tokens.slice(index, index + windowSize);
      const first = slice[0];
      const last = slice[slice.length - 1];
      if (!isSignificantEnglishToken(first) || !isSignificantEnglishToken(last)) continue;
      phrases.push(slice.join(' '));
    }
  }

  return Array.from(new Set(phrases));
}

function longestCommonTokenRun(a: string[], b: string[]): number {
  let best = 0;
  let previous = new Array(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    const current = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] !== b[j - 1]) continue;
      current[j] = previous[j - 1] + 1;
      best = Math.max(best, current[j]);
    }
    previous = current;
  }

  return best;
}

function addTrailingWordInflectionTerms(target: Set<string>, value: string): void {
  const match = /^(.*[\s-])([a-z]+)$/iu.exec(value);
  if (!match) return;
  const [, prefix, word] = match;
  const singular = singularizeRegularWord(word);
  if (singular) addRecallTerm(target, `${prefix}${singular}`);
  const plural = pluralizeRegularWord(word);
  if (plural) addRecallTerm(target, `${prefix}${plural}`);
}

function dottedAcronym(rawValue: string): string | null {
  const raw = rawValue.normalize('NFKC').trim();
  if (!/^[A-Z]{2,5}$/u.test(raw)) return null;
  return `${Array.from(raw.toLowerCase()).join('.')}.`;
}

function undotAcronym(rawValue: string): string | null {
  const raw = rawValue.normalize('NFKC').trim();
  if (!/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) return null;
  return raw.replace(/\./g, '').toLowerCase();
}

function pluralizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 3) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/z$/i.test(value)) return `${value}zes`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

function singularizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 4) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (/[^aeiou]ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/zzes$/i.test(value)) return value.slice(0, -3);
  if (/(ches|shes|xes|zes)$/i.test(value)) return value.slice(0, -2);
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/^(buses|gases)$/i.test(value)) return value.slice(0, -2);
  if (/ses$/i.test(value)) return value.slice(0, -1);
  if (!/(ss|us|is)$/i.test(value) && /s$/i.test(value)) return value.slice(0, -1);
  return null;
}
```

- [ ] **Step 4: Re-export the helper APIs**

Add this export block to `packages/core/src/text/index.ts`:

```ts
export {
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  resolveTMTextProfile,
  type TMTextProfile,
} from './tmMatchingProfiles';
```

- [ ] **Step 5: Run helper tests and verify GREEN**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit helper work**

Run:

```powershell
git add packages/core/src/text/index.test.ts packages/core/src/text/index.ts packages/core/src/text/tmMatchingProfiles.ts
git commit -m "feat: add english tm profile helpers"
```

---

### Task 2: Thread the English Profile Through Service Recall Calls

**Files:**
- Modify: `packages/db/src/types.ts`
- Modify: `packages/localization/src/services/TMService.ts`
- Modify: `apps/desktop/src/main/services/TMService.test.ts`

- [ ] **Step 1: Add failing service dispatch tests**

In `apps/desktop/src/main/services/TMService.test.ts`, update `createService` params to accept `srcLang?: string`:

```ts
function createService(params: {
  mountedTMs: Array<{ id: string; name: string; type: 'working' | 'main' }>;
  srcLang?: string;
  exactMatchByHash?: Record<string, TMEntry | undefined>;
  concordanceEntries?: Array<TMEntry & { tmId: string }>;
  recallEntries?: Array<TMEntry & { tmId: string }>;
  searchTMRecallCandidates?: ReturnType<typeof vi.fn>;
  searchTMFuzzyRecallCandidates?: ReturnType<typeof vi.fn>;
  searchTMConcordanceRecallCandidates?: ReturnType<typeof vi.fn>;
}): TMService {
```

Use `params.srcLang ?? 'zh-CN'` for both the mocked project and mounted TMs:

```ts
srcLang: params.srcLang ?? 'zh-CN',
```

Add this test after `uses source-scoped recall candidates for fuzzy matching`:

```ts
it('passes the English profile to active TM recall only for English projects', async () => {
  const source = 'A.P.I.';
  const englishFuzzyRecall = vi.fn().mockReturnValue([]);
  const englishConcordanceRecall = vi.fn().mockReturnValue([]);
  const englishService = createService({
    srcLang: 'en-US',
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    searchTMFuzzyRecallCandidates: englishFuzzyRecall,
    searchTMConcordanceRecallCandidates: englishConcordanceRecall,
  });

  await englishService.findMatches(1, createSegment(source, 'source-hash'));

  expect(englishFuzzyRecall).toHaveBeenCalledWith(1, source, ['tm-main'], {
    scope: 'source',
    limit: 50,
    profile: 'english',
  });
  expect(englishConcordanceRecall).toHaveBeenCalledWith(1, source, ['tm-main'], {
    scope: 'source',
    limit: 50,
    rawLimit: 200,
    profile: 'english',
  });

  const cjkFuzzyRecall = vi.fn().mockReturnValue([]);
  const cjkConcordanceRecall = vi.fn().mockReturnValue([]);
  const cjkService = createService({
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    searchTMFuzzyRecallCandidates: cjkFuzzyRecall,
    searchTMConcordanceRecallCandidates: cjkConcordanceRecall,
  });

  await cjkService.findMatches(1, createSegment(source, 'source-hash'));

  expect(cjkFuzzyRecall).toHaveBeenCalledWith(1, source, ['tm-main'], {
    scope: 'source',
    limit: 50,
  });
  expect(cjkConcordanceRecall).toHaveBeenCalledWith(1, source, ['tm-main'], {
    scope: 'source',
    limit: 50,
    rawLimit: 200,
  });
});
```

- [ ] **Step 2: Run the dispatch test and verify RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: FAIL because English calls do not include `profile: 'english'`.

- [ ] **Step 3: Add profile fields to DB option types**

Modify `packages/db/src/types.ts`:

```ts
export interface TMRecallOptions {
  scope?: TMRecallScope;
  limit?: number;
  profile?: 'english';
}

export interface TMConcordanceRecallOptions {
  scope?: 'source';
  limit?: number;
  rawLimit?: number;
  profile?: 'english';
}
```

- [ ] **Step 4: Resolve the service profile and pass it only for English**

Modify imports in `packages/localization/src/services/TMService.ts`:

```ts
import {
  normalizeTextForTMSimilarity,
  resolveTMTextProfile,
  serializeTokensToDisplayText,
  serializeTokensToTextOnly,
} from '@cat/core/text';
```

At the top of `findMatches`, after mounted TM resolution, add:

```ts
const project = this.projectRepo.getProject(projectId);
const textProfile = resolveTMTextProfile(project?.srcLang);
const englishRecallOptions = textProfile === 'english' ? ({ profile: 'english' } as const) : {};
```

Change recall calls to:

```ts
const fuzzyCandidates = this.tmRepo.searchTMFuzzyRecallCandidates(
  projectId,
  sourceTextOnly,
  tmIds,
  { scope: 'source', limit: 50, ...englishRecallOptions },
);
const concordanceCandidates = this.tmRepo.searchTMConcordanceRecallCandidates(
  projectId,
  sourceTextOnly,
  tmIds,
  { scope: 'source', limit: 50, rawLimit: 200, ...englishRecallOptions },
);
```

Replace `normalizeForSimilarity` with:

```ts
private normalizeForSimilarity(text: string): string {
  return normalizeTextForTMSimilarity(text, 'default');
}
```

Do not use `textProfile` for scoring in this task; that happens in Task 3.

- [ ] **Step 5: Run the dispatch tests and verify GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit dispatch work**

Run:

```powershell
git add packages/db/src/types.ts packages/localization/src/services/TMService.ts apps/desktop/src/main/services/TMService.test.ts
git commit -m "feat: thread english tm profile through recall"
```

---

### Task 3: Add English Scoring Overlay in TMService

**Files:**
- Modify: `packages/localization/src/services/TMService.ts`
- Modify: `apps/desktop/src/main/services/TMService.test.ts`

- [ ] **Step 1: Add failing scoring tests**

Add these tests to `apps/desktop/src/main/services/TMService.test.ts` after the profile dispatch test:

```ts
it('scores English acronym punctuation variants as high TM matches when recalled', async () => {
  const source = 'A.P.I.';
  const service = createService({
    srcLang: 'en-US',
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    recallEntries: [
      createConcordanceEntry('tm-main', {
        srcHash: 'api',
        sourceText: 'API',
        targetText: 'API',
      }),
    ],
    concordanceEntries: [],
  });

  const matches = await service.findMatches(1, createSegment(source, 'source-hash'));

  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    kind: 'tm',
    srcHash: 'api',
    similarity: 99,
  });
});

it('does not use English scoring for non-English projects', async () => {
  const service = createService({
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    recallEntries: [
      createConcordanceEntry('tm-main', {
        srcHash: 'api',
        sourceText: 'API',
        targetText: 'API',
      }),
    ],
    concordanceEntries: [],
  });

  const matches = await service.findMatches(1, createSegment('A.P.I.', 'source-hash'));

  expect(matches).toHaveLength(0);
});

it('does not turn weak English token overlap into a TM match', async () => {
  const service = createService({
    srcLang: 'en-US',
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    recallEntries: [
      createConcordanceEntry('tm-main', {
        srcHash: 'the-truth',
        sourceText: 'The Truth',
        targetText: 'la Verite',
      }),
    ],
    concordanceEntries: [],
  });

  const matches = await service.findMatches(1, createSegment('The value changed.', 'source-hash'));

  expect(matches).toHaveLength(0);
});
```

- [ ] **Step 2: Run scoring tests and verify RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: FAIL because `A.P.I.` and `API` still score through default normalization only.

- [ ] **Step 3: Add profile-aware scoring while preserving default scoring**

In `packages/localization/src/services/TMService.ts`, keep both normalized forms:

```ts
const sourceNormalized = this.normalizeForSimilarity(sourceTextOnly);
const sourceProfileNormalized = normalizeTextForTMSimilarity(sourceTextOnly, textProfile);
```

Inside the candidate loop, after `candNormalized`, add:

```ts
const candProfileNormalized = normalizeTextForTMSimilarity(candTextOnly, textProfile);
```

After the existing `standardSimilarity` calculation block and before creating `baseMatch`, add:

```ts
if (textProfile === 'english') {
  standardSimilarity = Math.max(
    standardSimilarity,
    this.computeProfileStandardSimilarity(sourceProfileNormalized, candProfileNormalized),
  );
}
```

Add this private method near the existing scoring helpers:

```ts
private computeProfileStandardSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 99;

  const maxPossibleByLength = this.computeMaxLengthBound(a, b);
  if (maxPossibleByLength < TMService.MIN_SIMILARITY) return 0;

  const levSimilarity = this.computeLevenshteinSimilarity(a, b);
  const diceSimilarity = this.computeDiceSimilarity(a, b);
  const bonus = this.computeSimilarityBonus(a, b);
  return Math.min(
    99,
    Math.round(
      levSimilarity * TMService.LEVENSHTEIN_WEIGHT +
        diceSimilarity * TMService.DICE_WEIGHT +
        bonus,
    ),
  );
}
```

Do not change `localOverlap`, CJK diversity bucket calculation, or exact-hash behavior in this task.

- [ ] **Step 4: Run scoring tests and verify GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit scoring work**

Run:

```powershell
git add packages/localization/src/services/TMService.ts apps/desktop/src/main/services/TMService.test.ts
git commit -m "feat: add english tm scoring overlay"
```

---

### Task 4: Add English Recall Variants in TMRepo

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`
- Modify: `apps/desktop/src/main/services/TMMatchFlow.test.ts`

- [ ] **Step 1: Add failing memory-DB flow tests for English recall**

In `apps/desktop/src/main/services/TMMatchFlow.test.ts`, update `createRuntimeTMEntry` params to accept source and target languages:

```ts
function createRuntimeTMEntry(
  tmId: string,
  params: {
    srcHash: string;
    sourceText: string;
    targetText: string;
    projectId: number;
    srcLang?: string;
    tgtLang?: string;
  },
): TMEntryWithTmId {
```

Use the optional values in the returned entry:

```ts
srcLang: params.srcLang ?? 'zh-CN',
tgtLang: params.tgtLang ?? 'fr-FR',
```

Add this fixture near `seedCrowdedContainedCjkFixture`:

```ts
function seedEnglishTMFixture(db: CATDatabase): { projectId: number; tmId: string } {
  const projectId = db.createProject('Trace English TM Match', 'en-US', 'fr-FR');
  const tmId = db.createTM('TM_EN_TEST', 'en-US', 'fr-FR', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');

  for (const entry of [
    { srcHash: 'api', sourceText: 'API', targetText: 'API' },
    { srcHash: 'lumie-tree', sourceText: 'Lumie Tree', targetText: 'arbre Lumie' },
  ]) {
    db.upsertTMEntry(
      createRuntimeTMEntry(tmId, {
        projectId,
        srcHash: entry.srcHash,
        sourceText: entry.sourceText,
        targetText: entry.targetText,
        srcLang: 'en-US',
        tgtLang: 'fr-FR',
      }),
    );
  }

  return { projectId, tmId };
}
```

Add this test at the start of `describe('TM match flow trace', ...)`:

```ts
it('recalls and scores English acronym punctuation variants through active TM flow', async () => {
  const db = new CATDatabase(':memory:');
  try {
    const { projectId } = seedEnglishTMFixture(db);
    const trace = await traceActiveTMMatchFlow({
      db,
      projectId,
      source: 'A.P.I.',
      srcHash: 'source-hash',
      targetHashes: ['api'],
    });

    expect(trace.step3FuzzyRecall.targets.api).toHaveLength(1);
    expect(trace.step6FinalMatches[0]).toMatchObject({
      srcHash: 'api',
      kind: 'tm',
      similarity: 99,
    });
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run the flow test and verify RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: FAIL because `A.P.I.` does not recall TM source `API`.

If the command fails with a `better-sqlite3` Node ABI mismatch, run:

```powershell
npm run rebuild:test
```

Then rerun the Vitest command.

- [ ] **Step 3: Extend TMRepo query plans behind the English profile**

In `packages/db/src/repos/TMRepo.ts`, import the helpers:

```ts
import {
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
} from '@cat/core/text';
```

Extend the plan interfaces:

```ts
interface TMRecallQueryPlan {
  exactTerms: string[];
  primaryCjkFragments: string[];
  secondaryCjkFragments: string[];
  shortCjkTerms: string[];
  latinTerms: string[];
  englishTerms: string[];
}

interface TMConcordanceRecallQueryPlan {
  cjk4Fragments: string[];
  cjk3Fragments: string[];
  longCjkFragments: string[];
  latinTerms: string[];
  shortCjkTerms: string[];
  englishTerms: string[];
}
```

Change the fuzzy plan call:

```ts
const plan = this.buildTMRecallQueryPlan(sourceText, options.profile);
```

Change the first fuzzy FTS tier terms:

```ts
terms: [...plan.exactTerms, ...plan.latinTerms, ...plan.englishTerms],
```

Change the concordance plan call:

```ts
const plan = this.buildTMConcordanceRecallQueryPlan(queryText, options.profile);
```

Change the first concordance tier:

```ts
const tiers = [
  [...params.plan.cjk4Fragments, ...params.plan.latinTerms, ...params.plan.englishTerms],
  params.plan.longCjkFragments,
  params.plan.cjk3Fragments,
];
```

Update both plan builders:

```ts
private buildTMRecallQueryPlan(sourceText: string, profile?: 'english'): TMRecallQueryPlan {
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
    englishTerms:
      profile === 'english'
        ? this.selectSpreadFragments(buildEnglishTMRecallTerms(sourceText), 32)
        : [],
  };
}
```

```ts
private buildTMConcordanceRecallQueryPlan(
  queryText: string,
  profile?: 'english',
): TMConcordanceRecallQueryPlan {
  const terms = this.extractSearchTerms(queryText);
  const cjkComponents = this.uniqueTerms(terms.flatMap((term) => this.extractCjkComponents(term)));
  const cjk3 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 3));
  const cjk4 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 4));
  const cjk5 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 5));
  const cjk6 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 6));
  const cjk2 = cjkComponents.flatMap((component) => this.buildCjkWindows(component, 2));

  return {
    cjk4Fragments: this.selectSpreadFragments(
      this.uniqueTerms(cjk4),
      TM_CONCORDANCE_RECALL_CJK4_LIMIT,
    ),
    cjk3Fragments: this.selectSpreadFragments(
      this.uniqueTerms(cjk3),
      TM_CONCORDANCE_RECALL_CJK3_LIMIT,
    ),
    longCjkFragments: this.selectSpreadFragments(
      this.uniqueTerms([...cjk5, ...cjk6]),
      TM_CONCORDANCE_RECALL_CJK_LONG_LIMIT,
    ),
    latinTerms: this.selectSpreadFragments(
      this.uniqueTerms(terms.filter((term) => term.length >= 3 && !ONLY_CJK_RE.test(term))),
      TM_CONCORDANCE_RECALL_LATIN_LIMIT,
    ),
    shortCjkTerms: this.selectSpreadFragments(
      this.uniqueTerms(cjk2).filter((term) => !WEAK_SHORT_CJK_TERMS.has(term)),
      TM_CONCORDANCE_RECALL_SHORT_CJK_LIMIT,
    ),
    englishTerms:
      profile === 'english'
        ? this.selectSpreadFragments(buildEnglishTMRecallTerms(queryText), 32)
        : [],
  };
}
```

Add English evidence to `hasRecallEvidenceInText` after Latin evidence:

```ts
if (
  plan.englishTerms.some((term) => term.length >= 3 && normalizedCandidate.includes(term.toLowerCase()))
) {
  return true;
}
```

Do not change existing CJK evidence checks.

- [ ] **Step 4: Run flow test and verify GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit recall work**

Run:

```powershell
git add packages/db/src/repos/TMRepo.ts apps/desktop/src/main/services/TMMatchFlow.test.ts
git commit -m "feat: add english tm recall variants"
```

---

### Task 5: Add Conservative English Phrase Concordance Gates

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`
- Modify: `apps/desktop/src/main/services/TMMatchFlow.test.ts`

- [ ] **Step 1: Add failing phrase concordance flow tests**

Add these tests to `apps/desktop/src/main/services/TMMatchFlow.test.ts` after the acronym flow test:

```ts
it('recalls English plural phrase concordance without matching a single ordinary token', async () => {
  const db = new CATDatabase(':memory:');
  try {
    const { projectId } = seedEnglishTMFixture(db);
    const pluralTrace = await traceActiveTMMatchFlow({
      db,
      projectId,
      source: 'The Lumie Trees shimmer near the plaza.',
      srcHash: 'plural-source-hash',
      targetHashes: ['lumie-tree'],
    });

    expect(pluralTrace.step4ConcordanceRecall.targets['lumie-tree']).toHaveLength(1);
    expect(pluralTrace.step6FinalMatches.map((match) => match.srcHash)).toContain('lumie-tree');
    expect(
      pluralTrace.step6FinalMatches.find((match) => match.srcHash === 'lumie-tree'),
    ).toMatchObject({
      kind: 'concordance',
      srcHash: 'lumie-tree',
    });

    const weakTrace = await traceActiveTMMatchFlow({
      db,
      projectId,
      source: 'Tree',
      srcHash: 'weak-source-hash',
      targetHashes: ['lumie-tree'],
    });

    expect(weakTrace.step6FinalMatches.map((match) => match.srcHash)).not.toContain(
      'lumie-tree',
    );
  } finally {
    db.close();
  }
});
```

- [ ] **Step 2: Run phrase flow tests and verify RED**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: FAIL if `Lumie Trees` does not recall or final-match `Lumie Tree` as a concordance result.

- [ ] **Step 3: Pass profile into concordance row acceptance**

In `packages/db/src/repos/TMRepo.ts`, extend `collectConcordanceRecallRows` params:

```ts
profile?: 'english';
```

Pass it from `searchTMConcordanceRecallCandidates`:

```ts
profile: options.profile,
```

Add `profile?: 'english'` to the params for `collectConcordanceExactSourceTier`, `collectConcordanceFtsBatchTier`, `collectConcordanceLikeTier`, and `acceptConcordanceRecallRows`.

In every call to `acceptConcordanceRecallRows`, pass through `profile: params.profile`.

- [ ] **Step 4: Apply English phrase evidence before existing overlap evidence**

Change `acceptConcordanceRecallRows` to:

```ts
private acceptConcordanceRecallRows(params: {
  queryText: string;
  rows: TMRecallDbRow[];
  accepted: TMRecallDbRow[];
  seenIds: Set<string>;
  maxResults: number;
  stats: TMConcordanceRecallStats;
  profile?: 'english';
}): void {
  for (const row of params.rows) {
    if (params.accepted.length >= params.maxResults) break;
    if (params.seenIds.has(row.id)) continue;
    const hasEvidence =
      params.profile === 'english'
        ? hasEnglishTMConcordanceEvidence(params.queryText, row.ftsSrcText)
        : this.hasConcordanceRecallEvidence(params.queryText, row);
    if (!hasEvidence) continue;

    params.seenIds.add(row.id);
    params.accepted.push(row);
    params.stats.acceptedRows += 1;
  }
}
```

This keeps default/CJK concordance evidence on the existing method and makes English phrase evidence explicit.

- [ ] **Step 5: Run phrase flow tests and verify GREEN**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit phrase concordance work**

Run:

```powershell
git add packages/db/src/repos/TMRepo.ts apps/desktop/src/main/services/TMMatchFlow.test.ts
git commit -m "feat: gate english tm phrase concordance"
```

---

### Task 6: Document Behavior and Run Full Verification

**Files:**
- Modify: `DOCS/60_TM_TB_REFERENCE.md`

- [ ] **Step 1: Update TM documentation**

In `DOCS/60_TM_TB_REFERENCE.md`, add this paragraph after `## Current TM Flow`:

```md
For TM matching, source-language profile dispatch is explicit. Default/CJK
projects use the existing recall and scoring path. English source projects add
a conservative retrieval/scoring overlay for regular plural/singular forms,
hyphen/space equivalents, uppercase acronym-shaped dotted/undotted forms, and
multi-token phrase concordance such as `Lumie Tree`. English recall variants
are candidate generators only; final scoring and phrase evidence gates prevent
single ordinary tokens such as `the` or `tree` from becoming prompt noise.
```

- [ ] **Step 2: Run focused verification**

Run:

```powershell
npx vitest run packages/core/src/text/index.test.ts apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run type and package verification**

Run:

```powershell
npm run build --workspace=packages/core
npx tsc --noEmit -p packages/db/tsconfig.json
npm run typecheck --workspace=apps/desktop
git diff --check
```

Expected: all commands PASS.

- [ ] **Step 4: Commit docs and verification-ready state**

Run:

```powershell
git add DOCS/60_TM_TB_REFERENCE.md
git commit -m "docs: describe english tm profile"
```

---

## Final Review Checklist

- [ ] English profile helpers are isolated in `@cat/core/text`.
- [ ] `profile: 'english'` is omitted for non-English projects.
- [ ] Default/CJK `TMRepo` query plans still use the existing terms/fragments when no profile is passed.
- [ ] CJK scoring, local overlap, contained-CJK promotion, diversity, thresholds, sorting, and caps are unchanged.
- [ ] English recall variants are bounded.
- [ ] `A.P.I.` can match `API` in active TM flow.
- [ ] `Lumie Trees` can surface `Lumie Tree` as conservative concordance.
- [ ] `Tree` alone does not emit `Lumie Tree`.
- [ ] `The value changed.` does not emit `The Truth`.
- [ ] Focused tests, package build/typecheck, and `git diff --check` pass.
