# English TM Concordance Phrase Lane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an English-only phrase-first concordance recall lane so short named TM entries such as `Heartbeat Zone` are recalled from long English source segments without changing CJK/default behavior.

**Architecture:** Keep `TMService.findMatches` and final scoring semantics stable. Add a focused English phrase extractor in `@cat/core/text`, thread its bounded phrase anchors into `TMRepo.searchTMConcordanceRecallCandidates` only when `profile === "english"`, and reuse the existing English evidence gate before a row becomes a concordance candidate.

**Tech Stack:** TypeScript, Vitest, SQLite/better-sqlite3 FTS5, `@cat/core/text`, `@cat/db`, `@cat/localization`, existing active TM flow trace tests.

---

## Preflight

- The current working tree may already contain unrelated unstaged changes in TM import and TM repository files. Before executing this plan, use an isolated worktree or explicitly inspect and preserve those changes.
- Do not modify TMTB renderer code.
- Do not change schema, import-time indexing, broad raw limits, final result caps, CJK thresholds, or CJK fragment generation.

## File Structure

- Modify `packages/core/src/text/tmMatchingProfiles.ts`
  - Owns English phrase extraction and keeps it independent from DB/service code.
  - Exports `buildEnglishTMConcordancePhraseTerms`.

- Modify `packages/core/src/text/index.ts`
  - Re-exports the new helper and result type.

- Modify `packages/core/src/text/index.test.ts`
  - Adds focused phrase extraction and evidence tests.

- Modify `packages/db/src/repos/TMRepo.ts`
  - Adds English phrase fields to `TMConcordanceRecallQueryPlan`.
  - Adds exact phrase and phrase FTS collection before broad token FTS.
  - Keeps non-English plans empty for phrase fields.

- Modify `packages/db/src/index.test.ts`
  - Adds a repository-level regression proving English phrase exact/FTS tier works under a tight raw limit.
  - Keeps existing CJK concordance tests unchanged.

- Modify `apps/desktop/src/main/services/TMMatchFlow.test.ts`
  - Adds active TM flow coverage for the `Heartbeat Zone` case and confirms the candidate becomes `fromConcordance=true`.

- Use `docs/superpowers/specs/2026-06-16-english-tm-concordance-phrase-lane-design.md`
  - Reference only; do not edit unless implementation reveals a spec mismatch.

---

### Task 1: Add Core English Phrase Extraction

**Files:**
- Modify: `packages/core/src/text/tmMatchingProfiles.ts`
- Modify: `packages/core/src/text/index.ts`
- Test: `packages/core/src/text/index.test.ts`

- [ ] **Step 1: Add failing phrase extraction tests**

Update the import block in `packages/core/src/text/index.test.ts` to include the new helper:

```ts
  buildEnglishTMConcordancePhraseTerms,
```

Append these tests inside the existing `describe('TM Matching Profiles', () => { ... })` block:

```ts
  const HEARTBEAT_ZONE_LONG_SOURCE =
    'Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power. If Drifting Power runs out, the bubble will automatically pop. When Drifting Power is full, movement speed increases for a certain time, and moving during this period will not consume Drifting Power. After the acceleration ends, a certain amount of Drifting Power will be deducted.|Four different Music Bubbles float within the Heartbeat Zone: Heartstring Bubbles increase Drifting Power and Heartstrings; Speed Bubbles allow Nikki dash forward quickly for a short distance and grant a small amount of Drifting Power and Heartstrings; Fish Bubbles spit out many Heartstring Bubbles, which can be collected to gain extra Heartstrings; Spike Bubbles stop Nikki in place for a short time and reduce Drifting Power.|Heartstrings can also be obtained by playing with the Bom-Bom Bubble Machine in the Rest Zone or sitting in viewing chairs to enjoy the meteors. Besides the activities that grant Heartstrings, the stage lights can also be controlled to reveal dazzling changes of light and shadow.';

  it('builds bounded English TM concordance phrase terms from named phrases', () => {
    const terms = buildEnglishTMConcordancePhraseTerms(HEARTBEAT_ZONE_LONG_SOURCE);

    expect(terms.exactPhrases).toEqual(
      expect.arrayContaining([
        'Heartbeat Zone',
        'Drifting Power',
        'Music Bubbles',
        'Heartstring Bubbles',
        'Speed Bubbles',
        'Fish Bubbles',
        'Spike Bubbles',
        'Rest Zone',
      ]),
    );
    expect(terms.ftsPhrases).toEqual(
      expect.arrayContaining([
        'heartbeat zone',
        'drifting power',
        'music bubbles',
        'heartstring bubbles',
        'speed bubbles',
        'fish bubbles',
        'spike bubbles',
        'rest zone',
      ]),
    );
    expect(terms.exactPhrases).not.toContain('Zone');
    expect(terms.ftsPhrases).not.toContain('zone');
    expect(terms.exactPhrases.length).toBeLessThanOrEqual(24);
    expect(terms.ftsPhrases.length).toBeLessThanOrEqual(48);
  });

  it('keeps English concordance phrase extraction conservative', () => {
    expect(buildEnglishTMConcordancePhraseTerms('menu settings are open')).toEqual({
      exactPhrases: [],
      ftsPhrases: [],
    });

    expect(
      buildEnglishTMConcordancePhraseTerms('Open Menu Settings can be changed.').ftsPhrases,
    ).toEqual(expect.arrayContaining(['open menu settings']));

    expect(
      buildEnglishTMConcordancePhraseTerms('After Nikki enters, Drifting Power fills.').ftsPhrases,
    ).toEqual(expect.arrayContaining(['drifting power']));
    expect(
      buildEnglishTMConcordancePhraseTerms('After Nikki enters, Drifting Power fills.').ftsPhrases,
    ).not.toEqual(expect.arrayContaining(['after nikki']));
  });
```

- [ ] **Step 2: Run the focused core tests and confirm they fail**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts -t "TM Matching Profiles"
```

Expected: FAIL because `buildEnglishTMConcordancePhraseTerms` is not exported.

- [ ] **Step 3: Implement the phrase extraction helper**

In `packages/core/src/text/tmMatchingProfiles.ts`, add these constants after `ENGLISH_STOPWORDS` is declared:

```ts
const MAX_ENGLISH_TM_CONCORDANCE_EXACT_PHRASES = 24;
const MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES = 48;
const ENGLISH_PHRASE_BOUNDARY_STOPWORDS = new Set([
  ...ENGLISH_STOPWORDS,
  'after',
  'before',
  'besides',
  'during',
  'if',
  'inside',
  'into',
  'near',
  'once',
  'outside',
  'over',
  'then',
  'through',
  'under',
  'when',
  'while',
  'within',
]);
```

Add this exported type and helper after `buildEnglishTMRecallTerms`:

```ts
export interface EnglishTMConcordancePhraseTerms {
  exactPhrases: string[];
  ftsPhrases: string[];
}

export function buildEnglishTMConcordancePhraseTerms(
  text: string,
): EnglishTMConcordancePhraseTerms {
  const exactPhrases: string[] = [];
  const ftsPhrases: string[] = [];
  const seenExact = new Set<string>();
  const seenFts = new Set<string>();
  const segments = text.normalize('NFKC').split(/[.!?:;|\r\n]+/u);

  for (const segment of segments) {
    const rawTokens = Array.from(segment.matchAll(WORD_RE)).map((match) => match[0]);

    for (let windowSize = 2; windowSize <= 4; windowSize += 1) {
      for (let index = 0; index <= rawTokens.length - windowSize; index += 1) {
        const slice = rawTokens.slice(index, index + windowSize);
        if (!slice.every(isCapitalizedWord)) continue;
        if (!slice.every((token) => isSignificantEnglishToken(token.toLowerCase()))) continue;

        const exactPhrase = slice.join(' ');
        if (!hasNamedEnglishPhraseShape(exactPhrase)) continue;

        const canonical = normalizeTextForTMSimilarity(exactPhrase, 'english');
        const canonicalTokens = canonical.split(/\s+/).filter(Boolean);
        if (canonicalTokens.length < 2 || canonicalTokens.length > 4) continue;

        const first = canonicalTokens[0];
        const last = canonicalTokens[canonicalTokens.length - 1];
        if (
          ENGLISH_PHRASE_BOUNDARY_STOPWORDS.has(first) ||
          ENGLISH_PHRASE_BOUNDARY_STOPWORDS.has(last)
        ) {
          continue;
        }

        addBoundedCaseSensitiveTerm(
          exactPhrases,
          seenExact,
          exactPhrase,
          MAX_ENGLISH_TM_CONCORDANCE_EXACT_PHRASES,
        );

        addBoundedLowercaseTerm(
          ftsPhrases,
          seenFts,
          exactPhrase,
          MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES,
        );
        addBoundedLowercaseTerm(
          ftsPhrases,
          seenFts,
          canonical,
          MAX_ENGLISH_TM_CONCORDANCE_FTS_PHRASES,
        );
      }
    }
  }

  return { exactPhrases, ftsPhrases };
}
```

Add these private helpers near `addRecallTerm`:

```ts
function addBoundedCaseSensitiveTerm(
  target: string[],
  seen: Set<string>,
  value: string,
  limit: number,
): void {
  const term = value.trim();
  if (!term || target.length >= limit || seen.has(term)) return;
  seen.add(term);
  target.push(term);
}

function addBoundedLowercaseTerm(
  target: string[],
  seen: Set<string>,
  value: string,
  limit: number,
): void {
  const term = value.trim().toLowerCase();
  if (!term || target.length >= limit || seen.has(term)) return;
  seen.add(term);
  target.push(term);
}
```

- [ ] **Step 4: Export the helper**

In `packages/core/src/text/index.ts`, add these exports to the `./tmMatchingProfiles` export block:

```ts
  buildEnglishTMConcordancePhraseTerms,
  type EnglishTMConcordancePhraseTerms,
```

- [ ] **Step 5: Run the focused core tests and confirm they pass**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts -t "TM Matching Profiles"
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

Run:

```powershell
git add packages\core\src\text\tmMatchingProfiles.ts packages\core\src\text\index.ts packages\core\src\text\index.test.ts
git commit -m "feat: extract english tm concordance phrases"
```

---

### Task 2: Add Phrase-First Concordance Recall In TMRepo

**Files:**
- Modify: `packages/db/src/repos/TMRepo.ts`
- Test: `packages/db/src/index.test.ts`

- [ ] **Step 1: Add a failing repository regression test**

In `packages/db/src/index.test.ts`, add this test near the existing active concordance recall tests:

```ts
    it("should recall English exact phrase concordance before broad token noise", () => {
      const projectId = db.createProject("English Phrase Concordance", "en-US", "fr-FR");
      const mainTmId = db.createTM("Main English Phrase Concordance", "en-US", "fr", "main");
      db.mountTMToProject(projectId, mainTmId, 10, "read");

      const source =
        "Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power.";

      db.upsertTMEntry({
        id: "heartbeat-zone-entry",
        tmId: mainTmId,
        srcHash: "heartbeat-zone",
        matchKey: "heartbeat zone",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "Heartbeat Zone" }],
        targetTokens: [{ type: "text", content: "Zone des battements" }],
        usageCount: 3,
      } as any);

      for (let index = 0; index < 8; index += 1) {
        const noisySource = `Gravity Heartbeat Nikki Zone Floating Bubbles Drifting Power ${index}`;
        db.upsertTMEntry({
          id: `english-noise-${index}`,
          tmId: mainTmId,
          srcHash: `english-noise-${index}`,
          matchKey: noisySource.toLowerCase(),
          tagsSignature: "",
          sourceTokens: [{ type: "text", content: noisySource }],
          targetTokens: [{ type: "text", content: `bruit ${index}` }],
          usageCount: 100 + index,
        } as any);
      }

      const defaultResults = db.searchTMConcordanceRecallCandidates(
        projectId,
        source,
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 1 },
      );
      expect(defaultResults.map((row) => row.srcHash)).not.toContain("heartbeat-zone");

      const englishResults = db.searchTMConcordanceRecallCandidates(
        projectId,
        source,
        [mainTmId],
        { scope: "source", limit: 50, rawLimit: 1, profile: "english" },
      );

      expect(englishResults.map((row) => row.srcHash)).toContain("heartbeat-zone");
    });
```

- [ ] **Step 2: Run the focused DB test and confirm it fails**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts -t "English exact phrase concordance"
```

Expected: FAIL because English concordance recall does not yet add phrase exact terms.

- [ ] **Step 3: Import the new helper in TMRepo**

In `packages/db/src/repos/TMRepo.ts`, change the text helper import to:

```ts
import {
  buildEnglishTMConcordancePhraseTerms,
  buildEnglishTMRecallTerms,
  hasEnglishTMConcordanceEvidence,
} from '@cat/core/text';
```

- [ ] **Step 4: Extend `TMConcordanceRecallQueryPlan`**

In `packages/db/src/repos/TMRepo.ts`, extend the interface:

```ts
interface TMConcordanceRecallQueryPlan {
  cjk4Fragments: string[];
  cjk3Fragments: string[];
  longCjkFragments: string[];
  latinTerms: string[];
  shortCjkTerms: string[];
  englishTerms: string[];
  englishExactPhrases: string[];
  englishPhraseTerms: string[];
}
```

- [ ] **Step 5: Populate phrase fields in `buildTMConcordanceRecallQueryPlan`**

Inside `buildTMConcordanceRecallQueryPlan`, replace the current `englishTerms` declaration with:

```ts
    const englishTerms =
      profile === 'english'
        ? this.selectSpreadFragments(buildEnglishTMRecallTerms(queryText), 32)
        : [];
    const englishPhraseTerms =
      profile === 'english'
        ? buildEnglishTMConcordancePhraseTerms(queryText)
        : { exactPhrases: [], ftsPhrases: [] };
```

Then add these fields to the returned object:

```ts
      englishExactPhrases: englishPhraseTerms.exactPhrases,
      englishPhraseTerms: englishPhraseTerms.ftsPhrases,
```

- [ ] **Step 6: Include English exact phrases in the exact source tier**

In `collectConcordanceExactSourceTier`, extend the `terms` construction:

```ts
    const terms = this.uniqueTerms([
      ...params.plan.shortCjkTerms,
      ...params.plan.cjk3Fragments,
      ...params.plan.cjk4Fragments,
      ...params.plan.longCjkFragments,
      ...params.plan.englishExactPhrases,
    ]).filter((term) => term.length >= 2);
```

- [ ] **Step 7: Run phrase FTS before broad token FTS**

In `collectConcordanceRecallRows`, insert this block after `collectConcordanceExactSourceTier` and before the `for` loop over `tiers`:

```ts
    if (
      params.profile === 'english' &&
      accepted.length < params.maxResults &&
      params.stats.rawRows < params.rawLimit
    ) {
      this.collectConcordanceFtsBatchTier({
        ...params,
        terms: params.plan.englishPhraseTerms,
        accepted,
        seenIds,
      });
    }
```

Keep the existing `tiers` array unchanged:

```ts
    const tiers = [
      [...params.plan.cjk4Fragments, ...params.plan.latinTerms, ...params.plan.englishTerms],
      params.plan.longCjkFragments,
      params.plan.cjk3Fragments,
    ];
```

- [ ] **Step 8: Run the focused DB test and confirm it passes**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts -t "English exact phrase concordance"
```

Expected: PASS.

- [ ] **Step 9: Run existing CJK concordance DB tests**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts -t "active concordance"
```

Expected: PASS. Existing CJK active concordance tests should remain unchanged.

- [ ] **Step 10: Commit Task 2**

Run:

```powershell
git add packages\db\src\repos\TMRepo.ts packages\db\src\index.test.ts
git commit -m "feat: add english tm concordance phrase recall"
```

---

### Task 3: Prove Active TM Flow Emits The Phrase Concordance

**Files:**
- Modify: `apps/desktop/src/main/services/TMMatchFlow.test.ts`

- [ ] **Step 1: Add `Heartbeat Zone` to the English trace fixture**

In `seedEnglishTMFixture`, add this entry to the existing `for (const entry of [...])` array:

```ts
    {
      srcHash: 'heartbeat-zone',
      sourceText: 'Heartbeat Zone',
      targetText: 'Zone des battements',
    },
```

- [ ] **Step 2: Add a failing active flow test**

Add this test after `recalls English plural phrase concordance without matching a single ordinary token`:

```ts
  it('recalls English named phrase concordance from a long active source under noisy recall', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const { projectId, tmId } = seedEnglishTMFixture(db);
      const source =
        'Gravity is abnormal in the Heartbeat Zone. After Nikki enters, she will become weightless and float in the air, wrapped in a bubble. Moving while floating consumes Drifting Power. If Drifting Power runs out, the bubble will automatically pop. When Drifting Power is full, movement speed increases for a certain time, and moving during this period will not consume Drifting Power. After the acceleration ends, a certain amount of Drifting Power will be deducted.|Four different Music Bubbles float within the Heartbeat Zone: Heartstring Bubbles increase Drifting Power and Heartstrings; Speed Bubbles allow Nikki dash forward quickly for a short distance and grant a small amount of Drifting Power and Heartstrings; Fish Bubbles spit out many Heartstring Bubbles, which can be collected to gain extra Heartstrings; Spike Bubbles stop Nikki in place for a short time and reduce Drifting Power.|Heartstrings can also be obtained by playing with the Bom-Bom Bubble Machine in the Rest Zone or sitting in viewing chairs to enjoy the meteors. Besides the activities that grant Heartstrings, the stage lights can also be controlled to reveal dazzling changes of light and shadow.';

      for (let index = 0; index < 120; index += 1) {
        db.upsertTMEntry(
          createRuntimeTMEntry(tmId, {
            projectId,
            srcHash: `heartbeat-zone-noise-${index}`,
            sourceText: `Gravity Heartbeat Nikki Zone Floating Bubbles Drifting Power ${index}`,
            targetText: `bruit ${index}`,
            srcLang: 'en-US',
            tgtLang: 'fr-FR',
            usageCount: 100 + index,
          }),
        );
      }

      const trace = await traceActiveTMMatchFlow({
        db,
        projectId,
        source,
        srcHash: 'heartbeat-zone-long-source',
        targetHashes: ['heartbeat-zone'],
      });

      expect(trace.step4ConcordanceRecall.targets['heartbeat-zone']).toHaveLength(1);
      expect(
        trace.step5CandidateScoring.find((candidate) => candidate.srcHash === 'heartbeat-zone'),
      ).toMatchObject({
        fromConcordance: true,
        accepted: true,
        kind: 'concordance',
      });
      expect(trace.step6FinalMatches.map((match) => match.srcHash)).toContain('heartbeat-zone');
      expect(
        trace.step6FinalMatches.find((match) => match.srcHash === 'heartbeat-zone'),
      ).toMatchObject({
        kind: 'concordance',
        srcHash: 'heartbeat-zone',
      });
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 3: Run the focused active flow test**

Run:

```powershell
npx vitest run apps\desktop\src\main\services\TMMatchFlow.test.ts -t "English named phrase concordance"
```

Expected after Task 2: PASS. If it fails because the candidate is recalled but not in `step6FinalMatches`, stop and inspect `step5CandidateScoring` before changing ranking. Do not add a ranking boost unless the trace proves recall is fixed and visibility is still the only failure.

- [ ] **Step 4: Run related English active flow tests**

Run:

```powershell
npx vitest run apps\desktop\src\main\services\TMMatchFlow.test.ts -t "English"
```

Expected: PASS. Existing negative cases for `Tree`, `Menu Settings`, `API Menu`, and `US Settings` must remain non-matches.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add apps\desktop\src\main\services\TMMatchFlow.test.ts
git commit -m "test: cover english tm phrase concordance flow"
```

---

### Task 4: Manual Trace Against Installed Nikki Database

**Files:**
- No source files.
- Uses installed DB: `C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db`

- [ ] **Step 1: Run the motivating trace**

Run:

```powershell
npm run trace:tm-flow -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 2 --segment-id 6edd6179-8e3e-4ede-8dc9-7a6a61a6fbf7 --focus-src-hash "heartbeat zone:::"
```

Expected:

```text
step4ConcordanceRecall.targets["heartbeat zone:::"].length >= 1
step5CandidateScoring includes srcHash "heartbeat zone:::" with fromConcordance=true
step6FinalMatches includes srcHash "heartbeat zone:::" with kind "concordance"
```

- [ ] **Step 2: Run a CJK regression trace**

Run:

```powershell
npm run trace:tm-flow -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --segment-id 31115202-d084-4c43-8737-99291c53ebe3
```

Expected:

```text
Trace completes successfully.
Mounted TMs are Nikki(zh-fr) working/main TMs.
Final matches do not show English phrase-specific behavior.
```

- [ ] **Step 3: Record trace observations in the implementation summary**

Do not edit code in this step. In the final handoff, include:

```text
Installed DB trace: Heartbeat Zone is now a concordance final match.
CJK installed DB trace: completed without English profile leakage.
```

---

### Task 5: Full Verification

**Files:**
- No source edits unless a verification failure exposes a bug in Tasks 1-3.

- [ ] **Step 1: Run focused core, DB, and active flow tests**

Run:

```powershell
npx vitest run packages\core\src\text\index.test.ts -t "TM Matching Profiles"
npx vitest run packages\db\src\index.test.ts -t "concordance"
npx vitest run apps\desktop\src\main\services\TMMatchFlow.test.ts -t "English"
```

Expected: all commands PASS.

- [ ] **Step 2: Run typecheck for affected desktop workspace**

Run:

```powershell
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run package/core TypeScript check if available**

Run:

```powershell
npx tsc --noEmit -p packages/core/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Run package DB test file**

Run:

```powershell
npx vitest run packages\db\src\index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit verification-only fixes if needed**

If any verification command fails due to a bug introduced in this plan, fix the smallest affected code path, rerun the failing command, then commit:

```powershell
git add packages\core\src\text packages\db\src apps\desktop\src\main\services\TMMatchFlow.test.ts
git commit -m "fix: stabilize english tm concordance phrase lane"
```

Skip this commit if no fixes are needed after Task 3.

---

## Final Handoff Checklist

- [ ] `Heartbeat Zone` is recalled through `step4ConcordanceRecall`, not only fuzzy recall.
- [ ] `Heartbeat Zone` reaches `step6FinalMatches` as `kind: "concordance"`.
- [ ] English evidence remains strict: `Zone` alone is not a match.
- [ ] Existing English negative active flow tests still pass.
- [ ] Existing CJK active concordance tests still pass.
- [ ] Installed Nikki(en-fr) DB trace confirms the original issue is fixed.
- [ ] Installed Nikki(zh-fr) DB trace completes without English profile leakage.
