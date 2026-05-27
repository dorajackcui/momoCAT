# Headless Tag Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `default|none` tag policy support to headless localization inspect and file translation without changing desktop editor, project import, TM import, or prompt templates.

**Architecture:** `@cat/core/tag` owns pure policy-aware parsing. `@cat/localization` resolves and propagates policy through transient segment creation, MT response parsing, tag validation, and resume identity. `apps/cli` only validates `--tag-policy default|none` and forwards it to localization command APIs.

**Tech Stack:** TypeScript, Vitest, `@cat/core`, `@cat/localization`, `apps/cli`, XLSX-based localization tests.

---

## File Structure

- Modify `packages/core/src/tag/TagCodec.ts`: add `TagPolicy`, parser option normalization, and `none` parser behavior while preserving the legacy `RegExp[]` custom pattern argument.
- Modify `packages/core/src/tag/index.ts`: export `TagPolicy` and new parser option types.
- Modify `packages/core/src/tag/index.test.ts`: cover default compatibility, legacy custom patterns, and `none` display/editor parsing.
- Create `packages/localization/src/tagPolicy.ts`: resolve and validate runtime policy values, plus provide a fingerprint value that preserves default resume identity.
- Modify `packages/localization/src/types.ts`: add `tagPolicy?: TagPolicy` to headless translation options.
- Modify `packages/localization/src/transientSegment.ts`: accept policy options and pass them to core display tokenization.
- Modify `packages/localization/src/transientSegment.test.ts`: cover `none` transient tokenization and source identity behavior.
- Modify `packages/localization/src/modules/MTModuleTypes.ts`: add `tagPolicy?: TagPolicy` to compose/translate input contracts.
- Modify `packages/localization/src/modules/MTModule.ts`: use policy for source payload serialization, MT response parsing, and tag validation gating.
- Modify `packages/localization/src/modules/MTModule.test.ts`: cover `none` payload, response parsing, and skipped tag retry behavior.
- Modify `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`: forward policy to single-unit MT calls.
- Modify `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`: forward policy to dense Window Mode MT calls.
- Modify `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`: forward policy to Partial Window Mode MT calls.
- Modify `packages/localization/src/LocalizationEngine.ts`: resolve policy for translate units, task execution, and resolved file-translation resume fingerprints.
- Modify `packages/localization/src/LocalizationEngine.test.ts`: cover `none` through engine file/job flows and invalid API policy values.
- Modify `packages/localization/src/LocalizationInspector.ts`: resolve policy and use it for inspect transient segments.
- Modify `packages/localization/src/LocalizationInspector.test.ts`: cover inspect artifact payload and tag signature under `none`.
- Modify `packages/localization/src/fileTranslationJobAdapter.ts`: include non-default policy in file job resume fingerprint and job unit source hashes.
- Modify `packages/localization/src/fileTranslationJobAdapter.test.ts`: cover `none` versus default source hash separation and omitted/default compatibility.
- Modify `packages/localization/src/cli/translateFileCommand.ts`: add `tagPolicy` command config and pass it to `TranslateFileInput.options`.
- Modify `packages/localization/src/cli/inspectLocalizationCommand.ts`: add `tagPolicy` command config and pass it to `InspectFileInput.options`.
- Modify `apps/cli/src/commands/translateFileCommand.ts`: parse, validate, help-text, and forward `--tag-policy`.
- Modify `apps/cli/src/commands/inspectLocalizationCommand.ts`: parse, validate, help-text, and forward `--tag-policy`.
- Modify `apps/cli/src/cli.test.ts`: cover CLI forwarding and invalid values for both commands.
- Modify `DOCS/40_CLI_OPERATION.md`: document the new option and when to use `none`.

## Task 1: Core Tag Policy Parser Support

**Files:**
- Modify: `packages/core/src/tag/TagCodec.ts`
- Modify: `packages/core/src/tag/index.ts`
- Test: `packages/core/src/tag/index.test.ts`

- [ ] **Step 1: Write failing core parser tests**

Append these tests to `describe("CAT Core Tokenizer", ...)` and `describe("Editor Tag Marker Conversion", ...)` in `packages/core/src/tag/index.test.ts`:

```ts
  it("treats marker-like display text as plain text when tag policy is none", () => {
    const tokens = parseDisplayTextToTokens("Save {1} {1>name<2} <b>x</b> %s", {
      tagPolicy: "none",
    });

    expect(tokens).toEqual([
      { type: "text", content: "Save {1} {1>name<2} <b>x</b> %s" },
    ]);
    expect(computeTagsSignature(tokens)).toBe("");
  });

  it("keeps the legacy custom pattern argument working", () => {
    const tokens = parseDisplayTextToTokens("prefix @@NAME@@ suffix", [
      /@@[A-Z_]+@@/g,
    ]);

    expect(tokens).toEqual([
      { type: "text", content: "prefix " },
      { type: "tag", content: "@@NAME@@", meta: { id: "@@NAME@@" } },
      { type: "text", content: " suffix" },
    ]);
  });
```

Append this test to `describe("Editor Tag Marker Conversion", ...)`:

```ts
  it("treats editor markers and raw display tags as plain text when tag policy is none", () => {
    const tokens = parseEditorTextToTokens(
      "X {1>Y<2} <b> {3} %s",
      [...sourceTokens],
      { tagPolicy: "none" },
    );

    expect(tokens).toEqual([
      { type: "text", content: "X {1>Y<2} <b> {3} %s" },
    ]);
  });
```

- [ ] **Step 2: Run core tests to verify RED**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts
```

Expected: FAIL with TypeScript/test errors indicating `tagPolicy` is not accepted or `none` still tokenizes tags.

- [ ] **Step 3: Implement core parser policy**

In `packages/core/src/tag/TagCodec.ts`, replace the parser option definitions and `parseDisplayTextToTokens` signature with:

```ts
export type TagPolicy = 'default' | 'none';

export interface ParseDisplayTextOptions {
  displayTagPatterns?: RegExp[];
  tagPolicy?: TagPolicy;
}

export interface ParseEditorTextOptions extends ParseDisplayTextOptions {
  editorMarkerPatterns?: EditorMarkerPattern[];
}

type ParseDisplayTextArgument = RegExp[] | ParseDisplayTextOptions;

function resolveTagPolicy(policy?: TagPolicy): TagPolicy {
  return policy ?? 'default';
}

function normalizeDisplayOptions(options?: ParseDisplayTextArgument): ParseDisplayTextOptions {
  if (Array.isArray(options)) {
    return { displayTagPatterns: options };
  }

  return options ?? {};
}
```

Update `parseDisplayTextToTokens` in the same file:

```ts
export function parseDisplayTextToTokens(
  text: string,
  options?: ParseDisplayTextArgument,
): Token[] {
  const normalizedOptions = normalizeDisplayOptions(options);

  if (resolveTagPolicy(normalizedOptions.tagPolicy) === 'none') {
    return [{ type: 'text', content: text }];
  }

  if (!text) {
    return [{ type: 'text', content: text }];
  }

  const customPatterns = normalizedOptions.displayTagPatterns;
  const hasCustomPatterns = Array.isArray(customPatterns) && customPatterns.length > 0;
  if (!hasCustomPatterns && !/[<{%]/.test(text)) {
    return [{ type: 'text', content: text }];
  }

  const patterns = getDisplayTagPatterns(customPatterns);
  const tokens: Token[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    let nextCandidate: { match: RegExpExecArray; index: number } | null = null;

    for (const pattern of patterns) {
      pattern.lastIndex = cursor;
      const match = pattern.exec(text);
      if (!match || match[0].length === 0) continue;
      if (!nextCandidate || match.index < nextCandidate.index) {
        nextCandidate = { match, index: match.index };
      }
    }

    if (!nextCandidate) {
      pushTextToken(tokens, text.substring(cursor));
      break;
    }

    if (nextCandidate.index > cursor) {
      pushTextToken(tokens, text.substring(cursor, nextCandidate.index));
    }

    tokens.push({
      type: 'tag',
      content: nextCandidate.match[0],
      meta: { id: nextCandidate.match[0] },
    });

    cursor = nextCandidate.index + nextCandidate.match[0].length;
  }

  return tokens.length > 0 ? tokens : [{ type: 'text', content: text }];
}
```

Update `parseEditorTextToTokens` at the top of the function:

```ts
export function parseEditorTextToTokens(
  text: string,
  sourceTokens: Token[],
  options?: ParseEditorTextOptions,
): Token[] {
  if (resolveTagPolicy(options?.tagPolicy) === 'none') {
    return [{ type: 'text', content: text }];
  }

  const markerPatterns = getEditorMarkerPatterns(options?.editorMarkerPatterns);
  const displayPatterns = getDisplayTagPatterns(options?.displayTagPatterns);
  const tokens: Token[] = [];
  let cursor = 0;
```

- [ ] **Step 4: Export policy types**

In `packages/core/src/tag/index.ts`, update the `TagCodec` export block:

```ts
export {
  formatTagAsMemoQMarker,
  parseDisplayTextToTokens,
  parseEditorTextToTokens,
  serializeTokensToEditorText,
  type ParseDisplayTextOptions,
  type ParseEditorTextOptions,
  type TagPolicy,
} from './TagCodec';
```

- [ ] **Step 5: Run core tests to verify GREEN**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts
```

Expected: PASS for all core tag tests.

- [ ] **Step 6: Commit core parser policy**

```bash
git add packages/core/src/tag/TagCodec.ts packages/core/src/tag/index.ts packages/core/src/tag/index.test.ts
git commit -m "feat: add core tag policy parsing"
```

## Task 2: Localization Policy Types and Transient Segments

**Files:**
- Create: `packages/localization/src/tagPolicy.ts`
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/transientSegment.ts`
- Test: `packages/localization/src/transientSegment.test.ts`

- [ ] **Step 1: Write failing transient segment tests**

Add these imports in `packages/localization/src/transientSegment.test.ts`:

```ts
import { parseDisplayTextToTokens } from '@cat/core/tag';
```

Add these tests under `describe('createTransientSegment', ...)`:

```ts
  it('keeps marker-like source and target text plain when tag policy is none', () => {
    const segment = createTransientSegment(
      {
        id: 'row-5',
        source: 'Save {1} {1>name<2} <b>x</b> %s',
        target: '<ok> {3}',
      },
      0,
      {},
      { tagPolicy: 'none' },
    );

    expect(segment.sourceTokens).toEqual([
      { type: 'text', content: 'Save {1} {1>name<2} <b>x</b> %s' },
    ]);
    expect(segment.targetTokens).toEqual([{ type: 'text', content: '<ok> {3}' }]);
    expect(segment.tagsSignature).toBe('');
    expect(segment.matchKey).toBe('save {1} {1>name<2} <b>x</b> %s');
    expect(segment.srcHash).toBe(computeSrcHash(segment.matchKey, ''));
  });

  it('keeps default transient tag recognition when policy is omitted', () => {
    const segment = createTransientSegment(
      { id: 'row-6', source: 'Save {1} <b>x</b> %s' },
      0,
    );

    expect(segment.sourceTokens).toEqual(parseDisplayTextToTokens('Save {1} <b>x</b> %s'));
    expect(segment.tagsSignature).toBe('{1}|<b>|</b>|%s');
  });
```

- [ ] **Step 2: Run transient tests to verify RED**

Run:

```bash
npx vitest run packages/localization/src/transientSegment.test.ts
```

Expected: FAIL because `createTransientSegment` does not accept the fourth argument and still uses default tokenization.

- [ ] **Step 3: Add localization policy helper**

Create `packages/localization/src/tagPolicy.ts`:

```ts
import type { TagPolicy } from '@cat/core/tag';

export function resolveTagPolicy(value: unknown): TagPolicy {
  if (value === undefined || value === null || value === 'default') {
    return 'default';
  }

  if (value === 'none') {
    return 'none';
  }

  throw new Error('tagPolicy must be default or none.');
}

export function tagPolicyFingerprintValue(value: unknown): string | undefined {
  const resolved = resolveTagPolicy(value);
  return resolved === 'none' ? resolved : undefined;
}
```

- [ ] **Step 4: Add `tagPolicy` to localization types**

In `packages/localization/src/types.ts`, add this import:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Update `TranslateUnitsOptions`:

```ts
export interface TranslateUnitsOptions {
  targetScope?: LocalizationTargetScope;
  mode?: LocalizationMode;
  requestMode?: LocalizationRequestMode;
  tagPolicy?: TagPolicy;
  includeReferences?: boolean;
  maxConcurrency?: number;
  batchSize?: number;
  providerOverride?: string;
  mt?: MTModuleOptions;
}
```

- [ ] **Step 5: Implement transient segment policy**

In `packages/localization/src/transientSegment.ts`, update imports:

```ts
import type { Segment } from '@cat/core/models';
import { computeTagsSignature, parseDisplayTextToTokens, type TagPolicy } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import type { ExternalTranslationUnit } from './types';
import { resolveTagPolicy } from './tagPolicy';
```

Add an options interface:

```ts
export interface TransientSegmentOptions {
  tagPolicy?: TagPolicy;
}
```

Update the function signature and tokenization:

```ts
export function createTransientSegment(
  unit: ExternalTranslationUnit,
  orderIndex: number,
  context: TransientSegmentContext = {},
  options: TransientSegmentOptions = {},
): TransientSegment {
  const tagPolicy = resolveTagPolicy(options.tagPolicy);
  const sourceTokens = parseDisplayTextToTokens(unit.source, { tagPolicy });
  const targetTokens = unit.target
    ? parseDisplayTextToTokens(unit.target, { tagPolicy })
    : [];
  const tagsSignature = computeTagsSignature(sourceTokens);
  const matchKey = computeMatchKey(sourceTokens);
```

- [ ] **Step 6: Export transient options**

In `packages/localization/src/index.ts`, update the transient segment type export:

```ts
export type {
  TransientSegment,
  TransientSegmentContext,
  TransientSegmentOptions,
} from './transientSegment';
```

- [ ] **Step 7: Run transient tests to verify GREEN**

Run:

```bash
npx vitest run packages/localization/src/transientSegment.test.ts
```

Expected: PASS for all transient segment tests.

- [ ] **Step 8: Commit localization transient policy**

```bash
git add packages/localization/src/tagPolicy.ts packages/localization/src/types.ts packages/localization/src/transientSegment.ts packages/localization/src/transientSegment.test.ts packages/localization/src/index.ts
git commit -m "feat: add localization tag policy types"
```

## Task 3: MT Module Policy for Payload, Response Parsing, and Validation

**Files:**
- Modify: `packages/localization/src/modules/MTModuleTypes.ts`
- Modify: `packages/localization/src/modules/MTModule.ts`
- Test: `packages/localization/src/modules/MTModule.test.ts`

- [ ] **Step 1: Write failing MT module tests**

In `packages/localization/src/modules/MTModule.test.ts`, add this test near the prompt composition tests:

```ts
  it('passes marker-like source text as ordinary payload when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Plain Marker Payload', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment(
        { id: 'unit-1', source: 'Save {1} {1>name<2} <b>x</b> %s' },
        0,
        { projectId, sourceLanguage: 'en', targetLanguage: 'fr' },
        { tagPolicy: 'none' },
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composePrompt({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        tagPolicy: 'none',
      });

      expect(artifact.sourcePayload).toBe('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).toContain('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).not.toContain('{1>x<2}');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
```

Add this test near the batch prompt composition tests:

```ts
  it('passes marker-like Window Mode source payload as ordinary text when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch Plain Marker Payload', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save {1} {1>name<2} <b>x</b> %s' },
        0,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composeBatchPrompt({
        taskId: 'window-task-plain-markers',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'row-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        tagPolicy: 'none',
      });

      expect(artifact.sourcePayload).toBe('row-2: Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).toContain('Save {1} {1>name<2} <b>x</b> %s');
      expect(artifact.userPrompt).not.toContain('{1>x<2}');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
```

Add this test near the translate tests:

```ts
  it('parses marker-like provider text as plain text and skips tag retry when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Plain Marker Response', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment(
        { id: 'unit-1', source: 'Save {1} <b>x</b>' },
        0,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport('<b>Enregistrer</b> {1>nom<2}');
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      const result = await module.translate({
        unitId: 'unit-1',
        project,
        segment,
        tm: createTMArtifact(segment),
        tb: createTBArtifact(segment),
        tagPolicy: 'none',
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(result.targetTokens).toEqual([
        { type: 'text', content: '<b>Enregistrer</b> {1>nom<2}' },
      ]);
      expect(serializeTokensToDisplayText(result.targetTokens)).toBe('<b>Enregistrer</b> {1>nom<2}');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
```

Add this test near the batch retry test:

```ts
  it('does not retry Window Mode tag validation when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Batch No Tag Retry', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const row2 = createTransientSegment(
        { id: 'row-2', source: 'Save {1} <b>x</b>' },
        1,
        {},
        { tagPolicy: 'none' },
      );
      const transport = createTransport(
        JSON.stringify({
          translations: [{ id: 'row-2', text: 'Enregistrer sans marqueur' }],
        }),
      );
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'unit-2',
            segment: row2,
            tm: createTMArtifact(row2),
            tb: createTBArtifact(row2),
          },
        ],
        previousContext: [],
        nextContext: [],
        tagPolicy: 'none',
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer sans marqueur',
      );
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run MT module tests to verify RED**

Run:

```bash
npx vitest run packages/localization/src/modules/MTModule.test.ts
```

Expected: FAIL because MT input types do not accept `tagPolicy` and response parsing/validation still use default policy.

- [ ] **Step 3: Add policy to MT module input contracts**

In `packages/localization/src/modules/MTModuleTypes.ts`, add:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Update `ComposePromptInput`:

```ts
export interface ComposePromptInput {
  unitId: string;
  project: Project;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  tagPolicy?: TagPolicy;
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}
```

Update `ComposeBatchPromptInput`:

```ts
export interface ComposeBatchPromptInput {
  taskId: string;
  project: Project;
  requestMode?: 'window' | 'window-partial';
  current: MTBatchCurrentUnitInput[];
  previousContext: WindowModePreviousContextRow[];
  nextContext: WindowModeNextContextRow[];
  readOnlyContextRows?: Array<{
    role: 'previous' | 'current-existing' | 'next';
    source: string;
    target?: string;
    rowNumber?: number;
  }>;
  scanWindowCount?: number;
  tagPolicy?: TagPolicy;
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}
```

- [ ] **Step 4: Implement MT policy handling**

In `packages/localization/src/modules/MTModule.ts`, add this import:

```ts
import { resolveTagPolicy } from '../tagPolicy';
```

Add a private helper inside `MTModule`:

```ts
  private serializeSourcePayload(tokens: Segment['sourceTokens'], rawPolicy: unknown): string {
    const sourceText = serializeTokensToDisplayText(tokens);
    const tagPolicy = resolveTagPolicy(rawPolicy);
    return tagPolicy === 'none' ? sourceText : serializeTokensToEditorText(tokens, tokens);
  }
```

In `translate`, resolve policy before the attempt loop:

```ts
    const tagPolicy = resolveTagPolicy(input.tagPolicy);
```

Update response parsing in `translate`:

```ts
      const targetTokens = parseEditorTextToTokens(trimmed, input.segment.sourceTokens, {
        tagPolicy,
      });
      if (promptParams.projectType === 'custom' || tagPolicy === 'none') {
        return { targetTokens, prompt };
      }
```

In `translateBatch`, resolve policy before the attempt loop:

```ts
    const tagPolicy = resolveTagPolicy(input.tagPolicy);
```

Update batch result parsing:

```ts
          targetTokens: parseEditorTextToTokens(translation.text, unit.segment.sourceTokens, {
            tagPolicy,
          }),
```

Update validation gate:

```ts
      if (promptParams.projectType === 'custom' || tagPolicy === 'none') {
        return { results, prompt: attemptPrompt };
      }
```

Update `buildPromptParams` source payload:

```ts
    const sourceText = serializeTokensToDisplayText(input.segment.sourceTokens);
    const sourceTagPreservedText = this.serializeSourcePayload(
      input.segment.sourceTokens,
      input.tagPolicy,
    );
```

Update `buildBatchPromptParams` source payload:

```ts
      const sourcePayload = this.serializeSourcePayload(
        unit.segment.sourceTokens,
        input.tagPolicy,
      );
```

- [ ] **Step 5: Run MT module tests to verify GREEN**

Run:

```bash
npx vitest run packages/localization/src/modules/MTModule.test.ts
```

Expected: PASS for all MT module tests.

- [ ] **Step 6: Commit MT module policy**

```bash
git add packages/localization/src/modules/MTModuleTypes.ts packages/localization/src/modules/MTModule.ts packages/localization/src/modules/MTModule.test.ts
git commit -m "feat: apply tag policy in MT module"
```

## Task 4: Engine, Strategies, and Inspector Policy Propagation

**Files:**
- Modify: `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/LocalizationInspector.ts`
- Test: `packages/localization/src/LocalizationEngine.test.ts`
- Test: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Write failing engine policy tests**

In `packages/localization/src/LocalizationEngine.test.ts`, add this test under `describe('LocalizationEngine.translateUnits', ...)`:

```ts
  it('translates marker-like external units as plain text when tag policy is none', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('External Plain Markers', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const transport = createTransport('Bonjour {1>nom<2}');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: 'unit-1', source: 'Hello {1>name<2} <b>x</b>' }],
        options: { tagPolicy: 'none' },
      });

      expect(result.results[0]).toMatchObject({
        id: 'unit-1',
        source: 'Hello {1>name<2} <b>x</b>',
        target: 'Bonjour {1>nom<2}',
        status: 'translated',
      });
      const request = transport.createResponse.mock.calls[0]?.[0];
      expect(request.userPrompt).toContain('Hello {1>name<2} <b>x</b>');
      expect(request.userPrompt).not.toContain('{1>x<2}');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });
```

Add this test under `describe('LocalizationEngine task executor', ...)`:

```ts
  it('rejects invalid runtime tag policy values before provider requests', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Invalid Tag Policy', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const transport = createTransport('Bonjour');
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await expect(
        engine.translateUnits({
          projectId,
          units: [{ id: 'unit-1', source: 'Hello' }],
          options: { tagPolicy: 'html-only' as never },
        }),
      ).rejects.toThrow('tagPolicy must be default or none.');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Write failing inspector policy test**

In `packages/localization/src/LocalizationInspector.test.ts`, add a test near the existing prompt artifact tests:

```ts
  it('inspects marker-like text as plain source payload when tag policy is none', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspect-policy-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Inspect Plain Markers', 'en', 'fr');
      seedConfiguredAIProvider(db, projectId);
      const inputPath = join(root, 'inspect.xlsx');
      const outputPath = join(root, 'inspect.out.xlsx');
      const jsonOutputPath = join(root, 'inspect.json');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello {1>name<2} <b>x</b> %s', ''],
      ]);
      const inspector = new LocalizationInspector(db, { dbPath: ':memory:' });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath,
        jsonOutputPath,
        options: { tagPolicy: 'none' },
      });

      const unit = result.artifact.units[0];
      expect(unit.transientSegment.tagsSignature).toBe('');
      expect(unit.mt.sourcePayload).toBe('row-2: Hello {1>name<2} <b>x</b> %s');
      expect(unit.mt.userPrompt).toContain('Hello {1>name<2} <b>x</b> %s');
      expect(unit.mt.userPrompt).not.toContain('{1>x<2}');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
```

If `writeWorkbook`, `mkdtemp`, `tmpdir`, `join`, or `rm` already exist in that test file, reuse the existing helpers/imports instead of duplicating them.

- [ ] **Step 3: Run engine and inspector tests to verify RED**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts
```

Expected: FAIL because policy is not resolved or forwarded through engine, strategies, and inspector.

- [ ] **Step 4: Propagate policy through legacy single-unit strategy**

In `packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts`, import `TagPolicy`:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add the field to `LegacySingleUnitConcurrentStrategyInput`:

```ts
  tagPolicy: TagPolicy;
```

Pass it to MT:

```ts
      tagPolicy: input.tagPolicy,
```

- [ ] **Step 5: Propagate policy through dense Window Mode strategy**

In `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`, import `TagPolicy`:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add the field to `WindowModeSequentialBatchStrategyInput`:

```ts
  tagPolicy: TagPolicy;
```

Pass it to `translateBatch`:

```ts
      tagPolicy: input.tagPolicy,
```

- [ ] **Step 6: Propagate policy through Partial Window Mode strategy**

In `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`, import `TagPolicy`:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add the field to `WindowPartialSequentialBatchStrategyInput`:

```ts
  tagPolicy: TagPolicy;
```

Pass it to `translateBatch`:

```ts
      tagPolicy: input.tagPolicy,
```

- [ ] **Step 7: Resolve and pass policy in LocalizationEngine**

In `packages/localization/src/LocalizationEngine.ts`, add imports:

```ts
import type { TagPolicy } from '@cat/core/tag';
import { resolveTagPolicy, tagPolicyFingerprintValue } from './tagPolicy';
```

In `translateUnits`, resolve policy after target scope:

```ts
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
```

Pass it to `prepareUnit`:

```ts
    const preparedUnits = input.units.map((unit, index) =>
      this.prepareUnit(unit, index, project, targetScope, tagPolicy),
    );
```

Pass it to legacy strategy:

```ts
      tagPolicy,
```

In `executeTranslationTask`, resolve policy:

```ts
    const tagPolicy = resolveTagPolicy(translationOptions?.tagPolicy);
```

Pass it to `prepareUnit`:

```ts
    const preparedUnits = task.units.map((unit, index) =>
      this.prepareUnit(jobUnitToExternalUnit(unit), index, project, targetScope, tagPolicy),
    );
```

Pass it to Window Mode strategy:

```ts
      tagPolicy,
```

In `buildFileTranslationResumeFingerprint`, add this entry while preserving default fingerprint compatibility:

```ts
      ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
```

Update `prepareUnit` signature:

```ts
  private prepareUnit(
    unit: ExternalTranslationUnit,
    index: number,
    project: ProjectRecord,
    targetScope: LocalizationTargetScope,
    tagPolicy: TagPolicy,
  ): PreparedUnit {
```

Pass policy to transient segment creation:

```ts
    const segment = createTransientSegment(
      unit,
      index,
      {
        projectId: project.id,
        sourceLanguage: project.srcLang,
        targetLanguage: project.tgtLang,
        fileName: unit.fileName,
      },
      { tagPolicy },
    );
```

- [ ] **Step 8: Resolve and pass policy in LocalizationInspector**

In `packages/localization/src/LocalizationInspector.ts`, add:

```ts
import { resolveTagPolicy } from './tagPolicy';
```

In `inspectFile`, resolve policy near target scope:

```ts
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
```

Pass policy to the Window Mode inspector call:

```ts
        ? await this.inspectRowsWindowPartialMode(
            project,
            rowsWithSegments,
            sourceRows,
            parsed.inputPath,
            maxCellChars,
            targetScope,
            tagPolicy,
          )
        : await this.inspectRowsWindowMode(
            project,
            rowsWithSegments,
            sourceRows,
            parsed.inputPath,
            maxCellChars,
            targetScope,
            tagPolicy,
          );
```

Pass policy to transient segment creation:

```ts
      const segment = createTransientSegment(
        rowToUnit(row, project, parsed.inputPath),
        index,
        {
          projectId: project.id,
          sourceLanguage: project.srcLang,
          targetLanguage: project.tgtLang,
          fileName: basename(parsed.inputPath),
        },
        { tagPolicy },
      );
```

Add `tagPolicy` to `inspectRowsWindowMode`:

```ts
  private async inspectRowsWindowMode(
    project: ProjectRecord,
    rows: InspectRowWithSegment[],
    contextRows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
    targetScope: LocalizationTargetScope,
    tagPolicy: TagPolicy,
  ): Promise<InspectUnitArtifact[]> {
```

Add `tagPolicy` to `inspectRowsWindowPartialMode`:

```ts
  private async inspectRowsWindowPartialMode(
    project: ProjectRecord,
    rows: InspectRowWithSegment[],
    contextRows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
    targetScope: LocalizationTargetScope,
    tagPolicy: TagPolicy,
  ): Promise<InspectUnitArtifact[]> {
```

Pass policy to both `composeBatchPrompt` calls:

```ts
          tagPolicy,
```

Add this import for the private method type:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

- [ ] **Step 9: Run engine and inspector tests to verify GREEN**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts
```

Expected: PASS for the targeted engine and inspector tests.

- [ ] **Step 10: Commit engine and inspector policy propagation**

```bash
git add packages/localization/src/requestModes/legacySingleUnitConcurrent/LegacySingleUnitConcurrentStrategy.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts packages/localization/src/LocalizationEngine.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.ts packages/localization/src/LocalizationInspector.test.ts
git commit -m "feat: propagate tag policy through headless localization"
```

## Task 5: File Job Resume Fingerprint and Command APIs

**Files:**
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Test: `packages/localization/src/fileTranslationJobAdapter.test.ts`
- Modify: `packages/localization/src/cli/translateFileCommand.ts`
- Modify: `packages/localization/src/cli/inspectLocalizationCommand.ts`

- [ ] **Step 1: Write failing file job fingerprint tests**

In `packages/localization/src/fileTranslationJobAdapter.test.ts`, add:

```ts
  it('separates none tag policy from default source hashes without changing explicit default', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Save {1} {1>name<2} <b>x</b> %s', ''],
      ]);

      const omitted = await prepareFileTranslationJob({ projectId: 7, inputPath, outputPath });
      const explicitDefault = await prepareFileTranslationJob({
        projectId: 7,
        inputPath,
        outputPath,
        options: { tagPolicy: 'default' },
      });
      const none = await prepareFileTranslationJob({
        projectId: 7,
        inputPath,
        outputPath,
        options: { tagPolicy: 'none' },
      });

      expect(omitted.job.units[0]?.sourceHash).toBe(explicitDefault.job.units[0]?.sourceHash);
      expect(omitted.job.units[0]?.sourceHash).not.toBe(none.job.units[0]?.sourceHash);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run file job tests to verify RED**

Run:

```bash
npx vitest run packages/localization/src/fileTranslationJobAdapter.test.ts
```

Expected: FAIL because file job resume fingerprint does not include non-default tag policy.

- [ ] **Step 3: Implement file job fingerprint policy**

In `packages/localization/src/fileTranslationJobAdapter.ts`, add:

```ts
import { tagPolicyFingerprintValue } from './tagPolicy';
```

Add the policy entry in `computeFileTranslationResumeFingerprint`:

```ts
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
```

Place it near the existing target/mode/request-mode entries:

```ts
    ['targetScope', resolveBatchTargetScope(input.options?.targetScope)],
    ['mode', input.options?.mode ?? 'standard'],
    ['requestMode', input.options?.requestMode ?? 'window'],
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
```

- [ ] **Step 4: Add localization command config types**

In `packages/localization/src/cli/translateFileCommand.ts`, import `TagPolicy`:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add to `TranslateFileCommandConfig`:

```ts
  tagPolicy?: TagPolicy;
```

Pass it into `options`:

```ts
      options: {
        targetScope: config.targetScope,
        requestMode: config.requestMode,
        tagPolicy: config.tagPolicy,
        batchSize: config.batchSize,
      },
```

In `packages/localization/src/cli/inspectLocalizationCommand.ts`, import `TagPolicy`:

```ts
import type { TagPolicy } from '@cat/core/tag';
```

Add to `InspectLocalizationCommandConfig`:

```ts
  tagPolicy?: TagPolicy;
```

Pass it into `options`:

```ts
      options: {
        requestMode: config.requestMode,
        tagPolicy: config.tagPolicy,
      },
```

- [ ] **Step 5: Run file job tests to verify GREEN**

Run:

```bash
npx vitest run packages/localization/src/fileTranslationJobAdapter.test.ts
```

Expected: PASS for all file job adapter tests.

- [ ] **Step 6: Commit file job and command API policy**

```bash
git add packages/localization/src/fileTranslationJobAdapter.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/cli/translateFileCommand.ts packages/localization/src/cli/inspectLocalizationCommand.ts
git commit -m "feat: include tag policy in file jobs"
```

## Task 6: CLI Flags and CLI Documentation

**Files:**
- Modify: `apps/cli/src/commands/translateFileCommand.ts`
- Modify: `apps/cli/src/commands/inspectLocalizationCommand.ts`
- Test: `apps/cli/src/cli.test.ts`
- Modify: `DOCS/40_CLI_OPERATION.md`

- [ ] **Step 1: Write failing CLI tests**

In `apps/cli/src/cli.test.ts`, update the inspect localization help test:

```ts
    expect(harness.stdout.join('')).toContain('--tag-policy <policy>');
```

Update the inspect localization mapping test argument list:

```ts
        '--tag-policy',
        'none',
```

Update its expected config:

```ts
          tagPolicy: 'none',
```

Add this inspect invalid-value test:

```ts
  it('reports inspect localization invalid tag policy before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'inspect',
        'localization',
        '--db',
        'cat.db',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'inspect.xlsx',
        '--tag-policy',
        'html-only',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('--tag-policy must be default or none.');
    expect(harness.stderr.join('')).toContain('Run: momocat inspect localization --help');
  });
```

Update the translate file help test:

```ts
    expect(harness.stdout.join('')).toContain('--tag-policy <policy>');
```

Update the translate file mapping test argument list:

```ts
        '--tag-policy=none',
```

Update its expected config:

```ts
          tagPolicy: 'none',
```

Add this translate invalid-value test:

```ts
  it('reports translate file invalid tag policy before calling localization', async () => {
    const harness = createHarness();
    const exitCode = await runCli(
      [
        'translate',
        'file',
        '--db',
        'cat.db',
        '--project-id',
        '7',
        '--input',
        'input.xlsx',
        '--output',
        'translated.xlsx',
        '--tag-policy',
        'html-only',
      ],
      harness.deps,
      harness.io,
    );

    expect(exitCode).toBe(1);
    expect(harness.calls).toEqual([]);
    expect(harness.stderr.join('')).toContain('--tag-policy must be default or none.');
    expect(harness.stderr.join('')).toContain('Run: momocat translate file --help');
  });
```

- [ ] **Step 2: Run CLI tests to verify RED**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: FAIL because `--tag-policy` is unknown.

- [ ] **Step 3: Implement translate file CLI flag**

In `apps/cli/src/commands/translateFileCommand.ts`, add to `assignOption`:

```ts
  if (name === 'tag-policy') {
    if (optionValue !== 'default' && optionValue !== 'none') {
      throw new Error('--tag-policy must be default or none.');
    }
    config.tagPolicy = optionValue;
    return;
  }
```

Add to `isKnownOption`:

```ts
    name === 'tag-policy' ||
```

Add to help text after `--request-mode`:

```text
  --tag-policy <policy>            default or none.
```

- [ ] **Step 4: Implement inspect localization CLI flag**

In `apps/cli/src/commands/inspectLocalizationCommand.ts`, add to `assignOption`:

```ts
  if (name === 'tag-policy') {
    if (optionValue !== 'default' && optionValue !== 'none') {
      throw new Error('--tag-policy must be default or none.');
    }
    config.tagPolicy = optionValue;
    return;
  }
```

Add to `isKnownOption`:

```ts
    name === 'tag-policy' ||
```

Add to help text after `--request-mode`:

```text
  --tag-policy <policy>            default or none.
```

- [ ] **Step 5: Update CLI operation docs**

In `DOCS/40_CLI_OPERATION.md`, update inspect examples:

```md
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --tag-policy none
```

Update translate examples:

```md
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --tag-policy none
```

Add this note under `Translate File`:

```md
Tag policy defaults to current CAT marker detection. Use `--tag-policy none`
when input text has already been filtered upstream, or when marker-like content
such as `{1}`, `{1>`, `<2}`, `{3}`, `<xxx>`, or `%s` must remain ordinary text.
```

- [ ] **Step 6: Run CLI tests to verify GREEN**

Run:

```bash
npx vitest run apps/cli/src/cli.test.ts
```

Expected: PASS for all CLI dispatch tests.

- [ ] **Step 7: Commit CLI flag and docs**

```bash
git add apps/cli/src/commands/translateFileCommand.ts apps/cli/src/commands/inspectLocalizationCommand.ts apps/cli/src/cli.test.ts DOCS/40_CLI_OPERATION.md
git commit -m "feat: expose headless tag policy CLI flag"
```

## Task 7: Final Verification

**Files:**
- Verify all modified files from Tasks 1-6.

- [ ] **Step 1: Run targeted tag policy test set**

Run:

```bash
npx vitest run packages/core/src/tag/index.test.ts packages/localization/src/transientSegment.test.ts packages/localization/src/modules/MTModule.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts apps/cli/src/cli.test.ts
```

Expected: PASS for all targeted suites.

- [ ] **Step 2: Run localization package build**

Run:

```bash
npm run build --workspace=packages/localization
```

Expected: exit code 0 with TypeScript and bundle build success.

- [ ] **Step 3: Run CLI package build**

Run:

```bash
npm run build --workspace=apps/cli
```

Expected: exit code 0 with TypeScript and CLI bundle build success.

- [ ] **Step 4: Run repo-level tests if time and native modules allow**

Run:

```bash
npm test
```

Expected: exit code 0. If native rebuild or environment permissions fail, record the exact command, exit code, and first actionable error.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
```

Expected: only intended files changed since the last task commit, or a clean tree if all task commits were made.

- [ ] **Step 6: Final commit for verification/doc polish if needed**

If Step 5 shows only small verification-driven doc or test adjustments, commit them:

```bash
git add DOCS/40_CLI_OPERATION.md packages/core/src/tag packages/localization/src apps/cli/src
git commit -m "test: verify headless tag policy"
```

Expected: commit succeeds, or no commit is needed because Task 6 left a clean tree.
