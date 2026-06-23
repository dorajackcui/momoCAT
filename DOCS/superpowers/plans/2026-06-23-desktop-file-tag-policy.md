# Desktop File Tag Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a desktop file-level `tagPolicy` so files imported with marker-like business text can keep that text plain through import, editor editing, AI translation, QA, TM commit, and export.

**Architecture:** Store `tagPolicy` inside the existing file import options JSON. Add one small resolver shared by renderer and main process, then thread the resolved file policy into every desktop string-to-token conversion for project files. Default behavior remains `default`; `none` is opt-in at file import time.

**Tech Stack:** TypeScript, React, Electron IPC, `@cat/core/tag`, desktop Vitest suites, existing SQLite file metadata through `importOptionsJson`.

---

## File Map

- Create `apps/desktop/src/shared/fileTagPolicy.ts`
  - Normalizes import/file policy values.
  - Parses `ProjectFileRecord.importOptionsJson`.
  - Provides a single policy source for renderer and main process.
- Create `apps/desktop/src/shared/fileTagPolicy.test.ts`
  - Protects default fallback, invalid JSON fallback, and `none` parsing.
- Modify `apps/desktop/src/shared/ipc.ts`
  - Add `tagPolicy?: TagPolicy` to `ImportOptions`.
- Modify `apps/desktop/src/renderer/src/components/ColumnSelector.tsx`
  - Add import-time marker handling option.
  - Pass `tagPolicy` in `onConfirm`.
- Create `apps/desktop/src/main/filters/SpreadsheetFilter.test.ts`
  - Verifies default import still creates tag tokens.
  - Verifies `tagPolicy: none` creates plain text tokens and empty tag signature.
- Modify `apps/desktop/src/main/filters/SpreadsheetFilter.ts`
  - Resolve import policy and pass it to source/target parsing.
- Create `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.ts`
  - Small pure helpers for editor text normalization and policy-aware target parsing.
- Create `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts`
  - Verifies editor text with `{1}` remains text under `none`.
- Modify `apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.ts`
  - Resolve and store the active file tag policy when the editor loads a file.
- Modify `apps/desktop/src/renderer/src/hooks/useEditor.ts`
  - Use the active file policy for manual edits and apply-term conversions.
- Modify `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`
  - Accept `tagPolicy`, parse responses with it, and skip tag validation under `none`.
- Modify `apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts`
  - Resolve file policy for single-segment translate/refine.
- Modify `apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts`
  - Carry policy through standard file translation fallback.
- Modify `apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts`
  - Parse dialogue batch responses with policy and skip tag validation under `none`.
- Modify `apps/desktop/src/main/services/modules/ai/dialogueTranslationWorkflow.ts`
  - Carry policy into dialogue unit translation.
- Modify `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`
  - Forward policy to localization runtime and parse returned targets with it.
- Modify `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`
  - Resolve file policy once for file translation and pass it to workflows.
- Modify relevant desktop tests:
  - `apps/desktop/src/main/services/modules/AIModule.test.ts`
  - `apps/desktop/src/main/filters/SpreadsheetFilter.test.ts`
  - `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts`
- Modify docs:
  - `DOCS/50_MT_REQUEST_MODEL.md`
  - Add a short desktop note that `tagPolicy: none` is selected at file import time and applies to that file.

---

### Task 1: Shared File Policy Resolver

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Create: `apps/desktop/src/shared/fileTagPolicy.ts`
- Test: `apps/desktop/src/shared/fileTagPolicy.test.ts`

- [ ] **Step 1: Write resolver tests**

Create `apps/desktop/src/shared/fileTagPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  coerceImportTagPolicy,
  parseFileImportOptions,
  resolveFileTagPolicy,
  resolveImportOptionsTagPolicy,
} from './fileTagPolicy';

describe('fileTagPolicy', () => {
  it('defaults missing and unknown values to default', () => {
    expect(coerceImportTagPolicy(undefined)).toBe('default');
    expect(coerceImportTagPolicy('default')).toBe('default');
    expect(coerceImportTagPolicy('html-only')).toBe('default');
    expect(resolveImportOptionsTagPolicy(undefined)).toBe('default');
    expect(resolveImportOptionsTagPolicy({ tagPolicy: 'default' })).toBe('default');
  });

  it('resolves tagPolicy none from import options', () => {
    expect(coerceImportTagPolicy('none')).toBe('none');
    expect(resolveImportOptionsTagPolicy({ tagPolicy: 'none' })).toBe('none');
  });

  it('parses file importOptionsJson safely', () => {
    expect(
      parseFileImportOptions({
        importOptionsJson: '{"hasHeader":true,"sourceCol":0,"targetCol":1,"tagPolicy":"none"}',
      }),
    ).toMatchObject({ sourceCol: 0, targetCol: 1, tagPolicy: 'none' });

    expect(parseFileImportOptions({ importOptionsJson: '{bad json' })).toBeUndefined();
    expect(parseFileImportOptions({ importOptionsJson: null })).toBeUndefined();
  });

  it('resolves file policy from importOptionsJson', () => {
    expect(
      resolveFileTagPolicy({
        importOptionsJson: '{"hasHeader":true,"sourceCol":0,"targetCol":1,"tagPolicy":"none"}',
      }),
    ).toBe('none');

    expect(resolveFileTagPolicy({ importOptionsJson: null })).toBe('default');
    expect(resolveFileTagPolicy(undefined)).toBe('default');
  });
});
```

- [ ] **Step 2: Run resolver test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/shared/fileTagPolicy.test.ts
```

Expected: FAIL because `fileTagPolicy.ts` does not exist.

- [ ] **Step 3: Add `tagPolicy` to import options**

Modify `apps/desktop/src/shared/ipc.ts`.

Add this import near the existing `@cat/core` imports:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Update `ImportOptions`:

```ts
export interface ImportOptions {
  hasHeader: boolean;
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
  tagPolicy?: TagPolicy;
}
```

- [ ] **Step 4: Implement the resolver**

Create `apps/desktop/src/shared/fileTagPolicy.ts`:

```ts
import type { TagPolicy } from '@cat/core/tag';
import type { ImportOptions, ProjectFileRecord } from './ipc';

export const DEFAULT_FILE_TAG_POLICY: TagPolicy = 'default';

export function coerceImportTagPolicy(value: unknown): TagPolicy {
  return value === 'none' ? 'none' : DEFAULT_FILE_TAG_POLICY;
}

export function resolveImportOptionsTagPolicy(
  options?: Pick<ImportOptions, 'tagPolicy'> | null,
): TagPolicy {
  return coerceImportTagPolicy(options?.tagPolicy);
}

export function parseFileImportOptions(
  file?: Pick<ProjectFileRecord, 'importOptionsJson'> | null,
): ImportOptions | undefined {
  const raw = file?.importOptionsJson;
  if (!raw) return undefined;

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    return parsed as ImportOptions;
  } catch {
    return undefined;
  }
}

export function resolveFileTagPolicy(
  file?: Pick<ProjectFileRecord, 'importOptionsJson'> | null,
): TagPolicy {
  return resolveImportOptionsTagPolicy(parseFileImportOptions(file));
}
```

- [ ] **Step 5: Run resolver test and confirm it passes**

Run:

```bash
npx vitest run apps/desktop/src/shared/fileTagPolicy.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/fileTagPolicy.ts apps/desktop/src/shared/fileTagPolicy.test.ts
git commit -m "feat: add desktop file tag policy resolver"
```

---

### Task 2: Import UI And Spreadsheet Tokenization

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/ColumnSelector.tsx`
- Modify: `apps/desktop/src/main/filters/SpreadsheetFilter.ts`
- Test: `apps/desktop/src/main/filters/SpreadsheetFilter.test.ts`

- [ ] **Step 1: Write SpreadsheetFilter tests**

Create `apps/desktop/src/main/filters/SpreadsheetFilter.test.ts`:

```ts
import { mkdtemp, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as XLSX from 'xlsx';
import { describe, expect, it, afterEach } from 'vitest';
import { SpreadsheetFilter } from './SpreadsheetFilter';

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((root) => rm(root, { recursive: true, force: true })));
  tempRoots.length = 0;
});

async function writeWorkbook(rows: unknown[][]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'momocat-spreadsheet-filter-'));
  tempRoots.push(root);
  const path = join(root, 'input.xlsx');
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Sheet1');
  XLSX.writeFile(workbook, path);
  return path;
}

describe('SpreadsheetFilter tagPolicy import', () => {
  it('keeps default import marker behavior', async () => {
    const inputPath = await writeWorkbook([
      ['source', 'target'],
      ['Save {1} <xxx> %s', 'Guardar {1} <xxx> %s'],
    ]);

    const segments = await new SpreadsheetFilter().import(inputPath, 10, 20, {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].sourceTokens.some((token) => token.type === 'tag')).toBe(true);
    expect(segments[0].targetTokens.some((token) => token.type === 'tag')).toBe(true);
    expect(segments[0].tagsSignature).toContain('{1}');
  });

  it('keeps marker-like text plain when tagPolicy is none', async () => {
    const inputPath = await writeWorkbook([
      ['source', 'target'],
      ['Save {1} <xxx> %s', 'Guardar {1} <xxx> %s'],
    ]);

    const segments = await new SpreadsheetFilter().import(inputPath, 10, 20, {
      hasHeader: true,
      sourceCol: 0,
      targetCol: 1,
      tagPolicy: 'none',
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].sourceTokens).toEqual([
      { type: 'text', content: 'Save {1} <xxx> %s' },
    ]);
    expect(segments[0].targetTokens).toEqual([
      { type: 'text', content: 'Guardar {1} <xxx> %s' },
    ]);
    expect(segments[0].tagsSignature).toBe('');
    expect(segments[0].matchKey).toBe('save {1} <xxx> %s');
  });
});
```

- [ ] **Step 2: Run SpreadsheetFilter test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/filters/SpreadsheetFilter.test.ts
```

Expected: FAIL because `tagPolicy: none` still produces tag tokens.

- [ ] **Step 3: Implement policy-aware import tokenization**

Modify `apps/desktop/src/main/filters/SpreadsheetFilter.ts`.

Add the resolver import:

```ts
import { resolveImportOptionsTagPolicy } from '../../shared/fileTagPolicy';
```

Resolve policy before row iteration:

```ts
const tagPolicy = resolveImportOptionsTagPolicy(options);
```

Replace source/target parsing:

```ts
const sourceTokens = parseDisplayTextToTokens(sourceText, { tagPolicy });
const targetTokens = targetText ? parseDisplayTextToTokens(targetText, { tagPolicy }) : [];
```

- [ ] **Step 4: Add import UI option**

Modify `apps/desktop/src/renderer/src/components/ColumnSelector.tsx`.

Add the type import:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add state:

```ts
const [tagPolicy, setTagPolicy] = useState<TagPolicy>('default');
```

Add this option block near the existing header checkbox:

```tsx
<Card
  variant="subtle"
  className="mb-6 p-4 flex items-center justify-between gap-4 border-border/70"
>
  <div>
    <div className="text-sm font-medium text-text">Marker Handling</div>
    <div className="text-xs text-text-muted">
      Choose whether marker-like text is protected as CAT tags for this file.
    </div>
  </div>
  <Select
    aria-label="Marker Handling"
    value={tagPolicy}
    onChange={(event) => setTagPolicy(event.target.value as TagPolicy)}
    className="!w-56 !p-2.5"
  >
    <option value="default">Protect CAT markers</option>
    <option value="none">Treat marker-like text as plain text</option>
  </Select>
</Card>
```

Include `tagPolicy` in the confirm payload:

```ts
onConfirm({
  hasHeader,
  sourceCol,
  targetCol,
  contextCol: isReviewProject ? (contextCol ?? 0) : contextCol,
  tagPolicy,
})
```

- [ ] **Step 5: Run import tests**

Run:

```bash
npx vitest run apps/desktop/src/main/filters/SpreadsheetFilter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run desktop typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/components/ColumnSelector.tsx apps/desktop/src/main/filters/SpreadsheetFilter.ts apps/desktop/src/main/filters/SpreadsheetFilter.test.ts
git commit -m "feat: apply file tag policy during import"
```

---

### Task 3: Editor Text-To-Token Policy

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.ts`
- Test: `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useEditor.ts`

- [ ] **Step 1: Write editor token policy tests**

Create `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import { parseTargetEditorText, appendTermToTargetTokens } from './editorTokenPolicy';

const segment: Segment = {
  segmentId: 'seg-1',
  fileId: 1,
  orderIndex: 0,
  sourceTokens: [{ type: 'text', content: 'Save {1}' }],
  targetTokens: [{ type: 'text', content: 'Guardar' }],
  status: 'draft',
  tagsSignature: '',
  matchKey: 'save {1}',
  srcHash: 'save {1}:::',
  meta: { updatedAt: '2026-06-23T00:00:00.000Z' },
};

describe('editorTokenPolicy', () => {
  it('parses marker-like target text as plain text under tagPolicy none', () => {
    expect(parseTargetEditorText('Guardar {1}', segment.sourceTokens, 'none')).toEqual([
      { type: 'text', content: 'Guardar {1}' },
    ]);
  });

  it('keeps default editor marker behavior when policy is default', () => {
    const sourceTokens = [{ type: 'tag' as const, content: '{1}', meta: { id: '{1}' } }];
    expect(parseTargetEditorText('Guardar {1}', sourceTokens, 'default')).toEqual([
      { type: 'text', content: 'Guardar ' },
      { type: 'tag', content: '{1}', meta: { id: '{1}' } },
    ]);
  });

  it('keeps applied terms plain under tagPolicy none', () => {
    expect(appendTermToTargetTokens(segment, '<xxx>', 'none')).toEqual([
      { type: 'text', content: 'Guardar <xxx>' },
    ]);
  });
});
```

- [ ] **Step 2: Run editor helper test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts
```

Expected: FAIL because `editorTokenPolicy.ts` does not exist.

- [ ] **Step 3: Implement editor token helper**

Create `apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.ts`:

```ts
import type { Segment, Token } from '@cat/core/models';
import type { TagPolicy } from '@cat/core/tag';
import { parseEditorTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';

export function normalizeEditorInputText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function parseTargetEditorText(
  text: string,
  sourceTokens: Token[],
  tagPolicy: TagPolicy,
): Token[] {
  return parseEditorTextToTokens(normalizeEditorInputText(text), sourceTokens, { tagPolicy });
}

export function shouldInsertTermSpacer(current: string, term: string): boolean {
  const left = current.slice(-1);
  const right = term.slice(0, 1);
  if (!left || !right) return false;
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

export function appendTermToTargetTokens(
  segment: Segment,
  term: string,
  tagPolicy: TagPolicy,
): Token[] {
  const currentText = serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  const spacer = shouldInsertTermSpacer(currentText, term) ? ' ' : '';
  return parseTargetEditorText(`${currentText}${spacer}${term}`, segment.sourceTokens, tagPolicy);
}
```

- [ ] **Step 4: Store active file policy in editor state**

Modify `apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.ts`.

Add imports:

```ts
import type { TagPolicy } from '@cat/core/tag';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
```

Add to `UseEditorDataLoaderParams`:

```ts
setFileTagPolicy: Dispatch<SetStateAction<TagPolicy>>;
```

Destructure `setFileTagPolicy` from params.

When `activeFileId === null`, reset:

```ts
setFileTagPolicy('default');
```

After `const file = await apiClient.getFile(activeFileId);`, set:

```ts
setFileTagPolicy(resolveFileTagPolicy(file));
```

If `file` is absent, also set:

```ts
setFileTagPolicy('default');
```

Add `setFileTagPolicy` to the hook dependency array.

- [ ] **Step 5: Use active file policy in `useEditor` conversions**

Modify `apps/desktop/src/renderer/src/hooks/useEditor.ts`.

Add imports:

```ts
import type { TagPolicy } from '@cat/core/tag';
import { appendTermToTargetTokens, parseTargetEditorText } from './editor/editorTokenPolicy';
```

Add state:

```ts
const [fileTagPolicy, setFileTagPolicy] = useState<TagPolicy>('default');
```

Pass `setFileTagPolicy` into `useEditorDataLoader`.

Replace manual edit parsing:

```ts
const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
const tokens = parseTargetEditorText(normalizedText, segment.sourceTokens, fileTagPolicy);
```

Replace apply-term parsing:

```ts
const nextText = `${currentText}${spacer}${term}`;
const nextTokens = parseTargetEditorText(nextText, segment.sourceTokens, fileTagPolicy);
```

Or use the helper directly:

```ts
const nextTokens = appendTermToTargetTokens(segment, term, fileTagPolicy);
const nextText = serializeTokensToEditorText(nextTokens, segment.sourceTokens);
```

Keep `nextStatus` based on the same final text:

```ts
const nextStatus: SegmentStatus = nextText.trim() ? 'draft' : 'new';
```

- [ ] **Step 6: Run editor tests**

Run:

```bash
npx vitest run apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts apps/desktop/src/renderer/src/hooks/useEditor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.ts apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts apps/desktop/src/renderer/src/hooks/editor/useEditorDataLoader.ts apps/desktop/src/renderer/src/hooks/useEditor.ts
git commit -m "feat: honor file tag policy in editor"
```

---

### Task 4: Desktop AI Workflows

**Files:**
- Modify: `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/dialogueTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`
- Test: `apps/desktop/src/main/services/modules/AIModule.test.ts`

- [ ] **Step 1: Add failing AIModule single-segment test**

Add this test inside `describe('AIModule.aiTranslateSegment', ...)` in `apps/desktop/src/main/services/modules/AIModule.test.ts`:

```ts
it('keeps marker-like AI output plain for tagPolicy none files', async () => {
  const segment = createSegment({
    segmentId: 'single-plain-marker-1',
    sourceText: 'Save {1}',
    targetText: '',
    status: 'new',
  });
  segment.sourceTokens = [{ type: 'text', content: 'Save {1}' }];
  segment.tagsSignature = '';
  segment.matchKey = 'save {1}';
  segment.srcHash = 'save {1}:::';

  const projectRepo = {
    getFile: vi.fn().mockReturnValue({
      id: 1,
      projectId: 11,
      name: 'plain.xlsx',
      importOptionsJson: '{"hasHeader":true,"sourceCol":0,"targetCol":1,"tagPolicy":"none"}',
    }),
    getProject: vi.fn().mockReturnValue({
      id: 11,
      srcLang: 'en',
      tgtLang: 'es',
      aiPrompt: '',
      aiTemperature: 0.2,
    }),
  } as unknown as ProjectRepository;

  const segmentRepo = {
    getSegment: vi.fn().mockReturnValue(segment),
  } as unknown as SegmentRepository;

  const settingsRepo = createAISettingsRepository();
  const segmentService = {
    updateSegment: vi.fn().mockResolvedValue({
      propagatedIds: [],
      serverAppliedAt: '2026-06-23T00:00:00.000Z',
    }),
  } as unknown as SegmentService;

  const transport = {
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    createResponse: vi.fn().mockResolvedValue({
      content: 'Guardar {1}',
      status: 200,
      endpoint: '/v1/responses',
    }),
  } as unknown as AITransport;

  const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
  const result = await module.aiTranslateSegment('single-plain-marker-1');

  expect(result.targetTokens).toEqual([{ type: 'text', content: 'Guardar {1}' }]);
  expect(segmentService.updateSegment).toHaveBeenCalledWith(
    'single-plain-marker-1',
    [{ type: 'text', content: 'Guardar {1}' }],
    'translated',
  );
  expect(transport.createResponse).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the new AIModule test and confirm it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts -t "keeps marker-like AI output plain"
```

Expected: FAIL because `AITextTranslator` parses output with the default policy.

- [ ] **Step 3: Make `AITextTranslator` policy-aware**

Modify `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`.

Add import:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add to `TranslateSegmentParams`:

```ts
tagPolicy?: TagPolicy;
```

In `translateSegment`, resolve:

```ts
const tagPolicy = params.tagPolicy ?? 'default';
```

Parse with policy:

```ts
const targetTokens = parseEditorTextToTokens(translatedText, params.sourceTokens, {
  tagPolicy,
});
```

Skip tag validation under `none`:

```ts
if (normalizedType === 'custom' || tagPolicy === 'none') {
  return targetTokens;
}
```

- [ ] **Step 4: Resolve policy in single-segment workflows**

Modify `apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts`.

Add imports:

```ts
import type { TagPolicy } from '@cat/core/tag';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
```

Add helper:

```ts
function buildSourcePayload(tokens: Segment['sourceTokens'], tagPolicy: TagPolicy): string {
  return tagPolicy === 'none'
    ? serializeTokensToDisplayText(tokens)
    : serializeTokensToEditorText(tokens, tokens);
}
```

After loading `file`, resolve:

```ts
const tagPolicy = resolveFileTagPolicy(file);
```

Use source payload:

```ts
const sourceTagPreservedText = buildSourcePayload(segment.sourceTokens, tagPolicy);
```

For refinement current translation payload:

```ts
const currentTranslationTagPreservedText =
  tagPolicy === 'none'
    ? serializeTokensToDisplayText(segment.targetTokens)
    : serializeTokensToEditorText(segment.targetTokens, segment.sourceTokens);
```

Pass `tagPolicy` into `deps.textTranslator.translateSegment(...)`.

- [ ] **Step 5: Carry policy through standard file translation**

Modify `apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts`.

Add `TagPolicy` import:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add `tagPolicy: TagPolicy` to `TranslateBatchSegmentParams` and `StandardFileTranslationParams`.

Build source payload with policy:

```ts
const sourceTagPreservedText =
  params.tagPolicy === 'none'
    ? sourceText
    : serializeTokensToEditorText(params.segment.sourceTokens, params.segment.sourceTokens);
```

Pass `tagPolicy: params.tagPolicy` into `textTranslator.translateSegment(...)`.

When calling `translateBatchSegment`, include `tagPolicy: params.tagPolicy`.

- [ ] **Step 6: Carry policy through dialogue translation**

Modify `apps/desktop/src/main/services/modules/ai/dialogueTranslationWorkflow.ts`.

Add `tagPolicy: TagPolicy` to `DialogueFileTranslationParams` and pass it into `translateDialogueUnit`.

When calling `translateBatchSegment`, include the same `tagPolicy`.

Modify `apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts`.

Add `tagPolicy: TagPolicy` to the unit translation params.

Parse translated text with:

```ts
targetTokens = parseEditorTextToTokens(translatedText, draft.segment.sourceTokens, {
  tagPolicy: params.tagPolicy,
});
```

Skip validation under `none`:

```ts
if (params.tagPolicy !== 'none') {
  const validationResult = params.tagValidator.validate(
    draft.segment.sourceTokens,
    targetTokens,
  );
  const errors = validationResult.issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    issues.push(
      `Segment ${draft.segment.segmentId}: ${errors.map((errorItem) => errorItem.message).join('; ')}`,
    );
    continue;
  }
}
```

- [ ] **Step 7: Carry policy through localization file translation**

Modify `apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts`.

Add `TagPolicy` import:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add `tagPolicy: TagPolicy` to `LocalizationFileTranslationParams`.

Forward to localization runtime:

```ts
options: {
  mode: 'standard',
  requestMode: 'window-partial',
  targetBaseline: params.targetBaseline,
  tagPolicy: params.tagPolicy,
  ...(providerId ? { mt: { providerId } } : {}),
},
```

Pass policy to result application:

```ts
await applyLocalizationUnitResult(
  unitResult,
  segmentsById,
  params.segmentService,
  params.tagPolicy,
);
```

Update result parsing:

```ts
async function applyLocalizationUnitResult(
  unitResult: TranslateUnitResult,
  segmentsById: Map<string, Segment>,
  segmentService: SegmentService,
  tagPolicy: TagPolicy,
): Promise<void> {
  // existing status and segment checks stay unchanged
  await segmentService.updateSegment(
    segment.segmentId,
    parseDisplayTextToTokens(unitResult.target, { tagPolicy }),
    'translated',
  );
}
```

- [ ] **Step 8: Resolve policy in AITranslationOrchestrator file workflows**

Modify `apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts`.

Add import:

```ts
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
```

After `file` is loaded:

```ts
const tagPolicy = resolveFileTagPolicy(file);
```

Pass `tagPolicy` into:

- `runDialogueFileTranslation`
- `runLocalizationFileTranslation`
- `runStandardFileTranslation`

- [ ] **Step 9: Run focused AI tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/AIModule.test.ts -t "tagPolicy none|keeps marker-like AI output plain"
```

Expected: PASS for the new test and any existing tag-policy-none coverage.

- [ ] **Step 10: Commit**

```bash
git add apps/desktop/src/main/services/modules/ai/AITextTranslator.ts apps/desktop/src/main/services/modules/ai/segmentTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/fileTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/dialogueTranslation.ts apps/desktop/src/main/services/modules/ai/dialogueTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/localizationFileTranslationWorkflow.ts apps/desktop/src/main/services/modules/ai/AITranslationOrchestrator.ts apps/desktop/src/main/services/modules/AIModule.test.ts
git commit -m "feat: honor file tag policy in desktop ai"
```

---

### Task 5: Documentation And Full Verification

**Files:**
- Modify: `DOCS/50_MT_REQUEST_MODEL.md`

- [ ] **Step 1: Document desktop file policy boundary**

Modify `DOCS/50_MT_REQUEST_MODEL.md` near the existing protected-marker / request model discussion.

Add:

```md
## Desktop File Tag Policy

Desktop project files resolve CAT marker handling at import time. The selected
file policy is stored with the file import options and must be reused for editor
edits, desktop AI translation, QA, TM commit, and export.

- `default`: marker-like text may become CAT tag tokens.
- `none`: marker-like text remains ordinary text for that file.

Use `none` only when strings such as `{1}`, `<xxx>`, or `%s` are business text,
not CAT-managed tags. Already imported files keep their existing tokenization;
re-import the file to change this interpretation.
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
npx vitest run apps/desktop/src/shared/fileTagPolicy.test.ts apps/desktop/src/main/filters/SpreadsheetFilter.test.ts apps/desktop/src/renderer/src/hooks/editor/editorTokenPolicy.test.ts apps/desktop/src/renderer/src/hooks/useEditor.test.ts apps/desktop/src/main/services/modules/AIModule.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run desktop typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 4: Run broader build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Inspect git diff**

Run:

```bash
git diff --check
git status --short --untracked-files=all
```

Expected: `git diff --check` emits no output. `git status` lists only intended files.

- [ ] **Step 6: Commit docs**

```bash
git add DOCS/50_MT_REQUEST_MODEL.md
git commit -m "docs: document desktop file tag policy"
```

---

## Self-Review

- Spec coverage:
  - File-level import policy: Task 1 and Task 2.
  - Editor rendering and editing consistency: Task 3.
  - AI file, dialogue, and single-segment paths: Task 4.
  - QA/export/TM boundary: Task 5 documentation; implementation relies on tokens created and preserved by earlier tasks.
  - Existing files not migrated: Task 5 documentation.
- Placeholder scan:
  - No open requirement markers are intentionally left in this plan.
- Type consistency:
  - The policy type is always `TagPolicy` from `@cat/core/tag`.
  - The shared resolver returns `default | none`.
  - Desktop import options carry `tagPolicy?: TagPolicy`.
  - Every AI workflow receives a resolved, non-optional `tagPolicy`.
