# MT Request Mode Strategy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Represent legacy single-unit concurrent MT and Window Mode sequential batch MT as parallel request mode strategies inside `@cat/localization`, while keeping Window Mode as the agent-first default.

**Architecture:** Add an internal `packages/localization/src/requestModes` slice with focused shared helpers and two strategy classes. `LocalizationEngine` remains the public orchestration shell and delegates request-mode-specific execution to strategies. `LocalizationInspector` reuses the shared Window Mode context helper for no-request prompt inspection.

**Tech Stack:** TypeScript, Vitest, `@cat/core` prompt/token helpers, `@cat/db` test database, existing `@cat/localization` job runner and MT/TM/TB modules.

---

## File Structure

Create:

- `packages/localization/src/requestModes/types.ts`
  Internal strategy input and reference types shared by both request modes.

- `packages/localization/src/requestModes/shared/unitIdentity.ts`
  Stable unit key and Window Mode response id helpers.

- `packages/localization/src/requestModes/shared/contextWindowBuilder.ts`
  Previous translated context and next source context selection for Window Mode.

- `packages/localization/src/requestModes/shared/references.ts`
  TM/TB reference resolution helpers and empty-reference helpers for custom projects.

- `packages/localization/src/requestModes/shared/results.ts`
  Conversion helpers for `TranslateUnitResult`, `UnitResult`, and `ArtifactRecord`.

- `packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts`
  Unit tests for Window Mode context selection.

- `packages/localization/src/requestModes/shared/results.test.ts`
  Unit tests for identity/result helpers.

- `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
  Window Mode task execution strategy.

- `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`
  Unit tests for batch execution, context, artifacts, and id mapping.

- `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`
  Legacy single-unit bounded-concurrency strategy.

- `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts`
  Unit tests for legacy concurrency and single-result mapping.

Modify:

- `packages/localization/src/LocalizationEngine.ts`
  Instantiate strategies, delegate file-job Window Mode execution, delegate legacy `translateUnits`, and remove private Window Mode-specific helpers.

- `packages/localization/src/LocalizationInspector.ts`
  Use the shared context-window builder instead of local duplicate helper functions.

- `packages/localization/src/LocalizationEngine.test.ts`
  Keep existing integration tests and add one focused assertion that `translateUnits` still runs through bounded legacy concurrency.

- `packages/localization/src/LocalizationInspector.test.ts`
  Keep existing Window Mode inspect tests; adjust expectations only if helper output ordering changes, which it should not.

- `packages/localization/src/index.ts`
  Do not export request mode strategies from the package barrel unless a compile error proves a public export is required. The strategy slice is internal.

Do not modify:

- `apps/desktop/**`
- `packages/core/src/project/windowModePrompt.ts`
- `packages/core/src/project/windowModePromptTypes.ts`
- CLI scripts, unless validation reveals an existing broken import after the refactor.

---

### Task 1: Add Shared Unit Identity And Context Window Builder

**Files:**
- Create: `packages/localization/src/requestModes/shared/unitIdentity.ts`
- Create: `packages/localization/src/requestModes/shared/contextWindowBuilder.ts`
- Create: `packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts`

- [ ] **Step 1: Write the failing context-window tests**

Create `packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { JobUnit, TranslationTask, UnitResult } from '../../job/types';
import {
  buildWindowModeContext,
  mergeCompletedResults,
} from './contextWindowBuilder';

function unit(row: number, source: string, target = ''): JobUnit {
  return {
    documentId: 'book.xlsx',
    unitId: `row-${row}`,
    source,
    target,
    sourceHash: `hash-${row}`,
  };
}

function result(unit: JobUnit, target: string, status: UnitResult['status'] = 'translated'): UnitResult {
  return {
    jobId: 'job-1',
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status,
    source: unit.source,
    target,
  };
}

describe('buildWindowModeContext', () => {
  it('selects previous translated rows before the last current unit and reverses them into file order', () => {
    const jobUnits = [
      unit(1, 'One'),
      unit(2, 'Two'),
      unit(3, 'Three'),
      unit(4, 'Four'),
      unit(5, 'Five'),
      unit(6, 'Six'),
      unit(7, 'Seven'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-2',
      units: [jobUnits[5], jobUnits[6]],
    };
    const completedResults = new Map(
      jobUnits.slice(0, 5).map((jobUnit, index) => [
        `${jobUnit.documentId}\u0000${jobUnit.unitId}`,
        result(jobUnit, `T${index + 1}`),
      ]),
    );

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults,
      }).previousContext,
    ).toEqual([
      { source: 'One', target: 'T1' },
      { source: 'Two', target: 'T2' },
      { source: 'Three', target: 'T3' },
      { source: 'Four', target: 'T4' },
      { source: 'Five', target: 'T5' },
    ]);
  });

  it('skips current units and previous rows without reliable targets', () => {
    const jobUnits = [
      unit(1, 'Ready'),
      unit(2, 'Empty target'),
      unit(3, 'Current A'),
      unit(4, 'Current B'),
      unit(5, 'Next'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-1',
      units: [jobUnits[2], jobUnits[3]],
    };
    const completedResults = new Map([
      [`${jobUnits[0].documentId}\u0000${jobUnits[0].unitId}`, result(jobUnits[0], 'Pret')],
      [`${jobUnits[1].documentId}\u0000${jobUnits[1].unitId}`, result(jobUnits[1], '')],
      [`${jobUnits[2].documentId}\u0000${jobUnits[2].unitId}`, result(jobUnits[2], 'Should not appear')],
    ]);

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults,
      }),
    ).toEqual({
      previousContext: [{ source: 'Ready', target: 'Pret' }],
      nextContext: [{ source: 'Next' }],
    });
  });

  it('selects up to five next source-bearing rows after the last current unit', () => {
    const jobUnits = [
      unit(1, 'Current'),
      unit(2, 'Next 1'),
      unit(3, '   '),
      unit(4, 'Next 2'),
      unit(5, 'Next 3'),
      unit(6, 'Next 4'),
      unit(7, 'Next 5'),
      unit(8, 'Next 6'),
    ];
    const task: TranslationTask = {
      taskId: 'window-task-1',
      units: [jobUnits[0]],
    };

    expect(
      buildWindowModeContext({
        task,
        jobUnits,
        currentUnits: task.units,
        completedResults: new Map(),
      }).nextContext,
    ).toEqual([
      { source: 'Next 1' },
      { source: 'Next 2' },
      { source: 'Next 3' },
      { source: 'Next 4' },
      { source: 'Next 5' },
    ]);
  });

  it('falls back to task units when the full job order is unavailable', () => {
    const current = unit(1, 'Current');
    const next = unit(2, 'Next');
    const task: TranslationTask = {
      taskId: 'ad-hoc',
      units: [current, next],
    };

    expect(
      buildWindowModeContext({
        task,
        jobUnits: [],
        currentUnits: [current],
        completedResults: new Map(),
      }).nextContext,
    ).toEqual([{ source: 'Next' }]);
  });
});

describe('mergeCompletedResults', () => {
  it('adds skipped rows with non-empty existing targets as trusted previous context inputs', () => {
    const first = unit(1, 'First');
    const skippedWithTarget = result(unit(2, 'Skipped'), 'Deja traduit', 'skipped');
    const skippedWithoutTarget = result(unit(3, 'Blank'), '', 'skipped');

    expect(
      [...mergeCompletedResults(new Map([[`${first.documentId}\u0000${first.unitId}`, result(first, 'Premier')]]), [
        skippedWithTarget,
        skippedWithoutTarget,
      ]).values()].map((item) => [item.unitId, item.target]),
    ).toEqual([
      ['row-1', 'Premier'],
      ['row-2', 'Deja traduit'],
    ]);
  });
});
```

- [ ] **Step 2: Run the failing context-window tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts
```

Expected: FAIL because `./contextWindowBuilder` does not exist.

- [ ] **Step 3: Implement unit identity helpers**

Create `packages/localization/src/requestModes/shared/unitIdentity.ts`:

```ts
import type { JobUnit, UnitResult } from '../../job/types';

export function unitKey(unit: Pick<JobUnit | UnitResult, 'documentId' | 'unitId'>): string {
  return `${unit.documentId}\u0000${unit.unitId}`;
}

export function batchResponseId(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return `${encodeURIComponent(unit.documentId)}#${encodeURIComponent(unit.unitId)}`;
}
```

- [ ] **Step 4: Implement the context-window builder**

Create `packages/localization/src/requestModes/shared/contextWindowBuilder.ts`:

```ts
import type {
  JobUnit,
  TranslationTask,
  UnitResult,
} from '../../job/types';
import { unitKey } from './unitIdentity';

export interface WindowModeContextInput {
  task: TranslationTask;
  jobUnits: JobUnit[];
  currentUnits: JobUnit[];
  completedResults: ReadonlyMap<string, UnitResult>;
  maxPreviousRows?: number;
  maxNextRows?: number;
}

export interface WindowModeContext {
  previousContext: Array<{ source: string; target: string }>;
  nextContext: Array<{ source: string }>;
}

export function mergeCompletedResults(
  completedResults: ReadonlyMap<string, UnitResult> | undefined,
  additionalResults: UnitResult[],
): Map<string, UnitResult> {
  const merged = new Map(completedResults);

  for (const result of additionalResults) {
    if (result.target?.trim()) {
      merged.set(unitKey(result), result);
    }
  }

  return merged;
}

export function buildWindowModeContext(input: WindowModeContextInput): WindowModeContext {
  const jobOrder = resolveJobOrder(input.jobUnits, input.task.units, input.currentUnits);
  const currentKeys = new Set(input.currentUnits.map(unitKey));
  const maxPreviousRows = input.maxPreviousRows ?? 5;
  const maxNextRows = input.maxNextRows ?? 5;
  let lastCurrentIndex = -1;

  for (let index = 0; index < jobOrder.length; index += 1) {
    if (currentKeys.has(unitKey(jobOrder[index]))) {
      lastCurrentIndex = index;
    }
  }

  if (lastCurrentIndex < 0) {
    return { previousContext: [], nextContext: [] };
  }

  const previousContext: Array<{ source: string; target: string }> = [];
  for (let index = lastCurrentIndex - 1; index >= 0 && previousContext.length < maxPreviousRows; index -= 1) {
    const unit = jobOrder[index];
    if (currentKeys.has(unitKey(unit))) {
      continue;
    }

    const completed = input.completedResults.get(unitKey(unit));
    const target = completed?.target;

    if (target?.trim()) {
      previousContext.push({ source: unit.source, target });
    }
  }

  const nextContext: Array<{ source: string }> = [];
  for (let index = lastCurrentIndex + 1; index < jobOrder.length && nextContext.length < maxNextRows; index += 1) {
    const source = jobOrder[index].source;

    if (source.trim()) {
      nextContext.push({ source });
    }
  }

  return {
    previousContext: previousContext.reverse(),
    nextContext,
  };
}

function resolveJobOrder(
  jobUnits: JobUnit[],
  taskUnits: JobUnit[],
  currentUnits: JobUnit[],
): JobUnit[] {
  if (jobUnits.length === 0) {
    return taskUnits;
  }

  const jobUnitKeys = new Set(jobUnits.map(unitKey));
  const allCurrentUnitsExist = currentUnits.every((unit) => jobUnitKeys.has(unitKey(unit)));

  return allCurrentUnitsExist ? jobUnits : taskUnits;
}
```

- [ ] **Step 5: Run the context-window tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit shared context helpers**

Run:

```bash
git add packages/localization/src/requestModes/shared/unitIdentity.ts packages/localization/src/requestModes/shared/contextWindowBuilder.ts packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts
git commit -m "refactor: add window mode context helper"
```

Expected: commit succeeds.

---

### Task 2: Add Shared Reference And Result Helpers

**Files:**
- Create: `packages/localization/src/requestModes/types.ts`
- Create: `packages/localization/src/requestModes/shared/references.ts`
- Create: `packages/localization/src/requestModes/shared/results.ts`
- Create: `packages/localization/src/requestModes/shared/results.test.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`

- [ ] **Step 1: Write failing tests for identity and result helpers**

Create `packages/localization/src/requestModes/shared/results.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { JobUnit, UnitResult } from '../../job/types';
import type { TranslateUnitResult } from '../../types';
import {
  buildTranslateUnitsResult,
  jobUnitToExternalUnit,
  toArtifactRecord,
  toUnitResult,
} from './results';
import { batchResponseId, unitKey } from './unitIdentity';

const jobUnit: JobUnit = {
  documentId: 'file name.xlsx',
  unitId: 'row-2',
  source: 'Hello',
  target: 'Bonjour',
  context: 'button',
  rowNumber: 2,
  sourceHash: 'hash-1',
  metadata: { rowIndex: 1, rowNumber: 2 },
};

describe('unit identity helpers', () => {
  it('builds stable internal keys and URL-safe Window Mode response ids', () => {
    expect(unitKey(jobUnit)).toBe('file name.xlsx\u0000row-2');
    expect(batchResponseId(jobUnit)).toBe('file%20name.xlsx#row-2');
  });
});

describe('result helpers', () => {
  it('converts a job unit and TranslateUnitResult into a UnitResult', () => {
    const translated: TranslateUnitResult = {
      id: 'row-2',
      source: 'Hello',
      target: 'Bonjour',
      status: 'translated',
      references: { tm: [], tb: [] },
      metadata: { rowIndex: 1 },
    };

    expect(toUnitResult('job-1', jobUnit, translated)).toEqual({
      jobId: 'job-1',
      documentId: 'file name.xlsx',
      unitId: 'row-2',
      sourceHash: 'hash-1',
      status: 'translated',
      source: 'Hello',
      target: 'Bonjour',
      error: undefined,
      references: { tm: [], tb: [] },
      metadata: { rowIndex: 1, rowNumber: 2 },
    });
  });

  it('builds artifact records without API keys', () => {
    const result: UnitResult = {
      jobId: 'job-1',
      documentId: jobUnit.documentId,
      unitId: jobUnit.unitId,
      sourceHash: jobUnit.sourceHash,
      status: 'translated',
      source: jobUnit.source,
      target: 'Bonjour',
    };

    expect(JSON.stringify(toArtifactRecord('job-1', 'task-1', jobUnit, result))).not.toMatch(/api[_-]?key/i);
  });

  it('keeps source, target, context, row number, and metadata when converting job units', () => {
    expect(jobUnitToExternalUnit(jobUnit)).toEqual({
      id: 'row-2',
      source: 'Hello',
      target: 'Bonjour',
      context: 'button',
      rowNumber: 2,
      metadata: { rowIndex: 1, rowNumber: 2 },
    });
  });

  it('summarizes translated, skipped, failed, and reused unit results', () => {
    expect(
      buildTranslateUnitsResult([
        { id: 'a', source: 'A', target: 'AA', status: 'translated' },
        { id: 'b', source: 'B', target: 'BB', status: 'skipped' },
        { id: 'c', source: 'C', error: 'boom', status: 'failed' },
        { id: 'd', source: 'D', target: 'DD', status: 'reused' },
      ]),
    ).toEqual({
      summary: { total: 4, translated: 1, skipped: 1, failed: 1, reused: 1 },
      results: [
        { id: 'a', source: 'A', target: 'AA', status: 'translated' },
        { id: 'b', source: 'B', target: 'BB', status: 'skipped' },
        { id: 'c', source: 'C', error: 'boom', status: 'failed' },
        { id: 'd', source: 'D', target: 'DD', status: 'reused' },
      ],
    });
  });
});
```

- [ ] **Step 2: Run failing result-helper tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/shared/results.test.ts
```

Expected: FAIL because `./results` does not exist.

- [ ] **Step 3: Add shared strategy types**

Create `packages/localization/src/requestModes/types.ts`:

```ts
import type { Segment } from '@cat/core/models';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../artifacts';
import type { JobUnit, UnitResult } from '../job/types';
import type { MTModule } from '../modules/MTModule';
import type { TBModule } from '../modules/TBModule';
import type { TMModule } from '../modules/TMModule';
import type { TranslateUnitReferences } from '../types';

export interface ResolvedReferences {
  engineReferences: TranslateUnitReferences;
  tm: Awaited<ReturnType<TMModule['inspect']>>;
  tb: Awaited<ReturnType<TBModule['inspect']>>;
}

export interface PreparedTranslationArtifacts {
  tm: ResolvedReferences['tm'];
  tb: ResolvedReferences['tb'];
  prompt: Awaited<ReturnType<MTModule['translate']>>['prompt'];
}

export interface PreparedWindowBatchResult {
  results: UnitResult[];
  artifacts?: import('../job/types').ArtifactRecord[];
}

export interface PreparedTranslatableJobUnit {
  jobUnit: JobUnit;
  segment: Segment;
}

export interface RequestModeReferenceModules {
  tmModule: Pick<TMModule, 'inspect'>;
  tbModule: Pick<TBModule, 'inspect'>;
}
```

- [ ] **Step 4: Add reference helpers**

Create `packages/localization/src/requestModes/shared/references.ts`:

```ts
import type { Segment } from '@cat/core/models';
import type { JobUnit } from '../../job/types';
import { mapTBEngineReferences } from '../../modules/TBModule';
import { mapTMEngineReferences } from '../../modules/TMModule';
import type { RequestModeReferenceModules, ResolvedReferences } from '../types';

export async function resolveRequestModeReferences(params: {
  projectId: number;
  segment: Segment;
  tmModule: RequestModeReferenceModules['tmModule'];
  tbModule: RequestModeReferenceModules['tbModule'];
}): Promise<ResolvedReferences> {
  const [tmMatches, tbMatches] = await Promise.all([
    params.tmModule.inspect(params.projectId, params.segment),
    params.tbModule.inspect(params.projectId, params.segment),
  ]);

  return {
    engineReferences: {
      tm: mapTMEngineReferences(tmMatches.rawMatches),
      tb: mapTBEngineReferences(tbMatches.rawMatches),
    },
    tm: tmMatches,
    tb: tbMatches,
  };
}

export function emptyReferencesForUnit(
  unit: Pick<JobUnit, 'unitId'>,
  segment: Segment,
): ResolvedReferences {
  return {
    engineReferences: {
      tm: [],
      tb: [],
    },
    tm: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
      mountedTMs: [],
      rawMatches: [],
      selectedReferences: {
        tmReferences: [],
        concordanceReferences: [],
      },
      selectionPolicy: {
        maxTmReferences: 0,
        maxConcordanceReferences: 0,
      },
      diagnostics: [],
    },
    tb: {
      unitId: unit.unitId,
      segmentId: segment.segmentId,
      mountedTBs: [],
      rawMatches: [],
      selectedReferences: [],
      selectionPolicy: {
        maxTbReferences: 0,
      },
      diagnostics: [],
    },
  };
}
```

- [ ] **Step 5: Add result helpers**

Create `packages/localization/src/requestModes/shared/results.ts`:

```ts
import type {
  ArtifactRecord,
  JobUnit,
  TranslationTask,
  UnitResult,
  UnitResultStatus,
} from '../../job/types';
import type {
  ExternalTranslationUnit,
  TranslateUnitResult,
  TranslateUnitsResult,
} from '../../types';
import type { PreparedTranslationArtifacts } from '../types';

export function jobUnitToExternalUnit(unit: {
  unitId: string;
  source: string;
  target?: string;
  context?: string;
  rowNumber?: number;
  metadata?: Record<string, unknown>;
}): ExternalTranslationUnit {
  return {
    id: unit.unitId,
    source: unit.source,
    target: unit.target,
    context: unit.context,
    rowNumber: unit.rowNumber,
    metadata: unit.metadata,
  };
}

export function toUnitResult(
  jobId: string,
  unit: TranslationTask['units'][number],
  result: TranslateUnitResult,
): UnitResult {
  return {
    jobId,
    documentId: unit.documentId,
    unitId: unit.unitId,
    sourceHash: unit.sourceHash,
    status: result.status as UnitResultStatus,
    source: unit.source,
    target: result.target,
    error: result.status === 'failed' ? result.error : undefined,
    references: result.references,
    metadata: unit.metadata,
  };
}

export function toArtifactRecord(
  jobId: string,
  taskId: string,
  unit: TranslationTask['units'][number],
  result: UnitResult,
  artifacts?: PreparedTranslationArtifacts,
): ArtifactRecord {
  return {
    job: jobId,
    task: taskId,
    doc: unit.documentId,
    unit: unit.unitId,
    tm: artifacts?.tm,
    tb: artifacts?.tb,
    prompt: artifacts?.prompt,
    result,
    error: result.error,
    at: new Date().toISOString(),
  };
}

export function buildTranslateUnitsResult(results: TranslateUnitResult[]): TranslateUnitsResult {
  const reused = results.filter((result) => result.status === 'reused').length;
  const summary: TranslateUnitsResult['summary'] = {
    total: results.length,
    translated: results.filter((result) => result.status === 'translated').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    failed: results.filter((result) => result.status === 'failed').length,
  };

  if (reused > 0) {
    summary.reused = reused;
  }

  return { summary, results };
}
```

- [ ] **Step 6: Move duplicate helper imports in `LocalizationEngine.ts` without changing behavior**

Modify `packages/localization/src/LocalizationEngine.ts` imports:

```ts
import { batchResponseId, unitKey } from './requestModes/shared/unitIdentity';
import {
  buildTranslateUnitsResult,
  jobUnitToExternalUnit,
  toArtifactRecord,
  toUnitResult,
} from './requestModes/shared/results';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from './requestModes/shared/references';
import type {
  PreparedTranslationArtifacts,
  PreparedWindowBatchResult,
  ResolvedReferences,
} from './requestModes/types';
```

Then replace the body of `resolveReferences` with:

```ts
  private async resolveReferences(
    projectId: number,
    segment: Segment,
  ): Promise<ResolvedReferences> {
    return resolveRequestModeReferences({
      projectId,
      segment,
      tmModule: this.tmModule,
      tbModule: this.tbModule,
    });
  }
```

Delete the now-duplicated bottom-level functions from `LocalizationEngine.ts`:

```ts
emptyReferencesForUnit
unitKey
batchResponseId
jobUnitToExternalUnit
toUnitResult
toArtifactRecord
buildTranslateUnitsResult
```

Keep these functions in `LocalizationEngine.ts` for now because they are still engine-specific:

```ts
mergeMTOptions
hashCanonicalPayload
compareResourceFingerprint
```

- [ ] **Step 7: Run result-helper and engine tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/shared/results.test.ts packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit shared reference/result helpers**

Run:

```bash
git add packages/localization/src/requestModes/types.ts packages/localization/src/requestModes/shared/references.ts packages/localization/src/requestModes/shared/results.ts packages/localization/src/requestModes/shared/results.test.ts packages/localization/src/LocalizationEngine.ts
git commit -m "refactor: extract request mode shared helpers"
```

Expected: commit succeeds.

---

### Task 3: Extract Window Mode Sequential Batch Strategy

**Files:**
- Create: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
- Create: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`

- [ ] **Step 1: Write failing Window Mode strategy tests**

Create `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`:

```ts
import { parseEditorTextToTokens } from '@cat/core/tag';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import type { Segment } from '@cat/core/models';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../../artifacts';
import type { JobUnit, TaskExecutionContext, TranslationTask } from '../../job/types';
import type { MTBatchTranslateResult, ResolvedMTConfig } from '../../modules/MTModule';
import { createTransientSegment } from '../../transientSegment';
import { WindowModeSequentialBatchStrategy } from './WindowModeSequentialBatchStrategy';

function project(projectType: Project['projectType'] = 'translation'): Project {
  return {
    id: 1,
    name: 'Window Project',
    srcLang: 'en',
    tgtLang: 'fr',
    projectType,
    aiPrompt: '',
  } as Project;
}

function jobUnit(row: number, source: string, target = ''): JobUnit {
  return {
    documentId: 'window.xlsx',
    unitId: `row-${row}`,
    source,
    target,
    sourceHash: `hash-${row}`,
    metadata: { rowNumber: row },
  };
}

function segment(unit: JobUnit, index: number): Segment {
  return createTransientSegment(
    {
      id: unit.unitId,
      source: unit.source,
      target: unit.target,
      metadata: unit.metadata,
    },
    index,
    {
      projectId: 1,
      sourceLanguage: 'en',
      targetLanguage: 'fr',
    },
  );
}

function tm(unitId: string): TMArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: {
      tmReferences: [],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 0,
      maxConcordanceReferences: 0,
    },
    diagnostics: [],
  };
}

function tb(unitId: string): TBArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: {
      maxTbReferences: 0,
    },
    diagnostics: [],
  };
}

function promptArtifact(): PromptArtifact {
  return {
    unitId: 'batch',
    provider: { id: 'mock', name: 'Mock', baseUrl: 'https://mock.local' },
    model: 'mock-model',
    reasoningEffort: 'medium',
    projectPrompt: '',
    projectType: 'translation',
    sourcePayload: '',
    tmPromptBlock: '',
    concordancePromptBlock: '',
    tbPromptBlock: '',
    referencePromptBlock: '',
    systemPrompt: 'system',
    userPrompt: 'user',
    promptChars: { system: 6, user: 4, total: 10 },
    batch: {
      mode: 'window',
      taskId: 'window-task-1',
      currentIds: ['window.xlsx#row-2'],
      previousContextCount: 1,
      nextContextCount: 1,
    },
  };
}

function mtConfig(): ResolvedMTConfig {
  return {
    provider: {
      id: 'mock',
      name: 'Mock',
      baseUrl: 'https://mock.local',
      model: 'mock-model',
      protocol: 'chat-completions',
      kind: 'custom',
      apiKeyLast4: '1234',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    },
    apiKey: 'secret-key',
    model: 'mock-model',
    reasoningEffort: 'medium',
  };
}

describe('WindowModeSequentialBatchStrategy', () => {
  it('passes per-current-unit references and context windows to MTModule and maps results back to unit results', async () => {
    const previous = jobUnit(1, 'Open');
    const current = jobUnit(2, 'Hello');
    const next = jobUnit(3, 'Save');
    const currentSegment = segment(current, 0);
    const translateBatch = vi.fn().mockImplementation(async (input): Promise<MTBatchTranslateResult> => ({
      results: [
        {
          documentId: 'window.xlsx',
          unitId: 'row-2',
          responseId: 'window.xlsx#row-2',
          targetTokens: parseEditorTextToTokens('Bonjour', currentSegment.sourceTokens),
        },
      ],
      prompt: promptArtifact(),
    }));
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: { inspect: vi.fn().mockResolvedValue(tm('row-2')) },
      tbModule: { inspect: vi.fn().mockResolvedValue(tb('row-2')) },
      mtModule: { translateBatch },
    });
    const task: TranslationTask = { taskId: 'window-task-1', units: [current] };
    const context: TaskExecutionContext = {
      job: {
        id: 'job-1',
        projectId: 1,
        units: [previous, current, next],
      },
      attempt: 1,
      captureArtifacts: true,
      completedResults: new Map([
        [
          'window.xlsx\u0000row-1',
          {
            jobId: 'job-1',
            documentId: 'window.xlsx',
            unitId: 'row-1',
            sourceHash: 'hash-1',
            status: 'translated',
            source: 'Open',
            target: 'Ouvrir',
          },
        ],
      ]),
    };

    const result = await strategy.translate({
      task,
      context,
      project: project(),
      mtConfig: mtConfig(),
      mtOptions: {},
      includeReferences: true,
      captureArtifacts: true,
      translatableUnits: [{ jobUnit: current, segment: currentSegment }],
      skippedResults: [],
    });

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        current: [
          expect.objectContaining({
            responseId: 'window.xlsx#row-2',
            documentId: 'window.xlsx',
            unitId: 'row-2',
            tm: expect.objectContaining({ unitId: 'row-2' }),
            tb: expect.objectContaining({ unitId: 'row-2' }),
          }),
        ],
        previousContext: [{ source: 'Open', target: 'Ouvrir' }],
        nextContext: [{ source: 'Save' }],
      }),
    );
    expect(result.results).toEqual([
      expect.objectContaining({
        jobId: 'job-1',
        documentId: 'window.xlsx',
        unitId: 'row-2',
        source: 'Hello',
        target: 'Bonjour',
        status: 'translated',
        references: { tm: [], tb: [] },
      }),
    ]);
    expect(result.artifacts).toEqual([
      expect.objectContaining({
        job: 'job-1',
        task: 'window-task-1',
        doc: 'window.xlsx',
        unit: 'row-2',
        prompt: expect.objectContaining({ userPrompt: 'user' }),
      }),
    ]);
    expect(JSON.stringify(result.artifacts)).not.toMatch(/secret-key/);
  });

  it('includes skipped rows with existing targets in previous context', async () => {
    const skipped = jobUnit(1, 'Middle', 'Milieu');
    const current = jobUnit(2, 'Last');
    const currentSegment = segment(current, 0);
    const translateBatch = vi.fn().mockResolvedValue({
      results: [
        {
          documentId: 'window.xlsx',
          unitId: 'row-2',
          responseId: 'window.xlsx#row-2',
          targetTokens: parseEditorTextToTokens('Dernier', currentSegment.sourceTokens),
        },
      ],
      prompt: promptArtifact(),
    });
    const strategy = new WindowModeSequentialBatchStrategy({
      tmModule: { inspect: vi.fn().mockResolvedValue(tm('row-2')) },
      tbModule: { inspect: vi.fn().mockResolvedValue(tb('row-2')) },
      mtModule: { translateBatch },
    });

    await strategy.translate({
      task: { taskId: 'window-task-1', units: [current] },
      context: {
        job: { id: 'job-1', projectId: 1, units: [skipped, current] },
        attempt: 1,
        captureArtifacts: false,
      },
      project: project(),
      mtConfig: mtConfig(),
      mtOptions: {},
      includeReferences: false,
      captureArtifacts: false,
      translatableUnits: [{ jobUnit: current, segment: currentSegment }],
      skippedResults: [
        {
          jobId: 'job-1',
          documentId: skipped.documentId,
          unitId: skipped.unitId,
          sourceHash: skipped.sourceHash,
          status: 'skipped',
          source: skipped.source,
          target: skipped.target,
        },
      ],
    });

    expect(translateBatch).toHaveBeenCalledWith(
      expect.objectContaining({
        previousContext: [{ source: 'Middle', target: 'Milieu' }],
      }),
    );
  });
});
```

- [ ] **Step 2: Run the failing Window Mode strategy tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts
```

Expected: FAIL because `WindowModeSequentialBatchStrategy.ts` does not exist.

- [ ] **Step 3: Implement `WindowModeSequentialBatchStrategy`**

Create `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`:

```ts
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type {
  ArtifactRecord,
  JobUnit,
  TaskExecutionContext,
  TranslationTask,
  UnitResult,
} from '../../job/types';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import type { LocalizationEngineOptions } from '../../types';
import {
  buildWindowModeContext,
  mergeCompletedResults,
} from '../shared/contextWindowBuilder';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from '../shared/references';
import { toArtifactRecord } from '../shared/results';
import { batchResponseId } from '../shared/unitIdentity';
import type {
  PreparedTranslatableJobUnit,
  PreparedWindowBatchResult,
  RequestModeReferenceModules,
} from '../types';

export interface WindowModeSequentialBatchStrategyDependencies extends RequestModeReferenceModules {
  mtModule: Pick<import('../../modules/MTModule').MTModule, 'translateBatch'>;
}

export interface WindowModeSequentialBatchStrategyInput {
  task: TranslationTask;
  context: TaskExecutionContext;
  project: Project;
  mtConfig: ResolvedMTConfig;
  mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
  includeReferences: boolean;
  captureArtifacts: boolean;
  translatableUnits: PreparedTranslatableJobUnit[];
  skippedResults: UnitResult[];
}

export class WindowModeSequentialBatchStrategy {
  private readonly modules: WindowModeSequentialBatchStrategyDependencies;

  constructor(modules: WindowModeSequentialBatchStrategyDependencies) {
    this.modules = modules;
  }

  async translate(input: WindowModeSequentialBatchStrategyInput): Promise<PreparedWindowBatchResult> {
    const projectType = input.project.projectType ?? 'translation';
    const resolvedUnits = await Promise.all(
      input.translatableUnits.map(async ({ jobUnit, segment }) => {
        const references =
          projectType === 'translation'
            ? await resolveRequestModeReferences({
                projectId: input.project.id,
                segment,
                tmModule: this.modules.tmModule,
                tbModule: this.modules.tbModule,
              })
            : emptyReferencesForUnit(jobUnit, segment);

        return { jobUnit, segment, references };
      }),
    );
    const current = resolvedUnits.map(({ jobUnit, segment, references }) => ({
      responseId: batchResponseId(jobUnit),
      documentId: jobUnit.documentId,
      unitId: jobUnit.unitId,
      segment,
      tm: references.tm,
      tb: references.tb,
      context: jobUnit.context,
    }));
    const completedResults = mergeCompletedResults(
      input.context.completedResults,
      input.skippedResults,
    );
    const { previousContext, nextContext } = buildWindowModeContext({
      task: input.task,
      jobUnits: input.context.job.units,
      currentUnits: resolvedUnits.map((unit) => unit.jobUnit),
      completedResults,
    });
    const meta = current[0]?.segment.meta as
      | (Segment['meta'] & { sourceLanguage?: unknown; targetLanguage?: unknown })
      | undefined;
    const batch = await this.modules.mtModule.translateBatch({
      taskId: input.task.taskId,
      project: input.project,
      current,
      previousContext,
      nextContext,
      mtOptions: input.mtOptions,
      apiKey: input.mtConfig.apiKey,
      baseUrl: input.mtConfig.provider.baseUrl,
      model: input.mtConfig.model,
      reasoningEffort: input.mtConfig.reasoningEffort,
      provider: input.mtConfig.provider,
      srcLang: meta?.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta?.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
    });
    const batchResultsByResponseId = new Map(
      batch.results.map((result) => [result.responseId, result]),
    );
    const results: UnitResult[] = [];
    const artifacts: ArtifactRecord[] | undefined = input.captureArtifacts ? [] : undefined;

    for (const { jobUnit, references } of resolvedUnits) {
      const batchResult = batchResultsByResponseId.get(batchResponseId(jobUnit));
      if (!batchResult) {
        throw new Error(`MT batch did not return a result for unit: ${jobUnit.unitId}`);
      }

      const result: UnitResult = {
        jobId: input.context.job.id,
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        sourceHash: jobUnit.sourceHash,
        status: 'translated',
        source: jobUnit.source,
        target: serializeTokensToDisplayText(batchResult.targetTokens),
        references: input.includeReferences ? references.engineReferences : undefined,
        metadata: jobUnit.metadata,
      };
      results.push(result);
      artifacts?.push(
        toArtifactRecord(input.context.job.id, input.task.taskId, jobUnit, result, {
          tm: references.tm,
          tb: references.tb,
          prompt: batch.prompt,
        }),
      );
    }

    return { results, artifacts };
  }
}
```

- [ ] **Step 4: Wire `LocalizationEngine` to instantiate the strategy**

Modify `packages/localization/src/LocalizationEngine.ts`:

```ts
import { WindowModeSequentialBatchStrategy } from './requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy';
```

Add a private field:

```ts
  private readonly windowModeStrategy: WindowModeSequentialBatchStrategy;
```

Instantiate it at the end of the constructor after `this.mtModule` is assigned:

```ts
    this.windowModeStrategy = new WindowModeSequentialBatchStrategy({
      tmModule: this.tmModule,
      tbModule: this.tbModule,
      mtModule: this.mtModule,
    });
```

Replace the call in `executeTranslationTask`:

```ts
    const translated = await this.windowModeStrategy.translate({
      task,
      context,
      project,
      mtConfig,
      mtOptions,
      includeReferences: Boolean(translationOptions?.includeReferences),
      captureArtifacts,
      translatableUnits: translatableUnits.map(({ jobUnit, prepared }) => ({
        jobUnit,
        segment: prepared.segment,
      })),
      skippedResults,
    });
```

- [ ] **Step 5: Delete private Window Mode methods from `LocalizationEngine.ts`**

Delete these private methods from `packages/localization/src/LocalizationEngine.ts`:

```ts
translatePreparedWindowBatchWithArtifacts
buildPreviousTranslatedContext
buildNextSourceContext
```

Also delete the now-unused type aliases and imports:

```ts
MTBatchCurrentUnitInput
PreparedWindowBatchResult
```

Keep `translatePreparedUnitWithArtifacts` until Task 4 moves legacy single-unit execution.

- [ ] **Step 6: Run Window Mode strategy and engine tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit Window Mode strategy extraction**

Run:

```bash
git add packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/LocalizationEngine.ts
git commit -m "refactor: extract window mode request strategy"
```

Expected: commit succeeds.

---

### Task 4: Extract Legacy Single-Unit Concurrent Strategy

**Files:**
- Create: `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`
- Create: `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Write failing legacy strategy tests**

Create `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts`:

```ts
import { parseEditorTextToTokens } from '@cat/core/tag';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import type { Segment } from '@cat/core/models';
import type { PromptArtifact, TBArtifact, TMArtifact } from '../../artifacts';
import type { MTTranslateResult, ResolvedMTConfig } from '../../modules/MTModule';
import { createTransientSegment } from '../../transientSegment';
import type { ExternalTranslationUnit } from '../../types';
import { LegacySingleUnitConcurrentStrategy } from './LegacySingleUnitConcurrentStrategy';

function project(projectType: Project['projectType'] = 'translation'): Project {
  return {
    id: 1,
    name: 'Legacy Project',
    srcLang: 'en',
    tgtLang: 'fr',
    projectType,
    aiPrompt: '',
  } as Project;
}

function externalUnit(id: string, source: string): ExternalTranslationUnit {
  return { id, source, metadata: { id } };
}

function segmentFor(unit: ExternalTranslationUnit, index: number): Segment {
  return createTransientSegment(unit, index, {
    projectId: 1,
    sourceLanguage: 'en',
    targetLanguage: 'fr',
  });
}

function tm(unitId: string): TMArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: {
      tmReferences: [],
      concordanceReferences: [],
    },
    selectionPolicy: {
      maxTmReferences: 0,
      maxConcordanceReferences: 0,
    },
    diagnostics: [],
  };
}

function tb(unitId: string): TBArtifact {
  return {
    unitId,
    segmentId: `segment-${unitId}`,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: {
      maxTbReferences: 0,
    },
    diagnostics: [],
  };
}

function promptArtifact(unitId: string): PromptArtifact {
  return {
    unitId,
    provider: { id: 'mock', name: 'Mock', baseUrl: 'https://mock.local' },
    model: 'mock-model',
    reasoningEffort: 'medium',
    projectPrompt: '',
    projectType: 'translation',
    sourcePayload: '',
    tmPromptBlock: '',
    concordancePromptBlock: '',
    tbPromptBlock: '',
    referencePromptBlock: '',
    systemPrompt: 'system',
    userPrompt: 'user',
    promptChars: { system: 6, user: 4, total: 10 },
  };
}

function mtConfig(): ResolvedMTConfig {
  return {
    provider: {
      id: 'mock',
      name: 'Mock',
      baseUrl: 'https://mock.local',
      model: 'mock-model',
      protocol: 'chat-completions',
      kind: 'custom',
      apiKeyLast4: '1234',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    },
    apiKey: 'secret-key',
    model: 'mock-model',
    reasoningEffort: 'medium',
  };
}

describe('LegacySingleUnitConcurrentStrategy', () => {
  it('translates each unit with single-unit MT prompts and preserves input order', async () => {
    const units = [externalUnit('unit-1', 'Hello'), externalUnit('unit-2', 'Save')];
    const segments = units.map(segmentFor);
    const translate = vi.fn().mockImplementation(async (input): Promise<MTTranslateResult> => ({
      targetTokens: parseEditorTextToTokens(
        input.unitId === 'unit-1' ? 'Bonjour' : 'Enregistrer',
        input.segment.sourceTokens,
      ),
      prompt: promptArtifact(input.unitId),
    }));
    const strategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: { inspect: vi.fn().mockImplementation((_projectId, inputSegment) => tm(inputSegment.segmentId)) },
      tbModule: { inspect: vi.fn().mockImplementation((_projectId, inputSegment) => tb(inputSegment.segmentId)) },
      mtModule: { translate },
    });

    const result = await strategy.translateUnits({
      project: project(),
      mtConfig: mtConfig(),
      mtOptions: {},
      includeReferences: true,
      maxConcurrency: 2,
      units: [
        { unit: units[0], segment: segments[0] },
        { unit: units[1], segment: segments[1] },
      ],
    });

    expect(translate).toHaveBeenCalledTimes(2);
    expect(result.results.map((item) => [item.id, item.target, item.status])).toEqual([
      ['unit-1', 'Bonjour', 'translated'],
      ['unit-2', 'Enregistrer', 'translated'],
    ]);
    expect(result.results[0].references).toEqual({ tm: [], tb: [] });
  });

  it('returns failed results for rejected single-unit requests without throwing the whole batch', async () => {
    const units = [externalUnit('unit-1', 'Hello'), externalUnit('unit-2', 'Save')];
    const segments = units.map(segmentFor);
    const strategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: { inspect: vi.fn().mockImplementation((_projectId, inputSegment) => tm(inputSegment.segmentId)) },
      tbModule: { inspect: vi.fn().mockImplementation((_projectId, inputSegment) => tb(inputSegment.segmentId)) },
      mtModule: {
        translate: vi
          .fn()
          .mockResolvedValueOnce({
            targetTokens: parseEditorTextToTokens('Bonjour', segments[0].sourceTokens),
            prompt: promptArtifact('unit-1'),
          })
          .mockRejectedValueOnce(new Error('provider failed')),
      },
    });

    const result = await strategy.translateUnits({
      project: project(),
      mtConfig: mtConfig(),
      mtOptions: {},
      includeReferences: false,
      maxConcurrency: 2,
      units: [
        { unit: units[0], segment: segments[0] },
        { unit: units[1], segment: segments[1] },
      ],
    });

    expect(result.summary).toEqual({ total: 2, translated: 1, skipped: 0, failed: 1 });
    expect(result.results[1]).toEqual({
      id: 'unit-2',
      source: 'Save',
      target: undefined,
      status: 'failed',
      error: 'provider failed',
      metadata: { id: 'unit-2' },
    });
  });
});
```

- [ ] **Step 2: Run failing legacy strategy tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts
```

Expected: FAIL because `LegacySingleUnitConcurrentStrategy.ts` does not exist.

- [ ] **Step 3: Implement `LegacySingleUnitConcurrentStrategy`**

Create `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`:

```ts
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { ResolvedMTConfig } from '../../modules/MTModule';
import { runBounded } from '../../RequestScheduler';
import type {
  ExternalTranslationUnit,
  LocalizationEngineOptions,
  TranslateUnitResult,
  TranslateUnitsResult,
} from '../../types';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from '../shared/references';
import { buildTranslateUnitsResult } from '../shared/results';
import type { RequestModeReferenceModules, ResolvedReferences } from '../types';

export interface LegacySingleUnitConcurrentStrategyDependencies extends RequestModeReferenceModules {
  mtModule: Pick<import('../../modules/MTModule').MTModule, 'translate'>;
}

export interface PreparedLegacyUnit {
  unit: ExternalTranslationUnit;
  segment: Segment;
}

export interface LegacySingleUnitConcurrentStrategyInput {
  project: Project;
  mtConfig: ResolvedMTConfig;
  mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
  includeReferences: boolean;
  maxConcurrency?: number;
  units: PreparedLegacyUnit[];
}

export class LegacySingleUnitConcurrentStrategy {
  private readonly modules: LegacySingleUnitConcurrentStrategyDependencies;

  constructor(modules: LegacySingleUnitConcurrentStrategyDependencies) {
    this.modules = modules;
  }

  async translateUnits(input: LegacySingleUnitConcurrentStrategyInput): Promise<TranslateUnitsResult> {
    const scheduledResults = await runBounded(
      input.units,
      async (prepared) =>
        this.translatePreparedUnit({
          ...input,
          unit: prepared.unit,
          segment: prepared.segment,
        }),
      { maxConcurrency: input.maxConcurrency },
    );

    const results = scheduledResults.map((result, index): TranslateUnitResult => {
      const unit = input.units[index].unit;
      if (result.status === 'fulfilled') {
        return result.value;
      }

      return {
        id: unit.id,
        source: unit.source,
        target: unit.target,
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        metadata: unit.metadata,
      };
    });

    return buildTranslateUnitsResult(results);
  }

  private async translatePreparedUnit(params: LegacySingleUnitConcurrentStrategyInput & PreparedLegacyUnit): Promise<TranslateUnitResult> {
    const projectType = params.project.projectType ?? 'translation';
    const references: ResolvedReferences =
      projectType === 'translation'
        ? await resolveRequestModeReferences({
            projectId: params.project.id,
            segment: params.segment,
            tmModule: this.modules.tmModule,
            tbModule: this.modules.tbModule,
          })
        : emptyReferencesForUnit({ unitId: params.unit.id }, params.segment);

    const { targetTokens } = await this.modules.mtModule.translate({
      unitId: params.unit.id,
      project: params.project,
      segment: params.segment,
      tm: references.tm,
      tb: references.tb,
      mtOptions: params.mtOptions,
      apiKey: params.mtConfig.apiKey,
      baseUrl: params.mtConfig.provider.baseUrl,
      model: params.mtConfig.model,
      reasoningEffort: params.mtConfig.reasoningEffort,
      provider: params.mtConfig.provider,
      srcLang: params.unit.sourceLanguage ?? params.project.srcLang,
      tgtLang: params.unit.targetLanguage ?? params.project.tgtLang,
    });

    return {
      id: params.unit.id,
      source: params.unit.source,
      target: serializeTokensToDisplayText(targetTokens),
      status: 'translated',
      references: params.includeReferences ? references.engineReferences : undefined,
      metadata: params.unit.metadata,
    };
  }
}
```

- [ ] **Step 4: Wire `LocalizationEngine.translateUnits` to the legacy strategy**

Modify `packages/localization/src/LocalizationEngine.ts` imports:

```ts
import { LegacySingleUnitConcurrentStrategy } from './requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy';
```

Add a private field:

```ts
  private readonly legacyStrategy: LegacySingleUnitConcurrentStrategy;
```

Instantiate it in the constructor:

```ts
    this.legacyStrategy = new LegacySingleUnitConcurrentStrategy({
      tmModule: this.tmModule,
      tbModule: this.tbModule,
      mtModule: this.mtModule,
    });
```

Replace the existing `runBounded` block in `translateUnits` with:

```ts
    const legacyResult = await this.legacyStrategy.translateUnits({
      project,
      mtConfig,
      mtOptions,
      includeReferences: Boolean(input.options?.includeReferences),
      maxConcurrency,
      units: preparedUnits.flatMap((prepared) =>
        prepared.kind === 'translatable'
          ? [{ unit: prepared.unit, segment: prepared.segment }]
          : [],
      ),
    });
    const translatedById = new Map(legacyResult.results.map((result) => [result.id, result]));

    const results = preparedUnits.map((prepared): TranslateUnitResult => {
      if (prepared.kind === 'skipped') {
        return prepared.result;
      }

      const translated = translatedById.get(prepared.unit.id);
      if (!translated) {
        return {
          id: prepared.unit.id,
          source: prepared.unit.source,
          target: prepared.unit.target,
          status: 'failed',
          error: `Legacy MT strategy did not return a result for unit: ${prepared.unit.id}`,
          metadata: prepared.unit.metadata,
        };
      }
      return translated;
    });

    return buildTranslateUnitsResult(results);
```

Remove these now-unused imports from `LocalizationEngine.ts`:

```ts
runBounded
```

Keep this import in `LocalizationEngine.ts` because `prepareUnit` still uses it:

```ts
serializeTokensToDisplayText
```

- [ ] **Step 5: Add one engine-level concurrency regression test**

Append this test inside `describe('LocalizationEngine.translateUnits', ...)` in `packages/localization/src/LocalizationEngine.test.ts`:

```ts
  it('keeps legacy translateUnits on bounded single-unit concurrency', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Legacy Concurrency', 'en', 'fr');
      seedApiKey(db);
      let active = 0;
      let maxActive = 0;
      const transport = createTransport();
      transport.createResponse.mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await delay(20);
        active -= 1;
        return {
          content: 'Bonjour',
          status: 200,
          endpoint: '/mock',
        };
      });
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await engine.translateUnits({
        projectId,
        units: [
          { id: 'unit-1', source: 'Hello 1' },
          { id: 'unit-2', source: 'Hello 2' },
          { id: 'unit-3', source: 'Hello 3' },
        ],
        options: { maxConcurrency: 2 },
      });

      expect(transport.createResponse).toHaveBeenCalledTimes(3);
      expect(maxActive).toBe(2);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 6: Run legacy strategy and engine tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts packages/localization/src/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit legacy strategy extraction**

Run:

```bash
git add packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.test.ts packages/localization/src/LocalizationEngine.ts packages/localization/src/LocalizationEngine.test.ts
git commit -m "refactor: extract legacy mt request strategy"
```

Expected: commit succeeds.

---

### Task 5: Make LocalizationInspector Reuse Shared Window Context

**Files:**
- Modify: `packages/localization/src/LocalizationInspector.ts`
- Modify: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Run existing inspector tests as the pre-change baseline**

Run:

```bash
npx vitest run packages/localization/src/LocalizationInspector.test.ts
```

Expected: PASS before editing.

- [ ] **Step 2: Add a focused inspector regression for helper-equivalent previous context**

Append this test inside `describe('LocalizationInspector.inspectFile', ...)` in `packages/localization/src/LocalizationInspector.test.ts`:

```ts
  it('uses the shared Window Mode context rules for previous translated rows', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Shared Context Inspect', 'en', 'fr');
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Open', 'Ouvrir'],
        ['Blank target', ''],
        ['Current A', ''],
        ['Current B', ''],
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
      const currentA = json.units.find(
        (unit: { unit: { source: string } }) => unit.unit.source === 'Current A',
      );

      expect(currentA.mt.userPrompt).toContain('Previous 5 translated rows');
      expect(currentA.mt.userPrompt).toContain('Open -> Ouvrir');
      expect(currentA.mt.userPrompt).not.toContain('Blank target ->');
      expect(currentA.mt.userPrompt).not.toMatch(/^id: row-2$/m);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 3: Run the inspector tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationInspector.test.ts
```

Expected: PASS before helper swap, because current local helper already has this behavior.

- [ ] **Step 4: Replace local inspector context helpers with shared helper**

Modify `packages/localization/src/LocalizationInspector.ts`.

Add imports:

```ts
import { computeSourceHash } from './job/sourceHash';
import type { JobUnit, TranslationTask } from './job/types';
import { buildWindowModeContext } from './requestModes/shared/contextWindowBuilder';
```

Add helper functions near `rowToUnit`:

```ts
function readyRowsToJobUnits(
  rows: FileParseRowArtifact[],
  documentId: string,
): JobUnit[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      documentId,
      unitId: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      rowNumber: row.rowNumber,
      sourceHash: computeSourceHash({
        source: row.source,
        context: row.context,
        resumeFingerprint: 'inspect',
      }),
      metadata: {
        rowIndex: row.rowIndex,
        rowNumber: row.rowNumber,
      },
    }));
}

function buildInspectWindowContext(
  rows: FileParseRowArtifact[],
  currentRows: InspectReadyRow[],
  documentId: string,
): ReturnType<typeof buildWindowModeContext> {
  const jobUnits = readyRowsToJobUnits(rows, documentId);
  const jobUnitsByUnitId = new Map(jobUnits.map((unit) => [unit.unitId, unit]));
  const currentUnits = currentRows.flatMap((row) => {
    const unit = jobUnitsByUnitId.get(row.row.unitId);
    return unit ? [unit] : [];
  });
  const completedResults = new Map(
    jobUnits
      .filter((unit) => unit.target?.trim())
      .map((unit) => [
        `${unit.documentId}\u0000${unit.unitId}`,
        {
          jobId: 'inspect',
          documentId: unit.documentId,
          unitId: unit.unitId,
          sourceHash: unit.sourceHash,
          status: 'skipped' as const,
          source: unit.source,
          target: unit.target,
          metadata: unit.metadata,
        },
      ]),
  );
  const task: TranslationTask = {
    taskId: 'inspect-window-context',
    units: currentUnits,
  };

  return buildWindowModeContext({
    task,
    jobUnits,
    currentUnits,
    completedResults,
  });
}
```

Replace this existing `composeBatchPrompt` context input:

```ts
          previousContext: buildPreviousTranslatedContext(contextRows, readyRows),
          nextContext: buildNextSourceContext(contextRows, readyRows),
```

with:

```ts
          ...buildInspectWindowContext(contextRows, readyRows, inputDocumentId),
```

Delete local functions:

```ts
buildPreviousTranslatedContext
buildNextSourceContext
```

- [ ] **Step 5: Run inspector tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationInspector.test.ts packages/localization/src/requestModes/shared/contextWindowBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit inspector helper reuse**

Run:

```bash
git add packages/localization/src/LocalizationInspector.ts packages/localization/src/LocalizationInspector.test.ts
git commit -m "refactor: reuse window context helper in inspector"
```

Expected: commit succeeds.

---

### Task 6: Run Package-Level Verification

**Files:**
- Modify only if a verification failure points to a missed import or stale type.

- [ ] **Step 1: Run targeted request mode tests**

Run:

```bash
npx vitest run packages/localization/src/requestModes packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts packages/localization/src/modules/MTModule.test.ts packages/core/src/project/windowModePrompt.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the localization package build**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: PASS with TypeScript build and bundle output.

- [ ] **Step 3: Run architecture guardrails**

Run:

```bash
npm run gate:arch
```

Expected: PASS. No file under `packages/localization/src` imports `apps/desktop`.

- [ ] **Step 4: Inspect `LocalizationEngine.ts` for removed Window Mode-specific methods**

Run:

```bash
rg -n "translatePreparedWindowBatchWithArtifacts|buildPreviousTranslatedContext|buildNextSourceContext" packages/localization/src/LocalizationEngine.ts
```

Expected: no matches.

- [ ] **Step 5: Inspect request mode naming**

Run:

```bash
rg -n "LegacySingleUnitConcurrentStrategy|WindowModeSequentialBatchStrategy|BatchMode" packages/localization/src/requestModes packages/localization/src/LocalizationEngine.ts
```

Expected: matches for the two strategy names; no misleading `BatchMode` name for legacy single-unit concurrent mode.

- [ ] **Step 6: Commit verification-only fixes if any were needed**

If Step 1, Step 2, Step 3, Step 4, and Step 5 all passed without edits, skip this commit.

If a small import/type fix was required, run:

```bash
git add packages/localization/src
git commit -m "fix: resolve request strategy verification issues"
```

Expected: commit succeeds only when there were actual code changes.

---

### Task 7: Run Inspect Smoke With Real Nikki Project

**Files:**
- No source edits.
- Generated smoke outputs should be written under `D:\cat\momocat\.tmp\window-mode-strategy-smoke\`.

- [ ] **Step 1: Create the smoke output directory**

Run:

```powershell
New-Item -ItemType Directory -Force -Path .tmp\window-mode-strategy-smoke
```

Expected: directory exists.

- [ ] **Step 2: Find the Nikki project id**

Run:

```powershell
$projectId = & 'C:\Program Files\nodejs\node.exe' -e "const Database=require('better-sqlite3'); const db=new Database(process.argv[1],{readonly:true}); const row=db.prepare('select id,name,srcLang,tgtLang from projects where name=?').get('Nikki(zh-fr)'); db.close(); if(!row) throw new Error('Project not found: Nikki(zh-fr)'); console.log(row.id);" "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db"
if (-not $projectId) { throw 'Project id lookup failed.' }
$projectId
```

Expected: prints a numeric project id for `Nikki(zh-fr)` and stores it in `$projectId` for Step 3 and Step 5.

- [ ] **Step 3: Run inspect smoke**

Run this command with the project id from Step 2:

```powershell
npm run inspect:localization -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id $projectId --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output ".tmp\window-mode-strategy-smoke\inspect.xlsx" --json-output ".tmp\window-mode-strategy-smoke\inspect.json" --unit-limit 10
```

Expected: command exits 0, writes `inspect.xlsx`, and writes `inspect.json`.

- [ ] **Step 4: Verify inspect JSON has Window Mode batch material and no API keys**

Run:

```powershell
node -e "const fs=require('fs'); const p='.tmp/window-mode-strategy-smoke/inspect.json'; const data=JSON.parse(fs.readFileSync(p,'utf8')); const ready=data.units.filter(u=>u.status==='ready'); if(!ready.length) throw new Error('No ready units'); const first=ready[0]; if(first.mt.batch?.mode!=='window') throw new Error('Expected Window Mode batch artifact'); if(!Array.isArray(first.mt.batch.currentIds) || first.mt.batch.currentIds.length<1 || first.mt.batch.currentIds.length>5) throw new Error('Current ids must be 1..5'); const text=JSON.stringify(data); if(/api[_-]?key/i.test(text)) throw new Error('Artifact contains API key text'); console.log(JSON.stringify({ready:ready.length, firstCurrentIds:first.mt.batch.currentIds, previous:first.mt.batch.previousContextCount, next:first.mt.batch.nextContextCount}, null, 2));"
```

Expected: prints a JSON summary with `ready` greater than 0 and `firstCurrentIds` length from 1 to 5.

- [ ] **Step 5: Decide on real provider translation smoke**

Run no real `translate:file` command unless the operator explicitly confirms they intend to send source text, TM/TB references, and surrounding context to the configured provider.

If confirmed, run this command with the project id from Step 2:

```powershell
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id $projectId --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output ".tmp\window-mode-strategy-smoke\mt.translated.xlsx" --artifacts ".tmp\window-mode-strategy-smoke\mt.artifacts.jsonl" --max-attempts 1 --batch-size 5
```

Expected: command exits 0, output spreadsheet is written, and artifact JSONL contains Window Mode batch prompt artifacts without API keys.

---

## Completion Criteria

- `packages/localization/src/requestModes` exists and contains shared helpers plus both strategy classes.
- `LocalizationEngine.ts` delegates Window Mode file-job execution to `WindowModeSequentialBatchStrategy`.
- `LocalizationEngine.ts` delegates legacy `translateUnits` execution to `LegacySingleUnitConcurrentStrategy`.
- `LocalizationEngine.ts` no longer contains `translatePreparedWindowBatchWithArtifacts`, `buildPreviousTranslatedContext`, or `buildNextSourceContext`.
- `LocalizationInspector.ts` reuses the shared Window Mode context builder.
- Targeted Vitest suites pass.
- `npm run build --workspace=packages/localization` passes.
- `npm run gate:arch` passes.
- Inspect smoke on `Nikki(zh-fr)` produces Window Mode artifacts with no API keys.
