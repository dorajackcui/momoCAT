# English TM Concordance Phrase Lane Design

Date: 2026-06-16

## Purpose

Fix English active TM concordance recall for short named phrases that are
contained in long source segments, without changing CJK/default matching.

The motivating failure is project `Nikki(en-fr)`, file id `13`, rowRef `134`.
The active source contains the phrase `Heartbeat Zone`, and the mounted main TM
contains:

- Source: `Heartbeat Zone`
- Target: `Zone des battements`

The TMTB panel's active TM concordance branch does not show the entry even
though the data exists and direct FTS phrase lookup can find it.

## Non-Negotiable Constraints

- CJK/default profile behavior must remain unchanged. CJK fragment generation,
  CJK exact tiers, CJK LIKE fallback, local-overlap scoring, diversity,
  thresholds, sorting, and caps are not in scope.
- The fix must be gated by the existing English TM profile selected from
  `project.srcLang`.
- Do not loosen `hasEnglishTMConcordanceEvidence`. The current evidence gate is
  correct for `Heartbeat Zone`; the candidate simply fails to enter the
  concordance candidate set.
- Do not solve this by increasing broad raw limits or result limits. That would
  make recall slower and noisier without addressing the actual missing anchor.
- Do not change the TMTB rendering cap. The candidate must become a legitimate
  TM/concordance match before UI display is considered.
- Do not add schema changes or import-time alias materialization in this fix.

## Evidence From Real Data

The installed desktop database is:

```text
C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db
```

Relevant data:

- `Nikki(en-fr)` is `projectId=2`, `srcLang=en-US`, `tgtLang=fr-FR`.
- File id `13` uses `sourceCol=4`, so the active source is the English `en`
  column.
- Mounted main TM `Nikki` has 133021 entries.
- TM entry `ee92c758-f1bb-4a51-9758-de5c1b6711fb` has
  `srcHash="heartbeat zone:::"`.
- Direct FTS with `srcText : "heartbeat zone"` returns that entry.

Active flow trace for project `2`, segment
`6edd6179-8e3e-4ede-8dc9-7a6a61a6fbf7` shows:

- `step3FuzzyRecall` includes `Heartbeat Zone`.
- The candidate is fuzzy-only: `fromFuzzy=true`, `fromConcordance=false`.
- English fuzzy-only short phrase suppression removes it later.
- `step4ConcordanceRecall` reports `ftsQueryCount=1`, `rawRows=64`,
  `acceptedRows=0`, `degraded=true`.
- `step6FinalMatches=[]`.

The current English recall terms for this long source include `heartbeat` and
`zone`, but not `heartbeat zone`. The broad token FTS batch is filled by terms
such as `Gravity`, `Heartbeat`, `Nikki`, `float`, `bubble`, and `Power`, so the
exact short phrase is not retrieved as a concordance candidate.

## Root Cause

The active TM flow correctly separates fuzzy recall from concordance recall:

1. `TMService.findMatches` collects fuzzy and concordance candidates.
2. It merges candidates by entry id and tracks `fromFuzzy` and
   `fromConcordance`.
3. For English, fuzzy-only short phrase submatches are suppressed unless the
   same candidate also has concordance evidence.
4. Concordance candidates come from `TMRepo.searchTMConcordanceRecallCandidates`.

The failure is in step 4. English concordance recall currently reuses broad
single-token recall terms. In long English sources, the 32-term budget and the
64-row FTS batch are consumed by common but locally relevant words. Short named
phrases like `Heartbeat Zone` are valid final evidence, but they are not
promoted to phrase recall anchors early enough to be seen.

## Options Considered

### A. Increase Concordance Raw Limits

Increase `rawLimit`, `TM_CONCORDANCE_RECALL_BATCH_RAW_LIMIT`, or final result
limits.

This is not recommended. It may recover some missed phrases by brute force, but
the result depends on FTS ranking and database density. It also makes active TM
matching slower and noisier for large TMs.

### B. Loosen English Concordance Evidence

Allow more candidates through `hasEnglishTMConcordanceEvidence` or final scoring.

This is not recommended. The evidence predicate already accepts
`Heartbeat Zone` when it sees the candidate. Loosening it would increase false
positives without fixing the candidate discovery problem.

### C. Add an English-Only Phrase-First Concordance Lane

Extract conservative 2-4 token English named phrases from the active source and
run those phrase anchors before broad token FTS.

This is recommended. It addresses the exact missing stage, preserves the final
evidence gate, and can be fully gated behind `profile === "english"` so
CJK/default behavior remains untouched.

## Design

### 1. Add English Concordance Phrase Extraction

Add a helper in the TM text profile layer, for example:

```ts
buildEnglishTMConcordancePhraseTerms(text: string): {
  exactPhrases: string[];
  ftsPhrases: string[];
}
```

This helper is separate from `buildEnglishTMRecallTerms`. The existing fuzzy
recall terms remain available for fuzzy recall and broad English recall.

Phrase extraction rules:

- Extract 2-4 token phrases.
- Prefer contiguous raw Title Case named phrases from the source text.
- Canonicalize phrase terms with the existing English normalization rules for
  FTS/evidence consistency.
- Keep exact source forms for `tm_fts.srcText IN (...)` exact lookup.
- Reject single-token phrases.
- Reject phrases that start or end with English stopwords after
  canonicalization.
- Reject phrases whose significant tokens are not named-phrase shaped.
- Deduplicate while preserving source order, then cap to a small bounded count.

For the motivating source, the helper should produce phrase anchors including:

- `Heartbeat Zone`
- `Drifting Power`
- `Music Bubbles`
- `Heartstring Bubbles`
- `Speed Bubbles`
- `Fish Bubbles`
- `Spike Bubbles`
- `Rest Zone`

It must not produce `Zone` as a standalone phrase anchor.

### 2. Extend the Concordance Recall Plan

Extend the internal concordance recall plan with English-only fields:

```ts
englishExactPhrases: string[];
englishPhraseTerms: string[];
```

These fields are populated only when `profile === "english"`. For default/CJK
profiles, both fields remain empty.

Existing plan fields stay as they are:

- `cjk4Fragments`
- `cjk3Fragments`
- `longCjkFragments`
- `latinTerms`
- `shortCjkTerms`
- `englishTerms`

### 3. Insert Phrase-First Collection Tiers

Change concordance collection order for English profile only:

1. Existing exact source tier, extended to include `englishExactPhrases`.
2. New English phrase FTS tier using `englishPhraseTerms`.
3. Existing broad FTS tier:
   `cjk4Fragments + latinTerms + englishTerms`.
4. Existing long CJK tier.
5. Existing CJK3 tier.
6. Existing LIKE tier.

The phrase FTS tier should use the same acceptance path as other concordance
rows. It must still call `hasEnglishTMConcordanceEvidence` before a row becomes
an accepted concordance candidate.

For `Heartbeat Zone`, the new exact/phrase tier should retrieve the TM entry
before broad token FTS can exhaust the raw-row budget.

### 4. Keep Service-Level Semantics Stable

`TMService.findMatches` should continue to merge fuzzy and concordance
candidates by id.

With the new phrase lane:

- `Heartbeat Zone` can appear as both `fromFuzzy=true` and
  `fromConcordance=true`.
- English fuzzy-only phrase suppression no longer removes it because it is not
  fuzzy-only.
- Existing contained concordance promotion can raise the local overlap to the
  concordance threshold when the phrase entry is contained in the source.

No UI changes are needed.

## Data Flow

```text
active segment source
  -> resolveTMTextProfile(project.srcLang)
  -> English phrase extraction
  -> TMRepo concordance plan
  -> exact phrase lookup
  -> phrase FTS lookup
  -> existing broad FTS/other tiers
  -> hasEnglishTMConcordanceEvidence
  -> TMService candidate merge
  -> existing scoring/classification/diversity
  -> TMTB TM matches
```

For non-English source projects, the new phrase extraction returns no plan data
and the flow remains the current default/CJK path.

## Testing And Validation

### Unit Tests

Add tests for English phrase extraction:

- Long `Heartbeat Zone` source produces `heartbeat zone`.
- It does not produce standalone `zone`.
- It handles repeated phrases without duplicates.
- It keeps bounded output on long sources.
- It avoids ordinary lowercase phrase noise, such as `menu settings`.

Extend evidence tests only where necessary to document existing behavior:

- `hasEnglishTMConcordanceEvidence(longSource, "Heartbeat Zone")` is true.
- `hasEnglishTMConcordanceEvidence(longSource, "Zone")` is false.
- Existing negative tests for `The Value Changed`, `Open Menu Settings`, and
  lowercase ordinary phrases remain unchanged.

### Repository Tests

Add an English concordance recall fixture where:

- Source is the long `Heartbeat Zone` segment.
- TM contains `Heartbeat Zone -> Zone des battements`.
- Broad token FTS would otherwise return many noisy rows.
- `searchTMConcordanceRecallCandidates(..., { profile: "english" })` includes
  the phrase entry.

Add a default/CJK control fixture proving the same code path without English
profile does not use English phrase terms.

### Active Flow Trace

Use the installed DB as a manual validation target:

```text
npm run trace:tm-flow -- --db C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db --project-id 2 --segment-id 6edd6179-8e3e-4ede-8dc9-7a6a61a6fbf7 --focus-src-hash "heartbeat zone:::"
```

Expected after the fix:

- `step4ConcordanceRecall.acceptedRows > 0`.
- Focus source hash `heartbeat zone:::` appears in concordance recall.
- `step5CandidateScoring` shows it as `fromConcordance=true`.
- `step6FinalMatches` includes `heartbeat zone:::` as `kind="concordance"`.

### CJK Regression Trace

Use installed DB project `3` (`Nikki(zh-fr)`) as a profile-invariance check.
Trace one or two existing Chinese segments before and after the change.

Expected:

- Same mounted TMs.
- Same final source hashes and ranks.
- No English phrase debug/tier data for `profile !== "english"`.

## Rollout

Implement behind the existing English profile dispatch. No feature flag is
needed because non-English profiles receive empty phrase fields.

If validation shows accepted English phrase candidates are still outside the
visible TMTB top 5, consider a separate ranking adjustment for English
concordance phrase candidates. That should be a follow-up only after the
recall-stage fix is proven.

## Success Criteria

- `Heartbeat Zone` appears in the active TMTB TM/concordance branch for the
  motivating Nikki segment.
- The fix is explained by trace evidence at the recall stage, not by UI changes.
- Existing English negative cases do not become final matches.
- CJK/default trace output remains equivalent for sampled segments.
- Performance remains bounded: phrase tiers use small capped term lists and do
  not trigger full mounted TM scans.
