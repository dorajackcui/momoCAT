# Shared TM/TB Service Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove duplicated desktop TM/TB matching and prompt-reference mapping implementation while preserving the current desktop runtime behavior.

**Architecture:** Keep `packages/localization` as the only implementation owner for shared TM/TB matching and prompt-reference selection. Keep desktop public file paths as compatibility wrappers so existing desktop modules, IPC, and tests keep importing `apps/desktop/src/main/services/TMService.ts` and `TBService.ts` without behavioral changes. Desktop-only TM/TB module responsibilities such as import, CRUD, mount/unmount, progress emission, and batch operations remain in desktop.

**Tech Stack:** TypeScript, Vitest, existing `@cat/localization` exports, desktop service wrappers, existing TM/TB repositories and ports.

---

## Non-Goals

- Do not change TM/TB matching scores, ranking, candidate limits, fallback behavior, or reference caps.
- Do not move desktop `TMModule` or `TBModule` CRUD/import/batch logic.
- Do not migrate desktop MT/AI workflows.
- Do not fix English TB acronym, mixed-script, or plural edge cases in this plan.
- Do not change IPC contracts or renderer imports.

## File Structure

- Modify `packages/localization/src/index.ts`
  - Re-export the already-shared TM/TB prompt-reference helpers and constants.

- Modify `apps/desktop/src/main/services/TMService.ts`
  - Replace copied implementation with a desktop-typed wrapper around `@cat/localization` `TMService`.
  - Re-export the existing TM match types from the shared package.

- Modify `apps/desktop/src/main/services/TBService.ts`
  - Replace copied implementation with a desktop-typed wrapper around `@cat/localization` `TBService`.

- Modify `apps/desktop/src/main/services/modules/ai/promptReferences.ts`
  - Keep desktop error isolation and `tmReference` compatibility field.
  - Use shared `buildTMPromptReferences` and `buildTBPromptReferences` for mapping and caps.

- Create `apps/desktop/src/main/services/modules/ai/promptReferences.test.ts`
  - Characterize desktop prompt-reference behavior before replacing local mapping code.

- Existing tests to run:
  - `apps/desktop/src/main/services/TMService.test.ts`
  - `apps/desktop/src/main/services/TBService.test.ts`
  - `apps/desktop/src/main/services/TMMatchFlow.test.ts`
  - `apps/desktop/src/main/services/TBMatchFlow.test.ts`
  - `apps/desktop/src/main/services/modules/AIModule.test.ts`
  - `packages/localization/src/modules/TMModule.test.ts`
  - `packages/localization/src/modules/TBModule.test.ts`

---

### Task 1: Add Desktop Prompt-Reference Characterization Tests

**Files:**
- Create: `apps/desktop/src/main/services/modules/ai/promptReferences.test.ts`

- [ ] **Step 1: Add a focused characterization test file**

Create `apps/desktop/src/main/services/modules/ai/promptReferences.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../TMService';
import { resolveTranslationPromptReferences } from './promptReferences';

function createSegment(): Segment {
  return {
    segmentId: 'seg-reference',
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Hello world' }],
    targetTokens: [],
    status: 'new',
    tagsSignature: '',
    matchKey: 'hello world',
    srcHash: 'source-hash',
    meta: { updatedAt: '2026-05-29T00:00:00.000Z' },
  };
}

function createTmMatch(kind: 'tm' | 'concordance'): TMMatch {
  const base = {
    id: `match-${kind}`,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: `hash-${kind}`,
    matchKey: `match-${kind}`,
    tagsSignature: '',
    sourceTokens: [{ type: 'text' as const, content: kind === 'tm' ? 'Hello' : 'Hello world' }],
    targetTokens: [{ type: 'text' as const, content: kind === 'tm' ? 'Bonjour' : 'Bonjour monde' }],
    usageCount: 1,
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    rank: kind === 'tm' ? 100 : 90,
    tmName: 'Main TM',
    tmType: 'main' as const,
  };

  if (kind === 'tm') {
    return {
      ...base,
      kind: 'tm',
      similarity: 100,
    };
  }

  return {
    ...base,
    kind: 'concordance',
    matchedSourceText: 'world',
    sourceCoverage: 50,
    entryCoverage: 50,
  };
}

function createTbMatch(): TBMatch {
  return {
    id: 'tb-1',
    tbId: 'tb-main',
    srcTerm: 'world',
    tgtTerm: 'monde',
    srcNorm: 'world',
    note: 'Use common noun.',
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    usageCount: 1,
    tbName: 'Client TB',
    priority: 1,
    positions: [{ start: 6, end: 11 }],
  };
}

describe('resolveTranslationPromptReferences', () => {
  it('maps TM, concordance, and TB matches into the desktop prompt reference shape', async () => {
    const segment = createSegment();
    const tmMatches = [createTmMatch('tm'), createTmMatch('concordance')];
    const tbMatches = [createTbMatch()];

    const references = await resolveTranslationPromptReferences({
      projectId: 1,
      segment,
      resolvers: {
        tmService: { findMatches: vi.fn().mockResolvedValue(tmMatches) },
        tbService: { findMatches: vi.fn().mockResolvedValue(tbMatches) },
      },
    });

    expect(references.tmReference).toEqual({
      similarity: 100,
      tmName: 'Main TM',
      sourceText: 'Hello',
      targetText: 'Bonjour',
    });
    expect(references.tmReferences).toEqual([references.tmReference]);
    expect(references.concordanceReferences).toEqual([
      {
        tmName: 'Main TM',
        matchedSourceText: 'world',
        sourceText: 'Hello world',
        targetText: 'Bonjour monde',
      },
    ]);
    expect(references.tbReferences).toEqual([
      {
        srcTerm: 'world',
        tgtTerm: 'monde',
        note: 'Use common noun.',
      },
    ]);
  });

  it('keeps TM and TB resolver failures isolated', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const references = await resolveTranslationPromptReferences({
        projectId: 1,
        segment: createSegment(),
        resolvers: {
          tmService: { findMatches: vi.fn().mockRejectedValue(new Error('tm failed')) },
          tbService: { findMatches: vi.fn().mockRejectedValue(new Error('tb failed')) },
        },
      });

      expect(references).toEqual({});
      expect(warn).toHaveBeenCalledTimes(2);
      expect(String(warn.mock.calls[0][0])).toContain('Failed to resolve TM reference');
      expect(String(warn.mock.calls[1][0])).toContain('Failed to resolve TB references');
    } finally {
      warn.mockRestore();
    }
  });
});
```

- [ ] **Step 2: Run the characterization test**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/ai/promptReferences.test.ts
```

Expected: PASS before refactoring. This proves the test captures existing behavior instead of defining new behavior.

---

### Task 2: Export Shared Reference Helpers From `@cat/localization`

**Files:**
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Expand TM/TB module exports**

In `packages/localization/src/index.ts`, replace the current TM/TB module export lines:

```ts
export { TMModule, mapTMEngineReferences } from './modules/TMModule';
export { TBModule, mapTBEngineReferences } from './modules/TBModule';
```

with:

```ts
export {
  DEFAULT_TM_PROMPT_REFERENCE_LIMITS,
  MAX_CONCORDANCE_PROMPT_REFERENCES,
  MAX_ENGINE_TM_REFERENCES,
  MAX_TM_PROMPT_REFERENCES,
  TMModule,
  buildTMPromptReferences,
  mapTMEngineReferences,
} from './modules/TMModule';
export {
  MAX_ENGINE_TB_REFERENCES,
  MAX_TB_PROMPT_REFERENCES,
  TBModule,
  buildTBPromptReferences,
  mapTBEngineReferences,
} from './modules/TBModule';
```

- [ ] **Step 2: Run localization module tests**

Run:

```powershell
npx vitest run packages/localization/src/modules/TMModule.test.ts packages/localization/src/modules/TBModule.test.ts
```

Expected: PASS. The helper implementations stay unchanged; this task only widens the package export surface.

---

### Task 3: Use Shared Reference Helpers In Desktop Prompt Mapping

**Files:**
- Modify: `apps/desktop/src/main/services/modules/ai/promptReferences.ts`

- [ ] **Step 1: Replace local mapping imports and constants**

Change the imports at the top of `apps/desktop/src/main/services/modules/ai/promptReferences.ts` from:

```ts
import type { Segment } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { PromptReferenceResolvers, TranslationPromptReferences } from './types';

const MAX_TM_PROMPT_REFERENCES = 3;
const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;
const MAX_TB_PROMPT_REFERENCES = 100;
```

to:

```ts
import type { Segment } from '@cat/core/models';
import { buildTBPromptReferences, buildTMPromptReferences } from '@cat/localization';
import type { PromptReferenceResolvers, TranslationPromptReferences } from './types';
```

- [ ] **Step 2: Replace the TM mapping block**

Inside `resolveTranslationPromptReferences`, replace the current `tmMatches` mapping block:

```ts
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

with:

```ts
const selectedReferences = buildTMPromptReferences(tmMatches);

if (selectedReferences.tmReferences.length > 0) {
  references.tmReferences = selectedReferences.tmReferences;
  references.tmReference = selectedReferences.tmReferences[0];
}

if (selectedReferences.concordanceReferences.length > 0) {
  references.concordanceReferences = selectedReferences.concordanceReferences;
}
```

- [ ] **Step 3: Replace the TB mapping block**

Replace:

```ts
if (tbMatches.length > 0) {
  references.tbReferences = tbMatches.slice(0, MAX_TB_PROMPT_REFERENCES).map((match) => ({
    srcTerm: match.srcTerm,
    tgtTerm: match.tgtTerm,
    note: match.note ?? null,
  }));
}
```

with:

```ts
const tbReferences = buildTBPromptReferences(tbMatches);
if (tbReferences.length > 0) {
  references.tbReferences = tbReferences;
}
```

- [ ] **Step 4: Run desktop prompt reference tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/modules/ai/promptReferences.test.ts apps/desktop/src/main/services/modules/AIModule.test.ts
```

Expected: PASS. The desktop resolver still catches resolver errors and still sets the legacy `tmReference` field.

---

### Task 4: Replace Desktop `TMService` With A Shared Wrapper

**Files:**
- Modify: `apps/desktop/src/main/services/TMService.ts`

- [ ] **Step 1: Replace the copied desktop implementation**

Replace the full contents of `apps/desktop/src/main/services/TMService.ts` with:

```ts
import {
  TMService as SharedTMService,
  type ConcordanceTMMatch,
  type StandardTMMatch,
  type TMMatch,
  type TMMatchBase,
  type TMMatchKind,
} from '@cat/localization';
import type { ProjectRepository, TMRepository } from './ports';

export type {
  ConcordanceTMMatch,
  StandardTMMatch,
  TMMatch,
  TMMatchBase,
  TMMatchKind,
};

export class TMService extends SharedTMService {
  constructor(projectRepo: ProjectRepository, tmRepo: TMRepository) {
    super(projectRepo, tmRepo);
  }
}
```

This preserves the desktop import path and constructor shape while moving all matching behavior to `packages/localization`.

- [ ] **Step 2: Run focused desktop TM tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/TMMatchFlow.test.ts
```

Expected: PASS. `TMMatchFlow.test.ts` also protects the diagnostic trace helpers that access service internals through the runtime object.

---

### Task 5: Replace Desktop `TBService` With A Shared Wrapper

**Files:**
- Modify: `apps/desktop/src/main/services/TBService.ts`

- [ ] **Step 1: Replace the copied desktop implementation**

Replace the full contents of `apps/desktop/src/main/services/TBService.ts` with:

```ts
import { TBService as SharedTBService } from '@cat/localization';
import type { ProjectRepository, TBRepository } from './ports';

export class TBService extends SharedTBService {
  constructor(projectRepo: ProjectRepository, tbRepo: TBRepository) {
    super(projectRepo, tbRepo);
  }
}
```

This preserves the desktop import path and constructor shape while moving all TB matching behavior to `packages/localization`.

- [ ] **Step 2: Run focused desktop TB tests**

Run:

```powershell
npx vitest run apps/desktop/src/main/services/TBService.test.ts apps/desktop/src/main/services/TBMatchFlow.test.ts
```

Expected: PASS. The English TB recall tests should still exercise the shared `packages/localization` service through the desktop wrapper.

---

### Task 6: Verify Desktop Module Compatibility

**Files:**
- Inspect: `apps/desktop/src/main/services/ProjectService.ts`
- Inspect: `apps/desktop/src/main/services/SegmentService.ts`
- Inspect: `apps/desktop/src/main/services/modules/TMModule.ts`
- Inspect: `apps/desktop/src/main/services/modules/TBModule.ts`
- Inspect: `apps/desktop/src/main/services/modules/tm/TMQueryService.ts`
- Inspect: `apps/desktop/src/main/services/modules/ai/types.ts`

- [ ] **Step 1: Confirm existing imports still resolve**

Run:

```powershell
rg -n "from './TMService'|from '../TMService'|from '../../TMService'|from './TBService'|from '../TBService'|from '../../TBService'" apps/desktop/src/main -g '*.ts'
```

Expected: Existing desktop modules still import from the same desktop paths. No callsite import rewrite is needed.

- [ ] **Step 2: Run desktop typecheck**

Run:

```powershell
npm run typecheck --workspace=apps/desktop
```

Expected: PASS. If TypeScript rejects structural compatibility between desktop ports and localization ports, keep the public wrapper constructors and cast only at the `super(...)` call:

```ts
super(projectRepo as ConstructorParameters<typeof SharedTMService>[0], tmRepo as ConstructorParameters<typeof SharedTMService>[1]);
```

or:

```ts
super(projectRepo as ConstructorParameters<typeof SharedTBService>[0], tbRepo as ConstructorParameters<typeof SharedTBService>[1]);
```

Use the casts only if typecheck requires them. The runtime objects are structurally the same repositories already used by both packages.

---

### Task 7: Run Shared Package Verification

**Files:**
- No source edits in this task.

- [ ] **Step 1: Run localization tests affected by shared exports**

Run:

```powershell
npx vitest run packages/localization/src/modules/TMModule.test.ts packages/localization/src/modules/TBModule.test.ts packages/localization/src/modules/MTModule.test.ts
```

Expected: PASS.

- [ ] **Step 2: Build localization package**

Run:

```powershell
npm run build --workspace=packages/localization
```

Expected: PASS. This catches package barrel export and bundled entrypoint issues.

- [ ] **Step 3: Build desktop app type surface**

Run:

```powershell
npm run build:app
```

Expected: PASS. This checks Electron/Vite resolution of `@cat/localization` from desktop service wrappers.

---

### Task 8: Diff Hygiene And Boundary Review

**Files:**
- Inspect all changed files.

- [ ] **Step 1: Confirm no desktop-only modules moved**

Run:

```powershell
git diff --stat
```

Expected changed files:

```text
apps/desktop/src/main/services/TMService.ts
apps/desktop/src/main/services/TBService.ts
apps/desktop/src/main/services/modules/ai/promptReferences.ts
apps/desktop/src/main/services/modules/ai/promptReferences.test.ts
packages/localization/src/index.ts
```

Existing dirty files from other active work may also appear. Do not revert unrelated changes.

- [ ] **Step 2: Check for accidental desktop-to-CLI or localization-to-desktop imports**

Run:

```powershell
npm run gate:arch
```

Expected: PASS.

- [ ] **Step 3: Check whitespace**

Run:

```powershell
git diff --check
```

Expected: no output.

---

## Final Verification

Run the focused verification set:

```powershell
npx vitest run apps/desktop/src/main/services/TMService.test.ts apps/desktop/src/main/services/TBService.test.ts apps/desktop/src/main/services/TMMatchFlow.test.ts apps/desktop/src/main/services/TBMatchFlow.test.ts apps/desktop/src/main/services/modules/ai/promptReferences.test.ts packages/localization/src/modules/TMModule.test.ts packages/localization/src/modules/TBModule.test.ts
npm run typecheck --workspace=apps/desktop
npm run build --workspace=packages/localization
npm run gate:arch
git diff --check
```

Expected: all commands pass.

## Self-Review Checklist

- Desktop `TMService` and `TBService` import paths remain stable.
- Desktop service constructors still accept desktop repository interfaces.
- `packages/localization` owns the only TM/TB matching implementation.
- Desktop prompt-reference resolver still catches TM and TB resolver failures independently.
- Desktop prompt-reference resolver still sets `tmReference` to the first selected TM reference.
- TM cap remains 3, concordance cap remains 3, TB cap remains 100.
- Desktop TM/TB modules keep CRUD/import/batch/progress responsibilities.
- CLI behavior is unchanged because it already uses `packages/localization`.
- No MT/AI workflow migration is included in this change.
