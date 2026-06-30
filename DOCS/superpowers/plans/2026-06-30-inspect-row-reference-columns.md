# Inspect Row Reference Columns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make inspect spreadsheet `TM for MT` and `TB for MT` columns row-scoped while preserving the full window prompt in `MT User Prompt`.

**Architecture:** Keep the desktop inspect path unchanged because it already delegates to `@cat/localization`. Add a row-level xlsx field builder in `LocalizationInspectorArtifacts`, then call it from both window and window-partial inspect flows. The full batch `PromptArtifact` remains assigned to each row, but row helper columns are rendered from that row's selected TM/TB artifacts.

**Tech Stack:** TypeScript, Vitest, `xlsx`, `@cat/localization`, `@cat/core` prompt reference types.

---

## File Structure

- Modify: `packages/localization/src/LocalizationInspectorArtifacts.ts`
  - Owns inspect xlsx field rendering.
  - Add `buildUnitXlsxFields` and small private render helpers for row-scoped TM, concordance, and TB reference blocks.
  - Keep `buildXlsxFields` available for compatibility unless cleanup is clearly safe after typecheck.

- Modify: `packages/localization/src/LocalizationInspector.ts`
  - Replace both `buildXlsxFields(mt, unitIndex, maxCellChars)` calls with `buildUnitXlsxFields({ mt, unit, unitIndex, maxCellChars })`.

- Create: `packages/localization/src/LocalizationInspectorArtifacts.test.ts`
  - Unit tests for row-scoped helper output and truncation.

- Modify: `packages/localization/src/LocalizationInspector.test.ts`
  - Add an integration test proving two rows in the same window keep distinct `TM for MT` and `TB for MT` columns while sharing the full window prompt.
  - Update the existing concordance xlsx expectation from batch prompt blocks to row-selected references.

---

### Task 1: Add Row-Level Xlsx Helper Tests

**Files:**
- Create: `packages/localization/src/LocalizationInspectorArtifacts.test.ts`
- Test: `packages/localization/src/LocalizationInspectorArtifacts.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/localization/src/LocalizationInspectorArtifacts.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import type { InspectUnitArtifact, PromptArtifact } from './artifacts';
import { buildUnitXlsxFields } from './LocalizationInspectorArtifacts';

describe('buildUnitXlsxFields', () => {
  it('renders row-scoped TM, concordance, and TB references while preserving full prompt', () => {
    const mt = createPromptArtifact('FULL WINDOW PROMPT: row-2 and row-3');
    const unit = createReadyUnit({
      tmReferences: [
        {
          similarity: 100,
          tmName: 'Main TM Row 1',
          sourceText: 'Hello world',
          targetText: 'Bonjour le monde',
        },
      ],
      concordanceReferences: [
        {
          matchedSourceText: 'world',
          tmName: 'Concordance TM Row 1',
          sourceText: 'world settings',
          targetText: 'parametres monde',
        },
      ],
      tbReferences: [
        {
          srcTerm: 'world',
          tgtTerm: 'monde',
          note: 'Use the common noun.',
        },
      ],
    });

    const fields = buildUnitXlsxFields({
      mt,
      unit,
      unitIndex: 0,
      maxCellChars: 1000,
    });

    expect(fields.mtUserPrompt).toBe('FULL WINDOW PROMPT: row-2 and row-3');
    expect(fields.tmForMt).toContain('TM References');
    expect(fields.tmForMt).toContain(
      '1. 100% Main TM Row 1 | Hello world -> Bonjour le monde',
    );
    expect(fields.tmForMt).toContain('Concordance Suggestions');
    expect(fields.tmForMt).toContain(
      '1. world (Concordance TM Row 1) | world settings -> parametres monde',
    );
    expect(fields.tmForMt).not.toContain('Other Row');
    expect(fields.tbForMt).toContain('Terminology References');
    expect(fields.tbForMt).toContain('1. world -> monde (note: Use the common noun.)');
    expect(fields.tbForMt).not.toContain('Other Term');
    expect(fields.truncated).toEqual({
      tmForMt: false,
      tbForMt: false,
      mtUserPrompt: false,
    });
  });

  it('truncates row-scoped reference columns with unit-specific json refs', () => {
    const unit = createReadyUnit({
      tmReferences: [
        {
          similarity: 99,
          tmName: 'Very Long Main TM Name',
          sourceText: 'A'.repeat(100),
          targetText: 'B'.repeat(100),
        },
      ],
      concordanceReferences: [],
      tbReferences: [
        {
          srcTerm: 'C'.repeat(100),
          tgtTerm: 'D'.repeat(100),
          note: 'E'.repeat(100),
        },
      ],
    });

    const fields = buildUnitXlsxFields({
      mt: createPromptArtifact('F'.repeat(100)),
      unit,
      unitIndex: 1,
      maxCellChars: 80,
    });

    expect(fields.tmForMt).toContain('[TRUNCATED: see #/units/1/tm/selectedReferences]');
    expect(fields.tbForMt).toContain('[TRUNCATED: see #/units/1/tb/selectedReferences]');
    expect(fields.mtUserPrompt).toContain('[TRUNCATED: see #/units/1/mt/userPrompt]');
    expect(fields.truncated).toEqual({
      tmForMt: true,
      tbForMt: true,
      mtUserPrompt: true,
    });
  });
});

function createPromptArtifact(userPrompt: string): PromptArtifact {
  return {
    unitId: 'inspect-window-1',
    provider: {
      id: 'provider:test',
      name: 'Test Provider',
      baseUrl: 'https://api.test/v1',
    },
    model: 'gpt-test',
    reasoningEffort: 'medium',
    projectPrompt: '',
    projectType: 'translation',
    sourcePayload: 'row-2: Hello world\nrow-3: Preferences',
    tmPromptBlock: 'window-level tm block',
    concordancePromptBlock: 'window-level concordance block',
    tbPromptBlock: 'window-level tb block',
    referencePromptBlock: 'window-level reference block',
    systemPrompt: 'system prompt',
    userPrompt,
    promptChars: {
      system: 'system prompt'.length,
      user: userPrompt.length,
      total: 'system prompt'.length + userPrompt.length,
    },
    batch: {
      mode: 'window',
      taskId: 'inspect-window-1',
      currentIds: ['row-2', 'row-3'],
      previousContextCount: 0,
      nextContextCount: 0,
    },
  };
}

function createReadyUnit(
  refs: Pick<
    InspectUnitArtifact['tm']['selectedReferences'],
    'tmReferences' | 'concordanceReferences'
  > & {
    tbReferences: InspectUnitArtifact['tb']['selectedReferences'];
  },
): InspectUnitArtifact {
  return {
    unit: {
      rowIndex: 1,
      rowNumber: 2,
      unitId: 'row-2',
      source: 'Hello world',
      target: '',
      originalCells: ['Hello world', ''],
    },
    transientSegment: {
      segmentId: 'row-2',
      matchKey: 'hello world',
      srcHash: 'hash-row-2',
      tagsSignature: '',
    },
    tm: {
      unitId: 'row-2',
      segmentId: 'row-2',
      mountedTMs: [],
      rawMatches: [],
      selectedReferences: {
        tmReferences: refs.tmReferences,
        concordanceReferences: refs.concordanceReferences,
      },
      selectionPolicy: {
        maxTmReferences: 3,
        maxConcordanceReferences: 2,
      },
      diagnostics: [],
    },
    tb: {
      unitId: 'row-2',
      segmentId: 'row-2',
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: refs.tbReferences,
      selectionPolicy: {
        maxTbReferences: 12,
      },
      diagnostics: [],
    },
    mt: createPromptArtifact(''),
    xlsx: {
      tmForMt: '',
      tbForMt: '',
      mtUserPrompt: '',
      truncated: {
        tmForMt: false,
        tbForMt: false,
        mtUserPrompt: false,
      },
    },
    status: 'ready',
  };
}
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspectorArtifacts.test.ts
```

Expected: FAIL with an import error like `buildUnitXlsxFields is not exported`.

- [ ] **Step 3: Commit the failing helper tests**

```powershell
git add packages/localization/src/LocalizationInspectorArtifacts.test.ts
git commit -m "test: cover inspect row reference xlsx fields"
```

---

### Task 2: Implement Row-Level Reference Rendering Helper

**Files:**
- Modify: `packages/localization/src/LocalizationInspectorArtifacts.ts`
- Test: `packages/localization/src/LocalizationInspectorArtifacts.test.ts`

- [ ] **Step 1: Add `buildUnitXlsxFields` and render helpers**

In `packages/localization/src/LocalizationInspectorArtifacts.ts`, add this function near `buildXlsxFields` and keep `truncateForCell` unchanged:

```ts
export function buildUnitXlsxFields({
  mt,
  unit,
  unitIndex,
  maxCellChars,
}: {
  mt: PromptArtifact;
  unit: Pick<InspectUnitArtifact, 'tm' | 'tb'>;
  unitIndex: number;
  maxCellChars: number;
}): InspectUnitArtifact['xlsx'] {
  const tmPromptInput = buildUnitTMForMt(unit.tm);
  const tbPromptInput = buildUnitTBForMt(unit.tb);
  const tmForMt = truncateForCell(
    tmPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/tm/selectedReferences`,
  );
  const tbForMt = truncateForCell(
    tbPromptInput,
    maxCellChars,
    `#/units/${unitIndex}/tb/selectedReferences`,
  );
  const mtUserPrompt = truncateForCell(
    mt.userPrompt,
    maxCellChars,
    `#/units/${unitIndex}/mt/userPrompt`,
  );

  return {
    tmForMt: tmForMt.value,
    tbForMt: tbForMt.value,
    mtUserPrompt: mtUserPrompt.value,
    truncated: {
      tmForMt: tmForMt.truncated,
      tbForMt: tbForMt.truncated,
      mtUserPrompt: mtUserPrompt.truncated,
    },
  };
}

function buildUnitTMForMt(tm: TMArtifact): string {
  return [
    buildUnitTMReferenceBlock(tm.selectedReferences.tmReferences),
    buildUnitConcordanceReferenceBlock(tm.selectedReferences.concordanceReferences),
  ]
    .filter((block) => block.length > 0)
    .join('\n\n');
}

function buildUnitTMReferenceBlock(
  references: TMArtifact['selectedReferences']['tmReferences'],
): string {
  if (references.length === 0) return '';

  return [
    'TM References',
    ...references.map(
      (reference, index) =>
        `${index + 1}. ${reference.similarity}% ${reference.tmName} | ${reference.sourceText} -> ${reference.targetText}`,
    ),
  ].join('\n');
}

function buildUnitConcordanceReferenceBlock(
  references: TMArtifact['selectedReferences']['concordanceReferences'],
): string {
  if (references.length === 0) return '';

  return [
    'Concordance Suggestions',
    ...references.map(
      (reference, index) =>
        `${index + 1}. ${reference.matchedSourceText} (${reference.tmName}) | ${reference.sourceText} -> ${reference.targetText}`,
    ),
  ].join('\n');
}

function buildUnitTBForMt(tb: TBArtifact): string {
  if (tb.selectedReferences.length === 0) return '';

  return [
    'Terminology References',
    ...tb.selectedReferences.map((reference, index) => {
      const note = typeof reference.note === 'string' ? reference.note.trim() : '';
      const noteSuffix = note ? ` (note: ${note})` : '';
      return `${index + 1}. ${reference.srcTerm} -> ${reference.tgtTerm}${noteSuffix}`;
    }),
  ].join('\n');
}
```

- [ ] **Step 2: Run helper tests to verify they pass**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspectorArtifacts.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck for the localization package scope**

Run:

```powershell
npx tsc --noEmit -p packages/localization/tsconfig.json
```

Expected: PASS.

- [ ] **Step 4: Commit the helper implementation**

```powershell
git add packages/localization/src/LocalizationInspectorArtifacts.ts packages/localization/src/LocalizationInspectorArtifacts.test.ts
git commit -m "feat: render inspect row reference columns"
```

---

### Task 3: Wire Helper Into Window And Window-Partial Inspect

**Files:**
- Modify: `packages/localization/src/LocalizationInspector.ts`
- Test: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Write the failing inspector integration test**

In `packages/localization/src/LocalizationInspector.test.ts`, add this test inside `describe('LocalizationInspector.inspectFile', () => { ... })`, near the existing window inspect tests:

```ts
  it('keeps inspect TM and TB xlsx columns scoped to each row in a shared window prompt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Row References Inspect', 'en', 'fr');
      configureAIProvider(db, projectId);
      mountDistinctReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Open', 'Ouvrir'],
        ['Hello world', ''],
        ['Preferences', ''],
      ]);
      const inspector = new LocalizationInspector(db, {
        aiTransport: createTransport(),
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });
      const json = JSON.parse(await readFile(result.jsonOutputPath, 'utf8'));
      const helloUnit = json.units.find(
        (unit: { unit: { source: string } }) => unit.unit.source === 'Hello world',
      );
      const preferencesUnit = json.units.find(
        (unit: { unit: { source: string } }) => unit.unit.source === 'Preferences',
      );

      expect(helloUnit.mt.batch.currentIds).toEqual(['row-3', 'row-4']);
      expect(helloUnit.mt.userPrompt).toContain('Bonjour le monde');
      expect(helloUnit.mt.userPrompt).toContain('Reglages');
      expect(helloUnit.xlsx.tmForMt).toContain('Bonjour le monde');
      expect(helloUnit.xlsx.tmForMt).not.toContain('Reglages');
      expect(helloUnit.xlsx.tbForMt).toContain('world -> monde');
      expect(helloUnit.xlsx.tbForMt).not.toContain('Preferences -> Reglages');
      expect(preferencesUnit.xlsx.tmForMt).toContain('Reglages');
      expect(preferencesUnit.xlsx.tmForMt).not.toContain('Bonjour le monde');
      expect(preferencesUnit.xlsx.tbForMt).toContain('Preferences -> Reglages');
      expect(preferencesUnit.xlsx.tbForMt).not.toContain('world -> monde');

      const written = XLSX.read(await readFile(result.outputPath), {
        type: 'buffer',
      });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];

      expect(segmentRows[2][2]).toContain('Bonjour le monde');
      expect(segmentRows[2][2]).not.toContain('Reglages');
      expect(segmentRows[2][3]).toContain('world -> monde');
      expect(segmentRows[2][3]).not.toContain('Preferences -> Reglages');
      expect(segmentRows[2][4]).toContain('Bonjour le monde');
      expect(segmentRows[2][4]).toContain('Reglages');
      expect(segmentRows[3][2]).toContain('Reglages');
      expect(segmentRows[3][2]).not.toContain('Bonjour le monde');
      expect(segmentRows[3][3]).toContain('Preferences -> Reglages');
      expect(segmentRows[3][3]).not.toContain('world -> monde');
      expect(segmentRows[3][4]).toContain('Bonjour le monde');
      expect(segmentRows[3][4]).toContain('Reglages');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
```

Add this helper near `mountReferenceData`:

```ts
function mountDistinctReferenceData(db: CATDatabase, projectId: number): void {
  const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
  db.mountTMToProject(projectId, tmId, 10, 'read');

  for (const [sourceText, targetText] of [
    ['Hello world', 'Bonjour le monde'],
    ['Preferences', 'Reglages'],
  ] as const) {
    const entry = createTMEntry({
      tmId,
      projectId,
      sourceText,
      targetText,
    });
    const entryId = db.upsertTMEntryBySrcHash(entry);
    db.replaceTMFts(
      tmId,
      serializeTokensToDisplayText(entry.sourceTokens),
      serializeTokensToDisplayText(entry.targetTokens),
      entryId,
    );
  }

  const tbId = db.createTermBase('Client Terms', 'en', 'fr');
  db.mountTermBaseToProject(projectId, tbId, 20);
  db.insertTBEntryIfAbsentBySrcTerm({
    id: 'term-world',
    tbId,
    srcLang: 'en',
    srcTerm: 'world',
    tgtTerm: 'monde',
    note: 'Use the common noun.',
  });
  db.insertTBEntryIfAbsentBySrcTerm({
    id: 'term-preferences',
    tbId,
    srcLang: 'en',
    srcTerm: 'Preferences',
    tgtTerm: 'Reglages',
    note: 'Use UI noun.',
  });
}
```

- [ ] **Step 2: Run inspector test to verify it fails**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspector.test.ts -t "keeps inspect TM and TB xlsx columns scoped"
```

Expected: FAIL because `helloUnit.xlsx.tmForMt` or workbook `_tm_for_mt` still contains `Reglages`.

- [ ] **Step 3: Wire `buildUnitXlsxFields` into `LocalizationInspector`**

In `packages/localization/src/LocalizationInspector.ts`, change the import from:

```ts
  buildXlsxFields,
```

to:

```ts
  buildUnitXlsxFields,
```

In both `inspectRowsWindowMode` and `inspectRowsWindowPartialMode`, replace:

```ts
        for (const { unitIndex } of readyRows) {
          units[unitIndex] = {
            ...units[unitIndex],
            mt,
            xlsx: buildXlsxFields(mt, unitIndex, maxCellChars),
          };
        }
```

with:

```ts
        for (const { unitIndex } of readyRows) {
          const unitWithPrompt = {
            ...units[unitIndex],
            mt,
          };
          units[unitIndex] = {
            ...unitWithPrompt,
            xlsx: buildUnitXlsxFields({
              mt,
              unit: unitWithPrompt,
              unitIndex,
              maxCellChars,
            }),
          };
        }
```

Apply this replacement to both loops. The two loops should stay intentionally identical.

- [ ] **Step 4: Run the focused inspector test to verify it passes**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspector.test.ts -t "keeps inspect TM and TB xlsx columns scoped"
```

Expected: PASS.

- [ ] **Step 5: Commit the inspector wiring**

```powershell
git add packages/localization/src/LocalizationInspector.ts packages/localization/src/LocalizationInspector.test.ts
git commit -m "fix: scope inspect xlsx references per row"
```

---

### Task 4: Update Existing Concordance Inspect Expectation

**Files:**
- Modify: `packages/localization/src/LocalizationInspector.test.ts`
- Test: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Run the existing concordance test to expose the expectation change**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspector.test.ts -t "includes concordance prompt blocks"
```

Expected: FAIL because `_tm_for_mt` no longer mirrors `mt.tmPromptBlock` and `mt.concordancePromptBlock` from the mocked batch prompt.

- [ ] **Step 2: Update the concordance test to assert JSON batch prompt preservation and row xlsx behavior separately**

In the test named `includes concordance prompt blocks in JSON and TM-for-MT xlsx output`, keep the JSON assertions and replace these xlsx assertions:

```ts
      expect(segmentRows[1][2]).toContain('TM prompt block');
      expect(segmentRows[1][2]).toContain('Concordance Suggestions:');
      expect(segmentRows[1][6]).toBe('#/units/0');
```

with:

```ts
      expect(segmentRows[1][2]).not.toContain('TM prompt block');
      expect(segmentRows[1][2]).not.toContain('Match: world');
      expect(segmentRows[1][4]).toBe('FULL_PROMPT');
      expect(segmentRows[1][6]).toBe('#/units/0');
```

This test has no mounted reference data, so row-level `_tm_for_mt` should be empty while `_mt_user_prompt` remains the mocked full prompt.

- [ ] **Step 3: Run the updated concordance test**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspector.test.ts -t "includes concordance prompt blocks"
```

Expected: PASS.

- [ ] **Step 4: Commit the expectation update**

```powershell
git add packages/localization/src/LocalizationInspector.test.ts
git commit -m "test: update inspect concordance xlsx expectation"
```

---

### Task 5: Full Verification

**Files:**
- Verify only; no source edits expected.

- [ ] **Step 1: Run focused localization inspect tests**

Run:

```powershell
npx vitest run packages/localization/src/LocalizationInspectorArtifacts.test.ts packages/localization/src/LocalizationInspector.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run adjacent localization module tests**

Run:

```powershell
npx vitest run packages/localization/src/modules/TMModule.test.ts packages/localization/src/modules/TBModule.test.ts packages/localization/src/modules/FileModule.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run desktop inspect mapping tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/ProjectFileModule.test.ts apps/desktop/src/renderer/src/components/project-detail/fileInspectAction.test.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts
```

Expected: PASS. If a main-process test fails with a `better-sqlite3` Node ABI mismatch, run:

```powershell
npm run rebuild:test
```

Then rerun the same Vitest command.

- [ ] **Step 4: Run typecheck**

Run:

```powershell
npm run typecheck
```

Expected: PASS.

- [ ] **Step 5: Check patch hygiene and status**

Run:

```powershell
git diff --check
git status --short
```

Expected: `git diff --check` prints no output. `git status --short` shows only the intended source and test files if commits were not made during task execution; if every task commit was made, it shows a clean tree except for pre-existing unrelated changes.

- [ ] **Step 6: Final commit if any verification-only edits were needed**

If verification required small fixes, commit them:

```powershell
git add packages/localization/src/LocalizationInspector.ts packages/localization/src/LocalizationInspectorArtifacts.ts packages/localization/src/LocalizationInspector.test.ts packages/localization/src/LocalizationInspectorArtifacts.test.ts
git commit -m "chore: verify inspect row reference columns"
```

Expected: commit succeeds only if there are changes. If there are no changes, skip this step.

---

## Self-Review Notes

- Spec coverage: Task 2 implements row-level `TM for MT` and `TB for MT`; Task 3 preserves full `MT User Prompt` while wiring row xlsx fields into both inspect modes; Task 4 updates existing expectations; Task 5 verifies desktop still works through shared inspect.
- Placeholder scan: the plan contains concrete file paths, code snippets, commands, and expected outcomes.
- Type consistency: `buildUnitXlsxFields` accepts `PromptArtifact`, `InspectUnitArtifact` TM/TB fields, `unitIndex`, and `maxCellChars`, matching the planned caller shape in `LocalizationInspector`.
