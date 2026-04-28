# TM Concordance Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate standard TM similarity matches from concordance-derived local-overlap suggestions without losing current recall behavior.

**Architecture:** Keep the existing `findMatches()` API name and `TMMatch` compatibility name, but turn the result into a discriminated suggestion shape with `kind: 'tm' | 'concordance'`. Standard TM matches keep numeric `similarity`; concordance suggestions use `rank`, matched source metadata, and separate UI/prompt rendering.

**Tech Stack:** TypeScript, Electron main/renderer shared IPC types, Vitest, `@cat/core` AI prompt templates, SQLite-backed TM repository.

---

## File Structure

- Modify `apps/desktop/src/main/services/TMService.ts`: add discriminated match types, compute local overlap metadata, classify overlap-only results as concordance.
- Modify `apps/desktop/src/shared/ipc.ts`: expose the same discriminated TM match shape to preload/renderer consumers.
- Modify `packages/core/src/project/aiPromptTypes.ts`: add `PromptConcordanceReference` and prompt params.
- Modify `packages/core/src/project/prompts/translation.md`: add translation prompt concordance templates.
- Modify `packages/core/src/project/prompts/dialogue.md`: add dialogue prompt concordance templates.
- Regenerate `packages/core/src/project/aiPromptTemplateCatalog.generated.ts`.
- Modify `packages/core/src/project/aiPromptTemplates.ts`: render concordance references separately from TM references.
- Modify `apps/desktop/src/main/services/modules/ai/types.ts`: carry concordance references through desktop AI workflows.
- Modify `apps/desktop/src/main/services/modules/ai/promptReferences.ts`: split `tmService.findMatches()` into TM references and concordance references.
- Modify `apps/desktop/src/renderer/src/components/TMPanel.tsx`: display concordance rows with a non-percentage badge.
- Modify tests:
  - `apps/desktop/src/main/services/TMService.test.ts`
  - `apps/desktop/src/main/services/modules/AIModule.test.ts`
  - `packages/core/src/project/index.test.ts`
  - `apps/desktop/src/renderer/src/components/TMPanel.test.ts`

## Task 1: Classify TM Matches in `TMService`

**Files:**
- Modify: `apps/desktop/src/main/services/TMService.ts`
- Test: `apps/desktop/src/main/services/TMService.test.ts`
- Modify: `apps/desktop/src/shared/ipc.ts`

- [ ] **Step 1: Update shared IPC TM match type**

In `apps/desktop/src/shared/ipc.ts`, replace the current `TMMatch` interface with this discriminated shape:

```ts
export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: TMType;
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;
```

- [ ] **Step 2: Add the same type model to `TMService.ts`**

At the top of `apps/desktop/src/main/services/TMService.ts`, replace the current `TMMatch` interface with:

```ts
export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;

interface LocalOverlapResult {
  score: number;
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}
```

- [ ] **Step 3: Write failing tests for concordance classification**

Add these tests to `apps/desktop/src/main/services/TMService.test.ts` inside `describe('TMService.findMatches', ...)`:

```ts
it('classifies short source inside a longer TM source as concordance instead of percentage TM', async () => {
  const service = createService({
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    concordanceEntries: [
      createConcordanceEntry('tm-main', {
        srcHash: 'wheat-farm-context',
        sourceText:
          '据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。',
        targetText:
          'On dit que le nom "Ferme des vagues de ble" rend hommage a une oeuvre peinte ici.',
      }),
    ],
  });

  const matches = await service.findMatches(1, createSegment('麦浪农场', 'source-hash'));

  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    kind: 'concordance',
    rank: expect.any(Number),
    matchedSourceText: '麦浪农场',
    sourceCoverage: 100,
    tmName: 'Main TM',
  });
  expect(matches[0]).not.toHaveProperty('similarity');
  expect(matches[0].entryCoverage).toBeLessThan(50);
});

it('keeps whole-segment fuzzy candidates as TM matches when weighted similarity qualifies', async () => {
  const source = 'Translation memory scoring example';
  const service = createService({
    mountedTMs: [{ id: 'tm-main', name: 'Main TM', type: 'main' }],
    concordanceEntries: [
      createConcordanceEntry('tm-main', {
        srcHash: 'fuzzy-almost-exact',
        sourceText: 'Translation memory scoring examplex',
        usageCount: 3,
      }),
    ],
  });

  const matches = await service.findMatches(1, createSegment(source, 'source-hash'));

  expect(matches).toHaveLength(1);
  expect(matches[0]).toMatchObject({
    kind: 'tm',
    similarity: 99,
    rank: 99,
  });
});
```

- [ ] **Step 4: Run the focused TM service tests and verify failure**

Run:

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: FAIL because returned matches do not yet include `kind`, `rank`, or concordance metadata.

- [ ] **Step 5: Implement exact and tag-variant standard TM result shapes**

In `TMService.findMatches()`, update the exact hash push block to:

```ts
results.push({
  ...match,
  kind: 'tm',
  similarity: 100,
  rank: 100,
  tmName: tm.name,
  tmType: tm.type,
});
```

Update the same-normalized-text branch so it assigns a standard TM result later with:

```ts
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
```

- [ ] **Step 6: Implement concordance classification**

Replace the old `if (similarity >= TMService.MIN_SIMILARITY)` result push with:

```ts
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
```

- [ ] **Step 7: Return local overlap metadata instead of a bare score**

Replace `computeLocalOverlapSimilarity()` in `TMService.ts` with:

```ts
private computeLocalOverlapSimilarity(a: string, b: string): LocalOverlapResult {
  const longest = this.findLongestCommonSubstring(a, b);
  const overlapLength = Array.from(longest).length;
  if (overlapLength < 2) {
    return { score: 0, matchedSourceText: '', sourceCoverage: 0, entryCoverage: 0 };
  }

  const aLength = Array.from(a).length;
  const bLength = Array.from(b).length;
  const shorterLength = Math.min(aLength, bLength);
  const longerLength = Math.max(aLength, bLength);
  if (shorterLength === 0 || longerLength === 0) {
    return { score: 0, matchedSourceText: '', sourceCoverage: 0, entryCoverage: 0 };
  }

  const shorterCoverage = overlapLength / shorterLength;
  const longerCoverage = overlapLength / longerLength;
  let score = Math.round(shorterCoverage * 70 + longerCoverage * 30);
  const hasSharedComponent = this.hasSharedCjkComponent(a, b);

  if (!hasSharedComponent && longerCoverage < 0.45) {
    score = Math.min(score, TMService.MIN_SIMILARITY - 1);
  }

  if (hasSharedComponent) {
    score = Math.max(score, 50);
  }

  return {
    score: Math.min(99, score),
    matchedSourceText: longest,
    sourceCoverage: Math.round((overlapLength / aLength) * 100),
    entryCoverage: Math.round((overlapLength / bLength) * 100),
  };
}
```

- [ ] **Step 8: Sort by rank instead of similarity**

Replace the sort block in `TMService.findMatches()` with:

```ts
return results
  .sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    return b.usageCount - a.usageCount;
  })
  .slice(0, TMService.TM_MATCH_RESULT_LIMIT);
```

- [ ] **Step 9: Run the focused TM service tests and verify pass**

Run:

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit Task 1**

Run:

```bash
git add apps/desktop/src/main/services/TMService.ts apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/shared/ipc.ts
git commit -m "feat: classify tm concordance suggestions"
```

## Task 2: Add Concordance Prompt Types and Templates

**Files:**
- Modify: `packages/core/src/project/aiPromptTypes.ts`
- Modify: `packages/core/src/project/prompts/translation.md`
- Modify: `packages/core/src/project/prompts/dialogue.md`
- Modify: `packages/core/src/project/aiPromptTemplates.ts`
- Generate: `packages/core/src/project/aiPromptTemplateCatalog.generated.ts`
- Test: `packages/core/src/project/index.test.ts`

- [ ] **Step 1: Add core prompt reference types**

In `packages/core/src/project/aiPromptTypes.ts`, add after `PromptTMReference`:

```ts
export interface PromptConcordanceReference {
  tmName: string;
  matchedSourceText: string;
  sourceText: string;
  targetText: string;
}
```

Then add `concordanceReferences?: PromptConcordanceReference[];` to `UserPromptBuildParams`, `TextPromptBundleBuildParams`, and `DialoguePromptSegment`.

- [ ] **Step 2: Add translation prompt template sections**

In `packages/core/src/project/prompts/translation.md`, add these sections after `tm-entry-target`:

````md
## concordance-header

```text
Concordance Suggestions:
```

## concordance-entry-summary

```text
- Match: {{matchedSourceText}} | TM: {{tmName}}
```

## concordance-entry-source

```text
- TM Source: {{sourceText}}
```

## concordance-entry-target

```text
- TM Target: {{targetText}}
```
````

- [ ] **Step 3: Add dialogue prompt template sections**

In `packages/core/src/project/prompts/dialogue.md`, add these sections after `tm-entry-target`:

````md
## concordance-header

```text
   Concordance Suggestions:
```

## concordance-entry-summary

```text
   - Match: {{matchedSourceText}} | TM: {{tmName}}
```

## concordance-entry-source

```text
   - TM Source: {{sourceText}}
```

## concordance-entry-target

```text
   - TM Target: {{targetText}}
```
````

- [ ] **Step 4: Render translation concordance references**

In `packages/core/src/project/aiPromptTemplates.ts`, inside `buildTranslationUserPrompt()`, insert this block after the TM reference rendering block and before TB references:

```ts
if (params.concordanceReferences && params.concordanceReferences.length > 0) {
  userParts.push("", TRANSLATION_PROMPTS.concordanceHeader);
  for (const reference of params.concordanceReferences) {
    userParts.push(
      renderTemplate(TRANSLATION_PROMPTS.concordanceEntrySummary, {
        matchedSourceText: reference.matchedSourceText,
        tmName: reference.tmName,
      }),
      renderTemplate(TRANSLATION_PROMPTS.concordanceEntrySource, {
        sourceText: reference.sourceText,
      }),
      renderTemplate(TRANSLATION_PROMPTS.concordanceEntryTarget, {
        targetText: reference.targetText,
      }),
    );
  }
}
```

- [ ] **Step 5: Render dialogue concordance references**

In `packages/core/src/project/aiPromptTemplates.ts`, inside the dialogue segment loop, insert this block after the segment TM reference rendering block and before TB references:

```ts
if (segment.concordanceReferences && segment.concordanceReferences.length > 0) {
  userParts.push(DIALOGUE_PROMPTS.concordanceHeader);
  for (const reference of segment.concordanceReferences) {
    userParts.push(
      renderTemplate(DIALOGUE_PROMPTS.concordanceEntrySummary, {
        matchedSourceText: reference.matchedSourceText,
        tmName: reference.tmName,
      }),
      renderTemplate(DIALOGUE_PROMPTS.concordanceEntrySource, {
        sourceText: reference.sourceText,
      }),
      renderTemplate(DIALOGUE_PROMPTS.concordanceEntryTarget, {
        targetText: reference.targetText,
      }),
    );
  }
}
```

- [ ] **Step 6: Generate prompt catalog**

Run:

```bash
node scripts/generate-ai-prompt-templates.mjs
```

Expected: `packages/core/src/project/aiPromptTemplateCatalog.generated.ts` updates with `concordanceHeader`, `concordanceEntrySummary`, `concordanceEntrySource`, and `concordanceEntryTarget` for translation and dialogue.

- [ ] **Step 7: Add core prompt tests**

In `packages/core/src/project/index.test.ts`, add one translation prompt test near the existing TM reference tests:

```ts
it("renders concordance suggestions separately from TM similarity references", () => {
  const prompt = buildAITextPromptBundle("translation", {
    srcLang: "zh-CN",
    tgtLang: "fr-FR",
    sourceText: "麦浪农场",
    concordanceReferences: [
      {
        tmName: "Main TM",
        matchedSourceText: "麦浪农场",
        sourceText:
          "据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。",
        targetText:
          'On dit que le nom "Ferme des vagues de ble" rend hommage a une oeuvre peinte ici.',
      },
    ],
  });

  expect(prompt.userPrompt).toContain("Concordance Suggestions:");
  expect(prompt.userPrompt).toContain("Match: 麦浪农场 | TM: Main TM");
  expect(prompt.userPrompt).not.toContain("Similarity: 73%");
});
```

- [ ] **Step 8: Run core prompt tests**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts packages/core/src/project/aiPromptTemplateCatalog.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add packages/core/src/project/aiPromptTypes.ts packages/core/src/project/prompts/translation.md packages/core/src/project/prompts/dialogue.md packages/core/src/project/aiPromptTemplates.ts packages/core/src/project/aiPromptTemplateCatalog.generated.ts packages/core/src/project/index.test.ts
git commit -m "feat: render concordance prompt references"
```

## Task 3: Split AI Prompt References in Desktop Main

**Files:**
- Modify: `apps/desktop/src/main/services/modules/ai/types.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/promptReferences.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`
- Test: `apps/desktop/src/main/services/modules/AIModule.test.ts`

- [ ] **Step 1: Carry concordance references through desktop AI types**

In `apps/desktop/src/main/services/modules/ai/types.ts`, import `PromptConcordanceReference` and add it to `TranslationPromptReferences`:

```ts
import type {
  DialoguePromptPreviousGroup,
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
} from '@cat/core/project';
```

```ts
export interface TranslationPromptReferences {
  tmReference?: PromptTMReference;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
}
```

- [ ] **Step 2: Split matches in `promptReferences.ts`**

In `apps/desktop/src/main/services/modules/ai/promptReferences.ts`, add:

```ts
const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;
```

Then replace the current TM mapping block with:

```ts
const tmMatches = await params.resolvers.tmService.findMatches(
  params.projectId,
  params.segment,
);
const standardTmMatches = tmMatches.filter((match) => match.kind === 'tm');
const concordanceMatches = tmMatches.filter((match) => match.kind === 'concordance');

if (standardTmMatches.length > 0) {
  references.tmReferences = standardTmMatches
    .slice(0, MAX_TM_PROMPT_REFERENCES)
    .map((match) => ({
      similarity: match.similarity,
      tmName: match.tmName,
      sourceText: serializeTokensToDisplayText(match.sourceTokens),
      targetText: serializeTokensToDisplayText(match.targetTokens),
    }));
  references.tmReference = references.tmReferences[0];
}

if (concordanceMatches.length > 0) {
  references.concordanceReferences = concordanceMatches
    .slice(0, MAX_CONCORDANCE_PROMPT_REFERENCES)
    .map((match) => ({
      tmName: match.tmName,
      matchedSourceText: match.matchedSourceText,
      sourceText: serializeTokensToDisplayText(match.sourceTokens),
      targetText: serializeTokensToDisplayText(match.targetTokens),
    }));
}
```

- [ ] **Step 3: Pass concordance references through workflows**

Where the existing workflows pass `tmReference`, `tmReferences`, and `tbReferences`, add:

```ts
concordanceReferences: promptReferences.concordanceReferences,
```

Apply this in:

- `apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts`
- `apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts`
- `apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts`

In `dialogueTranslation.ts`, add the field to each `promptSegments.push({ ... })` object:

```ts
concordanceReferences: references.concordanceReferences,
```

- [ ] **Step 4: Add translator params**

In `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`, add `concordanceReferences?: PromptConcordanceReference[];` to the translate param interfaces and pass it to `buildAITextPromptBundle()` alongside `tmReferences`.

The bundle call should include:

```ts
concordanceReferences: params.concordanceReferences,
```

- [ ] **Step 5: Add AIModule coverage**

In `apps/desktop/src/main/services/modules/AIModule.test.ts`, update a prompt reference test or add a focused test with a fake TM service returning:

```ts
{
  id: 'concordance-1',
  projectId: 1,
  srcLang: 'zh-CN',
  tgtLang: 'fr-FR',
  srcHash: 'context-hash',
  matchKey: 'context',
  tagsSignature: '',
  sourceTokens: [
    {
      type: 'text',
      content:
        '据说，叫“麦浪农场”这个名字，是为了纪念一位艺术家在这里画下名作《麦与浪》。',
    },
  ],
  targetTokens: [{ type: 'text', content: 'Contexte cible' }],
  usageCount: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  kind: 'concordance',
  rank: 73,
  tmName: 'Main TM',
  tmType: 'main',
  matchedSourceText: '麦浪农场',
  sourceCoverage: 100,
  entryCoverage: 10,
}
```

Assert the captured prompt contains `Concordance Suggestions:` and does not contain `Similarity: 73%`.

- [ ] **Step 6: Run AI module tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add apps/desktop/src/main/services/modules/ai/types.ts apps/desktop/src/main/services/modules/ai/promptReferences.ts apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts apps/desktop/src/main/services/modules/ai/AITextTranslator.ts apps/desktop/src/main/services/modules/AIModule.test.ts
git commit -m "feat: split ai concordance references"
```

## Task 4: Display Concordance Suggestions Without Percentages

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/TMPanel.tsx`
- Test: `apps/desktop/src/renderer/src/components/TMPanel.test.ts`

- [ ] **Step 1: Update renderer match type**

In `apps/desktop/src/renderer/src/components/TMPanel.tsx`, replace the local `TMMatch` interface with the same discriminated union:

```ts
export type TMMatchKind = 'tm' | 'concordance';

export interface TMMatchBase extends TMEntry {
  kind: TMMatchKind;
  rank: number;
  tmName: string;
  tmType: 'working' | 'main';
}

export interface StandardTMMatch extends TMMatchBase {
  kind: 'tm';
  similarity: number;
}

export interface ConcordanceTMMatch extends TMMatchBase {
  kind: 'concordance';
  matchedSourceText: string;
  sourceCoverage: number;
  entryCoverage: number;
}

export type TMMatch = StandardTMMatch | ConcordanceTMMatch;
```

- [ ] **Step 2: Sort combined matches by rank**

In `buildCombinedMatches()`, change the TM item rank assignment to:

```ts
rank: match.rank,
```

- [ ] **Step 3: Render a concordance badge**

In `TMPanel.tsx`, replace the TM label and score variables with:

```ts
const tmLabel = isTM
  ? tmMatch!.kind === 'concordance'
    ? `Concordance: ${tmMatch!.tmName}`
    : tmMatch!.tmType === 'working'
      ? 'Working TM'
      : `Main TM: ${tmMatch!.tmName}`
  : `Term Base: ${tbMatch!.tbName}`;
const scoreBg = isTM
  ? tmMatch!.kind === 'concordance'
    ? 'bg-warning'
    : tmMatch!.similarity >= 95
      ? 'bg-success'
      : tmMatch!.similarity >= 85
        ? 'bg-brand'
        : 'bg-warning'
  : 'bg-warning';
const scoreText = isTM ? (tmMatch!.kind === 'concordance' ? 'C' : String(tmMatch!.similarity)) : 'TB';
```

Keep double-click behavior unchanged for this iteration.

- [ ] **Step 4: Add renderer tests**

In `apps/desktop/src/renderer/src/components/TMPanel.test.ts`, update `createTMMatch()` to return a standard match:

```ts
function createTMMatch(index: number, similarity: number): TMMatch {
  const now = new Date().toISOString();
  return {
    id: `tm-${index}`,
    projectId: 1,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: `hash-${index}`,
    matchKey: `key-${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `source-${index}` }],
    targetTokens: [{ type: 'text', content: `target-${index}` }],
    usageCount: index + 1,
    createdAt: now,
    updatedAt: now,
    kind: 'tm',
    rank: similarity,
    similarity,
    tmName: 'Main TM',
    tmType: 'main',
  };
}
```

Add a helper:

```ts
function createConcordanceMatch(index: number, rank: number): TMMatch {
  const now = new Date().toISOString();
  return {
    id: `concordance-${index}`,
    projectId: 1,
    srcLang: 'zh-CN',
    tgtLang: 'fr-FR',
    srcHash: `concordance-hash-${index}`,
    matchKey: `concordance-key-${index}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text', content: `context-source-${index}` }],
    targetTokens: [{ type: 'text', content: `context-target-${index}` }],
    usageCount: index + 1,
    createdAt: now,
    updatedAt: now,
    kind: 'concordance',
    rank,
    tmName: 'Main TM',
    tmType: 'main',
    matchedSourceText: '麦浪农场',
    sourceCoverage: 100,
    entryCoverage: 10,
  };
}
```

Add this test:

```ts
it('sorts concordance suggestions by rank without requiring similarity', () => {
  const matches = [createTMMatch(1, 80), createConcordanceMatch(2, 90)];
  const combined = buildCombinedMatches(matches, [], 5);

  expect(combined[0].payload).toMatchObject({
    kind: 'concordance',
    rank: 90,
  });
  expect(combined[0].payload).not.toHaveProperty('similarity');
});
```

- [ ] **Step 5: Run renderer component tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/components/TMPanel.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 4**

Run:

```bash
git add apps/desktop/src/renderer/src/components/TMPanel.tsx apps/desktop/src/renderer/src/components/TMPanel.test.ts
git commit -m "feat: display tm concordance suggestions"
```

## Task 5: Typecheck and Full Targeted Verification

**Files:**
- No source files should be edited in this task unless verification reveals a concrete compile or test failure.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/modules/AIModule.test.ts packages/core/src/project/index.test.ts packages/core/src/project/aiPromptTemplateCatalog.test.ts apps/desktop/src/renderer/src/components/TMPanel.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run prompt catalog check**

Run:

```bash
node scripts/generate-ai-prompt-templates.mjs --check
```

Expected: PASS with `[ai-prompt-templates] Generated catalog is up to date.`

- [ ] **Step 4: Commit any verification fixes**

If Step 1, 2, or 3 required fixes, commit them:

```bash
git add apps packages
git commit -m "fix: complete tm concordance semantics migration"
```

If no fixes were needed, do not create an empty commit.
