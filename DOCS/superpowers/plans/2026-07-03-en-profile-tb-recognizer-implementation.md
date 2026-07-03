# EN Profile TB Recognizer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an EN/general TB recognizer path for non-CJK source projects while keeping CJK TM and TB routes unchanged.

**Architecture:** Add a shared source-profile resolver, a boundary-aware EN term recognizer in core text utilities, and an EN TB lookup path in `TBService` that uses an in-memory recognizer cache plus bounded DB fallback. CJK source projects continue through the current TM and TB implementations.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, existing `@cat/core/text`, `@cat/localization`, and `@cat/db` packages.

---

## File Structure

- Create `packages/core/src/text/sourceRecallProfile.ts`
  - Owns the project source-language routing rule: CJK source locales use `cjk`; every other project source locale uses `en`.
- Create `packages/core/src/text/englishTermRecognizer.ts`
  - Owns EN/general term variant generation, token-key indexing, source scanning, and hard-boundary filtering.
- Modify `packages/core/src/text/tokenText.ts`
  - Adds boundary metadata for serialized search text without changing the existing `serializeTokensToSearchText` behavior.
- Modify `packages/core/src/text/index.ts`
  - Exports the new profile resolver, boundary serializer, and recognizer types/helpers.
- Modify `packages/core/src/text/tmMatchingProfiles.ts`
  - Uses the shared source-profile resolver so CJK stays `default` and non-CJK routes to the existing English TM profile.
- Modify `packages/core/src/text/termMatchingProfiles.ts`
  - Uses the shared source-profile resolver so EN/general term search/final-position variants apply to non-CJK source projects.
- Modify `packages/localization/src/services/TBService.ts`
  - Splits CJK legacy lookup from EN/general recognizer lookup.
  - Adds an in-memory recognizer cache keyed by mounted TB state.
- Modify `packages/db/src/repos/TBRepo.ts`
  - Aligns DB fallback decisions with the shared source-profile resolver.
- Modify tests:
  - `packages/core/src/text/index.test.ts`
  - `packages/db/src/index.test.ts`
  - `packages/localization/src/modules/TBModule.test.ts`

## Pre-Execution Notes

- The current worktree already contains uncommitted TB hotfix changes. Do not revert them.
- Stage only the files touched by the current task before each task commit.
- CJK route invariance means CJK source projects must not call the EN recognizer path and must not adopt EN article, acronym, hyphen, plural, or single-word fallback behavior.

---

### Task 1: Shared Source Recall Profile

**Files:**
- Create: `packages/core/src/text/sourceRecallProfile.ts`
- Modify: `packages/core/src/text/index.ts`
- Modify: `packages/core/src/text/tmMatchingProfiles.ts`
- Modify: `packages/core/src/text/termMatchingProfiles.ts`
- Test: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Write failing profile resolver and routing tests**

In `packages/core/src/text/index.test.ts`, add `resolveSourceRecallProfile` to the import from `./index`:

```ts
import {
  buildEnglishTMConcordancePhraseTerms,
  buildEnglishTMRecallTerms,
  buildTermSearchPlan,
  buildTermSearchPlanForLocale,
  buildTermSearchFragments,
  computeMatchKey,
  findTermPositionsInText,
  findTermPositionsInTextForLocale,
  hasEnglishTMConcordanceEvidence,
  normalizeTextForTMSimilarity,
  normalizeTermForLookup,
  resolveSourceRecallProfile,
  resolveTMTextProfile,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToTextOnly,
  suppressNestedTermMatches,
} from './index';
```

Add this test in the `TM Matching Profiles` describe block before the existing `resolveTMTextProfile` test:

```ts
  it('resolves project source recall profiles from source locale only', () => {
    expect(resolveSourceRecallProfile('zh-CN')).toBe('cjk');
    expect(resolveSourceRecallProfile('ja-JP')).toBe('cjk');
    expect(resolveSourceRecallProfile('ko')).toBe('cjk');
    expect(resolveSourceRecallProfile('cmn-Hans-CN')).toBe('cjk');
    expect(resolveSourceRecallProfile('yue-Hant-HK')).toBe('cjk');

    expect(resolveSourceRecallProfile('en')).toBe('en');
    expect(resolveSourceRecallProfile('en-US')).toBe('en');
    expect(resolveSourceRecallProfile('fr-FR')).toBe('en');
    expect(resolveSourceRecallProfile('de-DE')).toBe('en');
    expect(resolveSourceRecallProfile(undefined)).toBe('en');
  });
```

Replace the existing `resolves only English locales to the English TM profile` test with:

```ts
  it('routes CJK TM to default and non-CJK TM to the English profile', () => {
    expect(resolveTMTextProfile('zh-CN')).toBe('default');
    expect(resolveTMTextProfile('ja-JP')).toBe('default');
    expect(resolveTMTextProfile('ko-KR')).toBe('default');
    expect(resolveTMTextProfile('en')).toBe('english');
    expect(resolveTMTextProfile('en-US')).toBe('english');
    expect(resolveTMTextProfile('EN-gb')).toBe('english');
    expect(resolveTMTextProfile('fr-FR')).toBe('english');
    expect(resolveTMTextProfile(undefined)).toBe('english');
  });
```

In the `uses English final-position profile variants while non-English stays strict` test, replace the strict French assertion with a CJK strict assertion and a non-CJK EN/general assertion:

```ts
    expect(
      findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'fr-FR' }),
    ).toHaveLength(1);
    expect(
      findTermPositionsInTextForLocale('Accounts are synced.', 'account', { locale: 'zh-CN' }),
    ).toHaveLength(0);
```

In `adds English search-plan aliases without changing CJK plans`, add this assertion after the English plan assertions:

```ts
    const frenchProfilePlan = buildTermSearchPlanForLocale('Accounts use real-time settings.', {
      locale: 'fr-FR',
      maxFragments: 12,
    });
    expect(frenchProfilePlan.exactLookupTerms).toEqual(
      expect.arrayContaining(['account', 'real time', 'real-time']),
    );
```

- [ ] **Step 2: Run tests and verify they fail for missing resolver / old routing**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected before implementation: FAIL with `resolveSourceRecallProfile` not exported, or FAIL because `fr-FR` still routes to the default profile.

- [ ] **Step 3: Implement the shared resolver**

Create `packages/core/src/text/sourceRecallProfile.ts`:

```ts
export type SourceRecallProfile = 'cjk' | 'en';

const CJK_SOURCE_LOCALE_RE = /^(zh|ja|ko|cmn|yue)(?:-|$)/i;

export function resolveSourceRecallProfile(locale?: string): SourceRecallProfile {
  return CJK_SOURCE_LOCALE_RE.test(locale ?? '') ? 'cjk' : 'en';
}

export function isCjkSourceRecallProfile(locale?: string): boolean {
  return resolveSourceRecallProfile(locale) === 'cjk';
}
```

Export it from `packages/core/src/text/index.ts`:

```ts
export {
  isCjkSourceRecallProfile,
  resolveSourceRecallProfile,
  type SourceRecallProfile,
} from './sourceRecallProfile';
```

- [ ] **Step 4: Route TM and term matching profiles through the shared resolver**

In `packages/core/src/text/tmMatchingProfiles.ts`, add the import:

```ts
import { resolveSourceRecallProfile } from './sourceRecallProfile';
```

Replace `resolveTMTextProfile` with:

```ts
export function resolveTMTextProfile(locale?: string): TMTextProfile {
  return resolveSourceRecallProfile(locale) === 'en' ? 'english' : 'default';
}
```

In `packages/core/src/text/termMatchingProfiles.ts`, add:

```ts
import { resolveSourceRecallProfile } from './sourceRecallProfile';
```

Replace the existing `isEnglishLocale` body with:

```ts
function isEnglishLocale(locale?: string): boolean {
  return resolveSourceRecallProfile(locale) === 'en';
}
```

- [ ] **Step 5: Run core text tests and commit**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected after implementation: PASS.

Commit only Task 1 files:

```powershell
git add packages\core\src\text\sourceRecallProfile.ts packages\core\src\text\index.ts packages\core\src\text\tmMatchingProfiles.ts packages\core\src\text\termMatchingProfiles.ts packages\core\src\text\index.test.ts
git commit -m "feat: add shared source recall profile"
```

---

### Task 2: Boundary-Aware Search Text Serialization

**Files:**
- Modify: `packages/core/src/text/tokenText.ts`
- Modify: `packages/core/src/text/index.ts`
- Test: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Write failing boundary serialization tests**

Add `serializeTokensToSearchTextWithBoundaries` to the import from `./index`.

Add this test after `drops tags but keeps search boundaries around non-text tokens`:

```ts
  it('marks hard search boundaries introduced by non-text tokens', () => {
    const tagged = serializeTokensToSearchTextWithBoundaries([
      { type: 'text', content: 'API' },
      { type: 'tag', content: '<b>' },
      { type: 'text', content: 'key' },
    ]);

    expect(tagged.text).toBe('API key');
    expect(tagged.hardBoundaryOffsets).toEqual([3]);

    const plain = serializeTokensToSearchTextWithBoundaries([
      { type: 'text', content: 'API key' },
    ]);

    expect(plain.text).toBe('API key');
    expect(plain.hardBoundaryOffsets).toEqual([]);
  });
```

Add this test after it:

```ts
  it('keeps boundary-aware search text equal to regular search text', () => {
    const tokens: Token[] = [
      { type: 'ws', content: '  ' },
      { type: 'text', content: '  Hello' },
      { type: 'tag', content: '{1}' },
      { type: 'text', content: 'world  ' },
    ];

    expect(serializeTokensToSearchTextWithBoundaries(tokens).text).toBe(
      serializeTokensToSearchText(tokens),
    );
    expect(serializeTokensToSearchTextWithBoundaries(tokens)).toEqual({
      text: 'Hello world',
      hardBoundaryOffsets: [5],
    });
  });
```

- [ ] **Step 2: Run tests and verify they fail for missing export**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected before implementation: FAIL with `serializeTokensToSearchTextWithBoundaries` not exported.

- [ ] **Step 3: Implement boundary-aware serialization**

In `packages/core/src/text/tokenText.ts`, add:

```ts
export interface SearchTextWithBoundaries {
  text: string;
  hardBoundaryOffsets: number[];
}

export function serializeTokensToSearchTextWithBoundaries(tokens: Token[]): SearchTextWithBoundaries {
  let text = '';
  let inWhitespace = false;
  const hardBoundaryOffsets: number[] = [];

  const addHardBoundaryOffset = (offset: number) => {
    if (offset >= 0 && hardBoundaryOffsets[hardBoundaryOffsets.length - 1] !== offset) {
      hardBoundaryOffsets.push(offset);
    }
  };

  for (const token of tokens) {
    const isHardBoundary = token.type !== 'text';
    const content = isHardBoundary ? ' ' : token.content;

    for (const char of Array.from(content)) {
      if (/\s/u.test(char)) {
        if (text.length === 0) {
          inWhitespace = true;
          continue;
        }

        if (!inWhitespace) {
          text += ' ';
          inWhitespace = true;
        }

        if (isHardBoundary) {
          addHardBoundaryOffset(text.length - 1);
        }
        continue;
      }

      text += char;
      inWhitespace = false;
    }
  }

  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
  }

  return {
    text,
    hardBoundaryOffsets: hardBoundaryOffsets.filter((offset) => offset < text.length),
  };
}
```

Export it from `packages/core/src/text/index.ts`:

```ts
export {
  computeMatchKey,
  computeSrcHash,
  serializeTokensToDisplayText,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  serializeTokensToTextOnly,
  type SearchTextWithBoundaries,
} from './tokenText';
```

- [ ] **Step 4: Run core text tests and commit**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected after implementation: PASS.

Commit only Task 2 files:

```powershell
git add packages\core\src\text\tokenText.ts packages\core\src\text\index.ts packages\core\src\text\index.test.ts
git commit -m "feat: track hard search boundaries"
```

---

### Task 3: EN Term Recognizer Core

**Files:**
- Create: `packages/core/src/text/englishTermRecognizer.ts`
- Modify: `packages/core/src/text/index.ts`
- Test: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Write failing recognizer tests**

Add these imports from `./index`:

```ts
  buildEnglishTermRecognizer,
  type EnglishTermRecognizerEntry,
```

Add this describe block before `TM Matching Profiles`:

```ts
describe('English Term Recognizer', () => {
  const entries: EnglishTermRecognizerEntry[] = [
    {
      id: 'account',
      srcTerm: 'account',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'real-time',
      srcTerm: 'real time',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'us',
      srcTerm: 'US',
      priority: 10,
      usageCount: 0,
    },
    {
      id: 'day-of-birth',
      srcTerm: 'The Day of Birth',
      priority: 10,
      usageCount: 0,
    },
  ];

  it('recognizes canonical and conservative EN variants', () => {
    const recognizer = buildEnglishTermRecognizer(entries);
    const matches = recognizer.scan('Accounts use real-time U.S. settings. The Day of Birth opens.', {
      hardBoundaryOffsets: [],
    });

    expect(matches.map((match) => match.entry.id)).toEqual(
      expect.arrayContaining(['account', 'real-time', 'us', 'day-of-birth']),
    );
    expect(matches.find((match) => match.entry.id === 'account')?.variantKind).toBe(
      'inflection',
    );
    expect(matches.find((match) => match.entry.id === 'us')?.variantKind).toBe('acronym');
    expect(matches.find((match) => match.entry.id === 'day-of-birth')?.variantKind).toBe(
      'canonical',
    );
  });

  it('does not recognize terms across hard token boundaries', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'api-key',
        srcTerm: 'API key',
        priority: 10,
        usageCount: 0,
      },
    ]);

    expect(
      recognizer.scan('API key', {
        hardBoundaryOffsets: [3],
      }),
    ).toEqual([]);
    expect(
      recognizer.scan('API key', {
        hardBoundaryOffsets: [],
      }).map((match) => match.entry.id),
    ).toEqual(['api-key']);
  });

  it('keeps recognizer ordering deterministic', () => {
    const recognizer = buildEnglishTermRecognizer([
      {
        id: 'short',
        srcTerm: 'Birth',
        priority: 10,
        usageCount: 0,
      },
      {
        id: 'long',
        srcTerm: 'The Day of Birth',
        priority: 10,
        usageCount: 0,
      },
    ]);

    expect(
      recognizer.scan('The Day of Birth', {
        hardBoundaryOffsets: [],
      }).map((match) => match.entry.id),
    ).toEqual(['long', 'short']);
  });
});
```

- [ ] **Step 2: Run tests and verify they fail for missing recognizer**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected before implementation: FAIL with `buildEnglishTermRecognizer` not exported.

- [ ] **Step 3: Implement the recognizer module**

Create `packages/core/src/text/englishTermRecognizer.ts`:

```ts
export type EnglishTermVariantKind =
  | 'canonical'
  | 'article'
  | 'hyphen-space'
  | 'acronym'
  | 'inflection';

export interface EnglishTermRecognizerEntry {
  id: string;
  srcTerm: string;
  priority?: number;
  usageCount?: number;
}

export interface EnglishTermRecognizerMatch<T extends EnglishTermRecognizerEntry> {
  entry: T;
  variantKind: EnglishTermVariantKind;
  variantText: string;
  start: number;
  end: number;
  tokenStart: number;
  tokenEnd: number;
}

export interface EnglishTermRecognizerScanOptions {
  hardBoundaryOffsets?: number[];
}

interface IndexedVariant<T extends EnglishTermRecognizerEntry> {
  entry: T;
  key: string;
  tokenCount: number;
  variantKind: EnglishTermVariantKind;
  variantText: string;
}

interface SourceToken {
  value: string;
  start: number;
  end: number;
}

const WORD_RE = /[\p{L}\p{N}]+/gu;
const ENGLISH_ARTICLES = new Set(['the', 'a', 'an']);
const LETTER_RE = /\p{L}/u;
const INVARIANT_S_WORDS = new Set(['does', 'news', 'series', 'species']);

export class EnglishTermRecognizer<T extends EnglishTermRecognizerEntry> {
  private readonly variantsByKey = new Map<string, IndexedVariant<T>[]>();
  private readonly maxTokenCount: number;

  constructor(entries: T[]) {
    let maxTokenCount = 1;

    for (const entry of entries) {
      for (const variant of buildEnglishTermVariants(entry.srcTerm)) {
        const tokens = tokenizeKey(variant.text);
        if (tokens.length === 0) continue;
        const key = tokens.join(' ');
        const indexed: IndexedVariant<T> = {
          entry,
          key,
          tokenCount: tokens.length,
          variantKind: variant.kind,
          variantText: variant.text,
        };
        const bucket = this.variantsByKey.get(key) ?? [];
        bucket.push(indexed);
        this.variantsByKey.set(key, bucket);
        maxTokenCount = Math.max(maxTokenCount, tokens.length);
      }
    }

    for (const bucket of this.variantsByKey.values()) {
      bucket.sort(compareIndexedVariants);
    }

    this.maxTokenCount = maxTokenCount;
  }

  public scan(text: string, options: EnglishTermRecognizerScanOptions = {}): EnglishTermRecognizerMatch<T>[] {
    const sourceTokens = tokenizeSource(text);
    const hardBoundaryOffsets = options.hardBoundaryOffsets ?? [];
    const matches: EnglishTermRecognizerMatch<T>[] = [];

    for (let startIndex = 0; startIndex < sourceTokens.length; startIndex += 1) {
      const parts: string[] = [];
      const maxEnd = Math.min(sourceTokens.length, startIndex + this.maxTokenCount);

      for (let endIndex = startIndex; endIndex < maxEnd; endIndex += 1) {
        const start = sourceTokens[startIndex].start;
        const end = sourceTokens[endIndex].end;
        if (crossesHardBoundary(start, end, hardBoundaryOffsets)) break;

        parts.push(sourceTokens[endIndex].value);
        const key = parts.join(' ');
        const variants = this.variantsByKey.get(key);
        if (!variants) continue;

        for (const variant of variants) {
          matches.push({
            entry: variant.entry,
            variantKind: variant.variantKind,
            variantText: variant.variantText,
            start,
            end,
            tokenStart: startIndex,
            tokenEnd: endIndex + 1,
          });
        }
      }
    }

    return matches.sort(compareMatches);
  }
}

export function buildEnglishTermRecognizer<T extends EnglishTermRecognizerEntry>(
  entries: T[],
): EnglishTermRecognizer<T> {
  return new EnglishTermRecognizer(entries);
}

function buildEnglishTermVariants(srcTerm: string): Array<{ kind: EnglishTermVariantKind; text: string }> {
  const variants = new Map<string, EnglishTermVariantKind>();
  const canonicalTokens = tokenizeKey(srcTerm);
  if (canonicalTokens.length === 0) return [];

  addVariant(variants, canonicalTokens, 'canonical');
  addArticleVariants(variants, canonicalTokens);
  addFinalInflectionVariants(variants, canonicalTokens);
  addAcronymVariants(variants, srcTerm);

  return Array.from(variants, ([text, kind]) => ({ text, kind }));
}

function addVariant(
  variants: Map<string, EnglishTermVariantKind>,
  tokens: string[],
  kind: EnglishTermVariantKind,
): void {
  if (tokens.length === 0) return;
  const text = tokens.join(' ');
  if (!variants.has(text)) variants.set(text, kind);
}

function addArticleVariants(
  variants: Map<string, EnglishTermVariantKind>,
  canonicalTokens: string[],
): void {
  if (canonicalTokens.length < 2) return;

  const [first, ...rest] = canonicalTokens;
  if (ENGLISH_ARTICLES.has(first)) {
    addVariant(variants, rest, 'article');
    return;
  }

  for (const article of ENGLISH_ARTICLES) {
    addVariant(variants, [article, ...canonicalTokens], 'article');
  }
}

function addFinalInflectionVariants(
  variants: Map<string, EnglishTermVariantKind>,
  canonicalTokens: string[],
): void {
  const last = canonicalTokens[canonicalTokens.length - 1];
  const prefix = canonicalTokens.slice(0, -1);
  const singular = singularizeRegularWord(last);
  const plural = pluralizeRegularWord(last);

  if (singular) addVariant(variants, [...prefix, singular], 'inflection');
  if (plural) addVariant(variants, [...prefix, plural], 'inflection');
}

function addAcronymVariants(
  variants: Map<string, EnglishTermVariantKind>,
  srcTerm: string,
): void {
  const raw = srcTerm.normalize('NFKC').trim();
  if (/^[A-Z]{2,5}$/u.test(raw)) {
    addVariant(variants, [raw.toLowerCase()], 'acronym');
    addVariant(variants, Array.from(raw.toLowerCase()), 'acronym');
  }

  if (/^[A-Z](?:\.[A-Z]){1,4}\.?$/u.test(raw)) {
    const letters = raw.replace(/\./g, '').toLowerCase();
    addVariant(variants, [letters], 'acronym');
    addVariant(variants, Array.from(letters), 'acronym');
  }
}

function tokenizeKey(value: string): string[] {
  return Array.from(value.normalize('NFKC').matchAll(WORD_RE), (match) =>
    match[0].toLowerCase(),
  );
}

function tokenizeSource(text: string): SourceToken[] {
  return Array.from(text.matchAll(WORD_RE), (match) => ({
    value: match[0].normalize('NFKC').toLowerCase(),
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));
}

function crossesHardBoundary(start: number, end: number, hardBoundaryOffsets: number[]): boolean {
  return hardBoundaryOffsets.some((offset) => start < offset && offset < end);
}

function pluralizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 3) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (/[^aeiou]y$/i.test(value)) return `${value.slice(0, -1)}ies`;
  if (/zz$/i.test(value)) return `${value}es`;
  if (/z$/i.test(value)) return `${value}zes`;
  if (/(s|x|z|ch|sh)$/i.test(value)) return `${value}es`;
  return `${value}s`;
}

function singularizeRegularWord(value: string): string | null {
  if (!LETTER_RE.test(value) || value.length < 4) return null;
  if (/[^a-z]/i.test(value)) return null;
  if (INVARIANT_S_WORDS.has(value.toLowerCase())) return null;
  if (/[^aeiou]ies$/i.test(value)) return `${value.slice(0, -3)}y`;
  if (/zzes$/i.test(value)) return value.slice(0, -3);
  if (/(ches|shes|xes|zes)$/i.test(value)) return value.slice(0, -2);
  if (/sses$/i.test(value)) return value.slice(0, -2);
  if (/^(buses|gases)$/i.test(value)) return value.slice(0, -2);
  if (/ses$/i.test(value)) return value.slice(0, -1);
  if (value.length >= 5 && !/(ss|us|is)$/i.test(value) && /s$/i.test(value)) {
    return value.slice(0, -1);
  }
  return null;
}

function compareIndexedVariants<T extends EnglishTermRecognizerEntry>(
  a: IndexedVariant<T>,
  b: IndexedVariant<T>,
): number {
  if (b.tokenCount !== a.tokenCount) return b.tokenCount - a.tokenCount;
  return variantRank(a.variantKind) - variantRank(b.variantKind);
}

function compareMatches<T extends EnglishTermRecognizerEntry>(
  a: EnglishTermRecognizerMatch<T>,
  b: EnglishTermRecognizerMatch<T>,
): number {
  if (a.start !== b.start) return a.start - b.start;
  if (b.end !== a.end) return b.end - a.end;
  return variantRank(a.variantKind) - variantRank(b.variantKind);
}

function variantRank(kind: EnglishTermVariantKind): number {
  switch (kind) {
    case 'canonical':
      return 0;
    case 'article':
      return 1;
    case 'hyphen-space':
      return 2;
    case 'acronym':
      return 3;
    case 'inflection':
      return 4;
  }
}
```

Export it from `packages/core/src/text/index.ts`:

```ts
export {
  EnglishTermRecognizer,
  buildEnglishTermRecognizer,
  type EnglishTermRecognizerEntry,
  type EnglishTermRecognizerMatch,
  type EnglishTermRecognizerScanOptions,
  type EnglishTermVariantKind,
} from './englishTermRecognizer';
```

- [ ] **Step 4: Run core text tests and commit**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts
```

Expected after implementation: PASS.

Commit only Task 3 files:

```powershell
git add packages\core\src\text\englishTermRecognizer.ts packages\core\src\text\index.ts packages\core\src\text\index.test.ts
git commit -m "feat: add english term recognizer"
```

---

### Task 4: EN TB Lookup Profile in TBService

**Files:**
- Modify: `packages/localization/src/services/TBService.ts`
- Test: `packages/localization/src/modules/TBModule.test.ts`

- [ ] **Step 1: Write failing EN/general service tests**

In `packages/localization/src/modules/TBModule.test.ts`, replace the current test named `does not apply English TB recall rules to non-English source projects` with:

```ts
  it('applies EN/general TB recall rules to non-CJK source projects', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('French General TB Profile', 'fr-FR', 'en-US');
      const tbId = db.createTermBase('French Client Terms', 'fr-FR', 'en-US');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account-fr-source',
        tbId,
        srcLang: 'fr-FR',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const segment = createTransientSegment(
        { id: 'unit-french-general', source: 'Accounts are synced.' },
        0,
        {
          projectId,
          sourceLanguage: 'fr-FR',
          targetLanguage: 'en-US',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).toContain('account');
      expect(artifact.selectedReferences.map((reference) => reference.srcTerm)).toContain(
        'account',
      );
    } finally {
      db.close();
    }
  });
```

Add this CJK guard test after it:

```ts
  it('keeps CJK source projects off the EN/general TB recognizer route', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Chinese TB Guard', 'zh-CN', 'fr-FR');
      const tbId = db.createTermBase('Chinese Client Terms', 'zh-CN', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account-zh-source',
        tbId,
        srcLang: 'zh-CN',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const segment = createTransientSegment(
        { id: 'unit-chinese-guard', source: 'Accounts are synced.' },
        0,
        {
          projectId,
          sourceLanguage: 'zh-CN',
          targetLanguage: 'fr-FR',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).not.toContain('account');
    } finally {
      db.close();
    }
  });
```

Add this hard-boundary regression test:

```ts
  it('does not match EN/general TB terms across protected token boundaries', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('English Boundary TB Profile', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('Boundary Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-api-key',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'API key',
        tgtTerm: 'cle API',
      });

      const segment = createTransientSegment(
        { id: 'unit-api-boundary', source: 'API key' },
        0,
        {
          projectId,
          sourceLanguage: 'en-US',
          targetLanguage: 'fr-FR',
        },
      );
      segment.sourceTokens = [
        { type: 'text', content: 'API' },
        { type: 'tag', content: '{1}', meta: { id: '{1}' } },
        { type: 'text', content: 'key' },
      ];

      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).not.toContain('API key');
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run localization tests and verify they fail under old service routing**

Run:

```powershell
npx vitest run packages\localization\src\modules\TBModule.test.ts
```

Expected before implementation: FAIL because `fr-FR` does not yet use EN/general TB recognition.

- [ ] **Step 3: Split CJK legacy lookup from EN/general recognizer lookup**

In `packages/localization/src/services/TBService.ts`, replace the imports with:

```ts
import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  buildEnglishTermRecognizer,
  findTermPositionsInTextForLocale,
  resolveSourceRecallProfile,
  serializeTokensToSearchText,
  serializeTokensToSearchTextWithBoundaries,
  suppressNestedTermMatches,
  type EnglishTermRecognizer,
  type EnglishTermRecognizerMatch,
  type EnglishTermVariantKind,
} from '@cat/core/text';
import type { MountedTBRecord, ProjectRepository, TBRepository } from '../ports';
```

Remove the local `isEnglishSourceLocale` helper.

Add these types below `ProjectTBEntry`:

```ts
type EnglishRecognizerEntry = ProjectTBEntry & {
  priority: number;
  usageCount: number;
};

type EnglishCandidateTier = 'recognizerCanonical' | 'recognizerVariant' | 'dbFallback';

interface EnglishTBRecognizerCacheEntry {
  key: string;
  recognizer: EnglishTermRecognizer<EnglishRecognizerEntry>;
}

interface EnglishTBCandidate {
  entry: EnglishRecognizerEntry;
  positions: Array<{ start: number; end: number }>;
  tier: EnglishCandidateTier;
  variantKind?: EnglishTermVariantKind;
}
```

Add a private cache field to `TBService`:

```ts
  private readonly englishRecognizerCache = new Map<number, EnglishTBRecognizerCacheEntry>();
```

Replace `findMatches` with:

```ts
  public async findMatches(projectId: number, segment: Segment): Promise<TBMatch[]> {
    const project = this.projectRepo.getProject(projectId);
    if (!project) return [];

    const profile = resolveSourceRecallProfile(project.srcLang);
    if (profile === 'en') {
      return this.findEnglishProfileMatches(projectId, segment, project.srcLang);
    }

    return this.findLegacyProfileMatches(projectId, segment, project.srcLang);
  }
```

Add the legacy CJK/default method by moving the current body into it:

```ts
  private findLegacyProfileMatches(
    projectId: number,
    segment: Segment,
    srcLang: string,
  ): TBMatch[] {
    const sourceText = serializeTokensToSearchText(segment.sourceTokens);
    if (!sourceText.trim()) return [];

    const searchEntries = this.db.searchProjectTermEntries(projectId, sourceText, {
      srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as ProjectTBEntry[];
    const entries =
      searchEntries.length > 0
        ? searchEntries
        : (this.db.listProjectTermEntries(projectId) as ProjectTBEntry[]);
    if (entries.length === 0) return [];

    const matches: TBMatch[] = [];
    const seenSrcNorm = new Set<string>();

    for (const entry of entries) {
      if (seenSrcNorm.has(entry.srcNorm)) continue;
      const positions = findTermPositionsInTextForLocale(sourceText, entry.srcTerm, {
        locale: srcLang,
      });
      if (positions.length === 0) continue;

      matches.push({
        ...entry,
        positions,
      });
      seenSrcNorm.add(entry.srcNorm);
    }

    return suppressNestedTermMatches(
      matches.sort((a, b) => {
        if (b.srcTerm.length !== a.srcTerm.length) return b.srcTerm.length - a.srcTerm.length;
        return a.priority - b.priority;
      }),
    );
  }
```

Keep the `findTermPositionsInTextForLocale` import for this legacy method.

- [ ] **Step 4: Add EN/general recognizer lookup and cache**

Still in `TBService.ts`, add:

```ts
  private findEnglishProfileMatches(
    projectId: number,
    segment: Segment,
    srcLang: string,
  ): TBMatch[] {
    const searchText = serializeTokensToSearchTextWithBoundaries(segment.sourceTokens);
    if (!searchText.text.trim()) return [];

    const recognizer = this.getEnglishRecognizer(projectId);
    const recognizerCandidates = this.toEnglishCandidates(
      recognizer.scan(searchText.text, {
        hardBoundaryOffsets: searchText.hardBoundaryOffsets,
      }),
    );

    const dbCandidates = this.db.searchProjectTermEntries(projectId, searchText.text, {
      srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as EnglishRecognizerEntry[];
    const dbRecognizer = buildEnglishTermRecognizer(dbCandidates);
    const dbRecognizedCandidates = this.toEnglishCandidates(
      dbRecognizer.scan(searchText.text, {
        hardBoundaryOffsets: searchText.hardBoundaryOffsets,
      }),
      'dbFallback',
    );

    return this.mergeEnglishCandidates([...recognizerCandidates, ...dbRecognizedCandidates]);
  }

  private getEnglishRecognizer(projectId: number): EnglishTermRecognizer<EnglishRecognizerEntry> {
    const mountedTbs = this.db.getProjectMountedTermBases(projectId);
    const key = this.buildEnglishRecognizerCacheKey(mountedTbs);
    const cached = this.englishRecognizerCache.get(projectId);
    if (cached?.key === key) return cached.recognizer;

    const entries = this.db.listProjectTermEntries(projectId) as EnglishRecognizerEntry[];
    const recognizer = buildEnglishTermRecognizer(entries);
    this.englishRecognizerCache.set(projectId, { key, recognizer });
    return recognizer;
  }

  private buildEnglishRecognizerCacheKey(mountedTbs: MountedTBRecord[]): string {
    return mountedTbs
      .map((tb) => `${tb.id}:${tb.priority}:${tb.updatedAt}`)
      .join('|');
  }
```

Add candidate conversion and merge helpers:

```ts
  private toEnglishCandidates(
    matches: Array<EnglishTermRecognizerMatch<EnglishRecognizerEntry>>,
    forcedTier?: EnglishCandidateTier,
  ): EnglishTBCandidate[] {
    const byEntry = new Map<string, EnglishTBCandidate>();

    for (const match of matches) {
      const tier =
        forcedTier ??
        (match.variantKind === 'canonical' ? 'recognizerCanonical' : 'recognizerVariant');
      const existing = byEntry.get(match.entry.id);
      if (existing) {
        existing.positions.push({ start: match.start, end: match.end });
        existing.tier = this.pickBetterEnglishTier(existing.tier, tier);
        continue;
      }

      byEntry.set(match.entry.id, {
        entry: match.entry,
        positions: [{ start: match.start, end: match.end }],
        tier,
        variantKind: match.variantKind,
      });
    }

    return Array.from(byEntry.values());
  }

  private mergeEnglishCandidates(candidates: EnglishTBCandidate[]): TBMatch[] {
    const bySrcNorm = new Map<string, EnglishTBCandidate>();

    for (const candidate of candidates.sort(this.compareEnglishCandidates)) {
      const existing = bySrcNorm.get(candidate.entry.srcNorm);
      if (!existing) {
        bySrcNorm.set(candidate.entry.srcNorm, candidate);
        continue;
      }

      existing.positions.push(...candidate.positions);
    }

    const matches = Array.from(bySrcNorm.values())
      .map((candidate) => ({
        ...candidate.entry,
        positions: this.uniquePositions(candidate.positions),
      }))
      .sort((a, b) => {
        const candidateA = bySrcNorm.get(a.srcNorm);
        const candidateB = bySrcNorm.get(b.srcNorm);
        if (candidateA && candidateB) {
          return this.compareEnglishCandidates(candidateA, candidateB);
        }
        return 0;
      });

    return suppressNestedTermMatches(matches);
  }

  private compareEnglishCandidates = (a: EnglishTBCandidate, b: EnglishTBCandidate): number => {
    const tierDiff = this.englishTierRank(a.tier) - this.englishTierRank(b.tier);
    if (tierDiff !== 0) return tierDiff;
    if (a.entry.priority !== b.entry.priority) return a.entry.priority - b.entry.priority;
    if (b.entry.srcTerm.length !== a.entry.srcTerm.length) {
      return b.entry.srcTerm.length - a.entry.srcTerm.length;
    }
    if (b.entry.usageCount !== a.entry.usageCount) return b.entry.usageCount - a.entry.usageCount;
    return a.entry.id.localeCompare(b.entry.id);
  };

  private pickBetterEnglishTier(
    current: EnglishCandidateTier,
    next: EnglishCandidateTier,
  ): EnglishCandidateTier {
    return this.englishTierRank(next) < this.englishTierRank(current) ? next : current;
  }

  private englishTierRank(tier: EnglishCandidateTier): number {
    switch (tier) {
      case 'recognizerCanonical':
        return 0;
      case 'recognizerVariant':
        return 1;
      case 'dbFallback':
        return 2;
    }
  }

  private uniquePositions(positions: Array<{ start: number; end: number }>) {
    const seen = new Set<string>();
    return positions.filter((position) => {
      const key = `${position.start}:${position.end}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
```

- [ ] **Step 5: Run localization tests and commit**

Run:

```powershell
npx vitest run packages\localization\src\modules\TBModule.test.ts
```

Expected after implementation: PASS.

Commit only Task 4 files:

```powershell
git add packages\localization\src\services\TBService.ts packages\localization\src\modules\TBModule.test.ts
git commit -m "feat: route en tb lookup through recognizer"
```

---

### Task 5: DB Fallback Profile Alignment

**Files:**
- Modify: `packages/db/src/repos/TBRepo.ts`
- Test: `packages/db/src/index.test.ts`

- [ ] **Step 1: Write failing DB fallback tests for non-CJK profile routing**

In `packages/db/src/index.test.ts`, add or update the TB search test that currently protects non-English single-fragment behavior so it expects non-CJK source projects to use EN/general fallback.

Use this test in the TB search describe block:

```ts
    it('uses EN/general single-fragment fallback for non-CJK source projects', () => {
      const projectId = db.createProject('TB Search French General Profile', 'fr-FR', 'en-US');
      const tbId = db.createTermBase('French General Profile TB', 'fr-FR', 'en-US');
      db.mountTermBaseToProject(projectId, tbId, 10);

      for (let index = 0; index < 20; index += 1) {
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `tb-french-general-noise-${index}`,
          tbId,
          srcLang: 'fr-FR',
          srcTerm: `Midnight Configuration Archive ${index}`,
          tgtTerm: `archive-${index}`,
        });
      }

      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-french-general-target',
        tbId,
        srcLang: 'fr-FR',
        srcTerm: 'Midnight Sun',
        tgtTerm: 'soleil de minuit',
      });

      const results = db.searchProjectTermEntries(projectId, 'The festival reveals the Midnight Sun.', {
        srcLang: 'fr-FR',
        limit: 10,
      });

      expect(results.map((row) => row.srcTerm)).toContain('Midnight Sun');
    });
```

Add this CJK guard test near the CJK TB tests:

```ts
    it('does not use EN/general single-word fallback for CJK source projects', () => {
      const projectId = db.createProject('TB Search CJK General Guard', 'zh-CN', 'fr-FR');
      const tbId = db.createTermBase('CJK General Guard TB', 'zh-CN', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'tb-cjk-general-guard-account',
        tbId,
        srcLang: 'zh-CN',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const results = db.searchProjectTermEntries(projectId, 'Accounts are synced.', {
        srcLang: 'zh-CN',
        limit: 10,
      });

      expect(results.map((row) => row.srcTerm)).not.toContain('account');
    });
```

- [ ] **Step 2: Run DB tests and verify the non-CJK fallback test fails before repo alignment**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts
```

Expected before implementation: FAIL if `fr-FR` still follows the old non-English repo path.

- [ ] **Step 3: Update TBRepo to use source profiles**

In `packages/db/src/repos/TBRepo.ts`, update the import:

```ts
import {
  buildTermSearchPlanForLocale,
  normalizeTermForLookup,
  resolveSourceRecallProfile,
} from '@cat/core/text';
```

Replace:

```ts
    const useEnglishSingleFragmentFallback = this.isEnglishSourceLocale(options?.srcLang);
```

with:

```ts
    const useEnglishSingleFragmentFallback =
      resolveSourceRecallProfile(options?.srcLang) === 'en';
```

Replace `shouldReserveFtsCandidates` with:

```ts
  private shouldReserveFtsCandidates(sourceText: string, srcLang?: string): boolean {
    if (!CJK_LIKE_RE.test(sourceText)) return false;
    if (!srcLang) return true;
    return resolveSourceRecallProfile(srcLang) === 'cjk';
  }
```

Delete the private `isEnglishSourceLocale` method.

- [ ] **Step 4: Run DB tests and commit**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts
```

Expected after implementation: PASS.

Commit only Task 5 files:

```powershell
git add packages\db\src\repos\TBRepo.ts packages\db\src\index.test.ts
git commit -m "feat: align tb fallback with source profiles"
```

---

### Task 6: Long-Source EN TB Regression Coverage

**Files:**
- Modify: `packages/localization/src/modules/TBModule.test.ts`

- [ ] **Step 1: Add long-source position regression tests**

Add this test in `packages/localization/src/modules/TBModule.test.ts` near the existing `The Day of Birth` test:

```ts
  it.each([10, 50, 120, 219])(
    'recalls EN/general TB terms at token position %s in long source segments',
    async (termPosition) => {
      const db = new CATDatabase(':memory:');
      try {
        const projectId = db.createProject('English Long Source TB Recall', 'en-US', 'fr-FR');
        const tbId = db.createTermBase('Long Source Terms', 'en-US', 'fr-FR');
        db.mountTermBaseToProject(projectId, tbId, 20);
        db.insertTBEntryIfAbsentBySrcTerm({
          id: `term-day-of-birth-${termPosition}`,
          tbId,
          srcLang: 'en-US',
          srcTerm: 'The Day of Birth',
          tgtTerm: 'Premier souffle',
        });

        const words = Array.from({ length: 230 }, (_, index) => `filler${index}`);
        words.splice(termPosition, 0, 'The', 'Day', 'of', 'Birth');
        const segment = createTransientSegment(
          {
            id: `unit-day-of-birth-${termPosition}`,
            source: words.join(' '),
          },
          0,
          {
            projectId,
            sourceLanguage: 'en-US',
            targetLanguage: 'fr-FR',
          },
        );
        const projectRepo = new SqliteProjectRepository(db);
        const tbRepo = new SqliteTBRepository(db);
        const module = new TBModule({
          tbRepo,
          tbService: new TBService(projectRepo, tbRepo),
        });

        const artifact = await module.inspect(projectId, segment);

        expect(artifact.rawMatches.map((match) => match.srcTerm)).toContain('The Day of Birth');
        expect(artifact.selectedReferences).toEqual(
          expect.arrayContaining([
            {
              srcTerm: 'The Day of Birth',
              tgtTerm: 'Premier souffle',
              note: null,
            },
          ]),
        );
      } finally {
        db.close();
      }
    },
  );
```

- [ ] **Step 2: Run the targeted localization tests**

Run:

```powershell
npx vitest run packages\localization\src\modules\TBModule.test.ts
```

Expected after Tasks 1-5: PASS.

- [ ] **Step 3: Commit long-source regression coverage**

Commit only Task 6 file:

```powershell
git add packages\localization\src\modules\TBModule.test.ts
git commit -m "test: cover long en tb term positions"
```

---

### Task 7: Full Verification and Cleanup

**Files:**
- No source file changes unless a verification command exposes a concrete failure.

- [ ] **Step 1: Run the related focused suites**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts packages\db\src\index.test.ts packages\localization\src\modules\TBModule.test.ts
```

Expected: PASS for all three files.

- [ ] **Step 2: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run whitespace check**

Run:

```powershell
git diff --check
```

Expected: no output.

- [ ] **Step 4: Inspect final diff for route isolation**

Run:

```powershell
git diff -- packages\core\src\text packages\localization\src\services\TBService.ts packages\db\src\repos\TBRepo.ts
```

Expected:

- CJK source projects still dispatch away from EN recognizer.
- CJK legacy TB logic remains in `findLegacyProfileMatches`.
- `TBRepo` uses `resolveSourceRecallProfile` instead of a local English-only locale check.
- No schema or migration files changed.

- [ ] **Step 5: Stop on verification failure**

If Step 1 or Step 2 fails, stop execution and report the failing command, the
first failing test name or TypeScript diagnostic, and the file named in that
diagnostic. Add a new task to this plan before changing code for that failure.

---

## Plan Self-Review

- Spec coverage:
  - Shared profile resolver: Task 1.
  - CJK TM/TB invariance: Tasks 1, 4, 5, and 7.
  - EN/general recognizer: Task 3.
  - Boundary-aware matching: Tasks 2 and 4.
  - EN TB service route and cache: Task 4.
  - DB fallback alignment: Task 5.
  - Long-source `The Day of Birth` regression: Task 6.
  - No schema migration: Task 7 diff inspection.
- Placeholder scan:
  - No unresolved markers and no unspecified test commands.
- Type consistency:
  - `SourceRecallProfile` uses `'cjk' | 'en'`.
  - `resolveTMTextProfile` continues returning `'default' | 'english'`.
  - `EnglishTermRecognizerEntry` matches the subset of `ProjectTBEntry` needed by `TBService`.
