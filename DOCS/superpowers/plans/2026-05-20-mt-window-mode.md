# MT Window Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Window Mode the default `translate:file` request model: ordered batches of 1-5 current segments with previous translated context, next source context, per-segment TM/concordance/TB/context, and strict JSON responses.

**Architecture:** Add pure Window Mode prompt and response helpers in `@cat/core/project`. Use `@cat/localization` to plan ordered file batches, collect per-current-segment references and context windows, call `MTModule.translateBatch`, and preserve per-unit checkpoint/event/snapshot/output behavior. Keep `translateUnits` on the existing single-unit path for this increment while `translate:file` job mode becomes Window Mode by default.

**Tech Stack:** TypeScript, Vitest, `@cat/core/project`, `@cat/localization`, existing AI transport port, existing JSONL checkpoint/event/artifact stores, existing spreadsheet adapter.

---

## File Structure

Create focused pure core files:

- `packages/core/src/project/windowModePromptTypes.ts`
  - Owns Window Mode prompt input, output, sections, and strict JSON parser result types.
- `packages/core/src/project/windowModePrompt.ts`
  - Owns Window Mode prompt rendering and strict JSON response parsing.
- `packages/core/src/project/windowModePrompt.test.ts`
  - Covers prompt shape and parser failures.

Modify existing project exports:

- `packages/core/src/project/index.ts`
  - Exports Window Mode builders, parser, and types.

Modify localization task planning and execution boundaries:

- `packages/localization/src/job/TaskPlanner.ts`
  - Adds `WindowModeTaskPlanner` and `normalizeWindowModeBatchSize`.
- `packages/localization/src/job/TaskPlanner.test.ts`
  - Covers default/custom batch sizes and validation.
- `packages/localization/src/job/types.ts`
  - Adds read-only completed result snapshot to `TaskExecutionContext`.
- `packages/localization/src/job/TranslationJobRunner.ts`
  - Passes completed result snapshots into each task attempt.
- `packages/localization/src/job/TranslationJobRunner.test.ts`
  - Verifies snapshots are available to later ordered tasks.
- `packages/localization/src/types.ts`
  - Adds `batchSize?: number` to `TranslateUnitsOptions`.
- `packages/localization/src/fileTranslationJobAdapter.ts`
  - Uses `WindowModeTaskPlanner` by default and forces same-file task concurrency to `1`.
- `packages/localization/src/fileTranslationJobAdapter.test.ts`
  - Covers batch size propagation and forced ordered job options.
- `packages/localization/src/cli/translateFileCommand.ts`
  - Passes `batchSize` into localization options.
- `scripts/translate-file.mjs`
  - Adds `--batch-size`.

Modify MT artifacts and MT module:

- `packages/localization/src/artifacts.ts`
  - Adds optional Window Mode batch metadata to `PromptArtifact`.
- `packages/localization/src/modules/MTModule.ts`
  - Adds `composeBatchPrompt` and `translateBatch`.
- `packages/localization/src/modules/MTModule.test.ts`
  - Covers batch prompt composition, strict JSON parsing, and response id errors.

Modify engine orchestration:

- `packages/localization/src/LocalizationEngine.ts`
  - Supports multi-unit Window Mode tasks in `executeTranslationTask`.
  - Builds previous/next context windows.
  - Resolves TM/concordance/TB per current segment.
- `packages/localization/src/LocalizationEngine.test.ts`
  - Covers real file-job Window Mode behavior, ordered requests, previous target context, per-unit references, checkpoint reuse, and skipped context.

Modify inspect:

- `packages/localization/src/LocalizationInspector.ts`
  - Composes Window Mode batch prompt artifacts without provider calls.
- `packages/localization/src/LocalizationInspector.test.ts`
  - Verifies inspect JSON/workbook show Window Mode batch prompt material and no API keys.

Modify docs after implementation:

- `DOCS/agent-first/MT_MODULE.md`
  - Update current request model from one-unit MVP to Window Mode default for `translate:file`.
- `DOCS/agent-first/CLI.md`
  - Document `--batch-size`.

---

### Task 1: Core Window Mode Prompt And Strict JSON Parser

**Files:**
- Create: `packages/core/src/project/windowModePromptTypes.ts`
- Create: `packages/core/src/project/windowModePrompt.ts`
- Create: `packages/core/src/project/windowModePrompt.test.ts`
- Modify: `packages/core/src/project/index.ts`

- [ ] **Step 1: Write failing core prompt/parser tests**

Create `packages/core/src/project/windowModePrompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildAIWindowModePromptBundle,
  parseAIWindowModeResponse,
} from "./index";

describe("Window Mode prompt builder", () => {
  it("builds a compact batch prompt with per-segment references and id-free context rows", () => {
    const bundle = buildAIWindowModePromptBundle({
      srcLang: "en",
      tgtLang: "fr",
      projectPrompt: "Use concise UI language.",
      currentSegments: [
        {
          id: "row-2",
          sourcePayload: "{1>}Save file<2}",
          context: "Toolbar label",
          tmReferences: [
            {
              similarity: 100,
              tmName: "Main TM",
              sourceText: "Save file",
              targetText: "Enregistrer le fichier",
            },
          ],
          concordanceReferences: [
            {
              tmName: "Main TM",
              matchedSourceText: "file",
              sourceText: "Open file",
              targetText: "Ouvrir le fichier",
            },
          ],
          tbReferences: [
            {
              srcTerm: "Save",
              tgtTerm: "Enregistrer",
              note: "Use the UI verb.",
            },
          ],
        },
        {
          id: "row-3",
          sourcePayload: "Close",
          context: "Button",
        },
      ],
      previousContext: [
        {
          source: "Open",
          target: "Ouvrir",
        },
      ],
      nextContext: [
        {
          source: "Preferences",
        },
      ],
    });

    expect(bundle.systemPrompt).toContain("Use concise UI language.");
    expect(bundle.systemPrompt).toContain("Return strict JSON only");
    expect(bundle.userPrompt).toContain("Current segments to translate");
    expect(bundle.userPrompt).toContain("id: row-2");
    expect(bundle.userPrompt).toContain("{1>}Save file<2}");
    expect(bundle.userPrompt).toContain("TM References");
    expect(bundle.userPrompt).toContain("Concordance Suggestions");
    expect(bundle.userPrompt).toContain("Terminology References");
    expect(bundle.userPrompt).toContain("Context:");
    expect(bundle.userPrompt).toContain("Previous 5 translated rows");
    expect(bundle.userPrompt).toContain("1. Open -> Ouvrir");
    expect(bundle.userPrompt).toContain("Next 5 source rows");
    expect(bundle.userPrompt).toContain("1. Preferences");
    expect(bundle.userPrompt).not.toContain("documentId");
    expect(bundle.userPrompt).not.toContain("unitId");
    expect(bundle.sections.previousContextBlock).toBe("Previous 5 translated rows\n1. Open -> Ouvrir");
    expect(bundle.sections.nextContextBlock).toBe("Next 5 source rows\n1. Preferences");
  });
});

describe("Window Mode strict JSON parser", () => {
  it("returns translations in expected id order", () => {
    expect(
      parseAIWindowModeResponse(
        JSON.stringify({
          translations: [
            { id: "row-3", text: "Fermer" },
            { id: "row-2", text: "Enregistrer le fichier" },
          ],
        }),
        ["row-2", "row-3"],
      ),
    ).toEqual([
      { id: "row-2", text: "Enregistrer le fichier" },
      { id: "row-3", text: "Fermer" },
    ]);
  });

  it.each([
    ["", /response was empty/i],
    ["```json\n{\"translations\":[]}\n```", /invalid strict JSON/i],
    ["{}", /translations must be an array/i],
    [JSON.stringify({ translations: [{ id: "row-2", text: "A" }], extra: true }), /unexpected top-level field/i],
    [JSON.stringify({ translations: [{ id: "row-9", text: "A" }] }), /unknown translation id/i],
    [JSON.stringify({ translations: [{ id: "row-2", text: "A" }, { id: "row-2", text: "B" }] }), /duplicate translation id/i],
    [JSON.stringify({ translations: [{ id: "row-2" }] }), /translation text must be a string/i],
    [JSON.stringify({ translations: [{ id: "row-2", text: "A" }] }), /missing translation id/i],
  ])("rejects invalid response %#", (content, message) => {
    expect(() => parseAIWindowModeResponse(content, ["row-2", "row-3"])).toThrow(message);
  });
});
```

- [ ] **Step 2: Run the failing core test**

Run:

```bash
npx vitest run packages/core/src/project/windowModePrompt.test.ts
```

Expected: fail because `windowModePrompt.test.ts` imports `buildAIWindowModePromptBundle` and `parseAIWindowModeResponse` before they exist.

- [ ] **Step 3: Add Window Mode prompt types**

Create `packages/core/src/project/windowModePromptTypes.ts`:

```ts
import type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
} from "./aiPromptTypes";

export interface WindowModeCurrentSegment {
  id: string;
  sourcePayload: string;
  context?: string;
  tmReferences?: PromptTMReference[];
  concordanceReferences?: PromptConcordanceReference[];
  tbReferences?: PromptTBReference[];
}

export interface WindowModePreviousContextRow {
  source: string;
  target: string;
}

export interface WindowModeNextContextRow {
  source: string;
}

export interface WindowModePromptBuildParams {
  srcLang: string;
  tgtLang: string;
  projectPrompt?: string;
  currentSegments: WindowModeCurrentSegment[];
  previousContext?: WindowModePreviousContextRow[];
  nextContext?: WindowModeNextContextRow[];
  validationFeedback?: string;
}

export interface WindowModePromptSections {
  batchBlock: string;
  currentSegmentsBlock: string;
  previousContextBlock: string;
  nextContextBlock: string;
  responseFormatBlock: string;
  validationFeedbackBlock: string;
  referencePromptBlock: string;
}

export interface WindowModePromptBundle {
  systemPrompt: string;
  userPrompt: string;
  sections: WindowModePromptSections;
}

export interface WindowModeTranslation {
  id: string;
  text: string;
}
```

- [ ] **Step 4: Add Window Mode prompt builder and parser**

Create `packages/core/src/project/windowModePrompt.ts`:

```ts
import { buildAISystemPrompt } from "./aiPromptTemplates";
import type {
  WindowModeCurrentSegment,
  WindowModeNextContextRow,
  WindowModePreviousContextRow,
  WindowModePromptBuildParams,
  WindowModePromptBundle,
  WindowModeTranslation,
} from "./windowModePromptTypes";

function joinBlock(lines: string[]): string {
  return lines.filter((line) => line.length > 0).join("\n");
}

function joinPromptBlocks(blocks: string[]): string {
  return blocks.filter((block) => block.length > 0).join("\n\n");
}

function formatCurrentSegment(segment: WindowModeCurrentSegment, index: number): string {
  return joinPromptBlocks([
    joinBlock([`${index + 1}. id: ${segment.id}`, "Source:", segment.sourcePayload]),
    formatTMReferences(segment),
    formatConcordanceReferences(segment),
    formatTBReferences(segment),
    formatSegmentContext(segment),
  ]);
}

function formatTMReferences(segment: WindowModeCurrentSegment): string {
  const references = segment.tmReferences ?? [];
  if (references.length === 0) return "";

  return joinBlock([
    "TM References:",
    ...references.flatMap((reference) => [
      `- Similarity: ${reference.similarity}% | TM: ${reference.tmName}`,
      `  Source: ${reference.sourceText}`,
      `  Target: ${reference.targetText}`,
    ]),
  ]);
}

function formatConcordanceReferences(segment: WindowModeCurrentSegment): string {
  const references = segment.concordanceReferences ?? [];
  if (references.length === 0) return "";

  return joinBlock([
    "Concordance Suggestions:",
    ...references.flatMap((reference) => [
      `- Match: ${reference.matchedSourceText} | TM: ${reference.tmName}`,
      `  Source: ${reference.sourceText}`,
      `  Target: ${reference.targetText}`,
    ]),
  ]);
}

function formatTBReferences(segment: WindowModeCurrentSegment): string {
  const references = segment.tbReferences ?? [];
  if (references.length === 0) return "";

  return joinBlock([
    "Terminology References:",
    ...references.map((reference) => {
      const note = typeof reference.note === "string" && reference.note.trim()
        ? ` (note: ${reference.note.trim()})`
        : "";
      return `- ${reference.srcTerm} => ${reference.tgtTerm}${note}`;
    }),
  ]);
}

function formatSegmentContext(segment: WindowModeCurrentSegment): string {
  const context = segment.context?.trim();
  if (!context) return "";
  return joinBlock(["Context:", context]);
}

function formatPreviousContext(rows: WindowModePreviousContextRow[] = []): string {
  if (rows.length === 0) return "";
  return joinBlock([
    "Previous 5 translated rows",
    ...rows.map((row, index) => `${index + 1}. ${row.source} -> ${row.target}`),
  ]);
}

function formatNextContext(rows: WindowModeNextContextRow[] = []): string {
  if (rows.length === 0) return "";
  return joinBlock([
    "Next 5 source rows",
    ...rows.map((row, index) => `${index + 1}. ${row.source}`),
  ]);
}

function formatValidationFeedback(feedback?: string): string {
  const trimmed = feedback?.trim();
  if (!trimmed) return "";
  return joinBlock(["Validation feedback from previous attempt:", trimmed]);
}

function buildWindowModeSystemPrompt(params: WindowModePromptBuildParams): string {
  return joinPromptBlocks([
    buildAISystemPrompt("translation", {
      srcLang: params.srcLang,
      tgtLang: params.tgtLang,
      projectPrompt: params.projectPrompt,
    }),
    [
      "Window Mode batch rules:",
      "- Translate only the current segments listed in the user prompt.",
      "- Use each segment's TM, Concordance, TB, and Context only for that segment.",
      "- Use previous translated rows and next source rows only as context.",
      "- Preserve all markers, tags, placeholders, and escape sequences exactly as they appear in Source.",
      "- Return strict JSON only, with no Markdown, no explanation, and no extra text.",
    ].join("\n"),
  ]);
}

export function buildAIWindowModePromptBundle(
  params: WindowModePromptBuildParams,
): WindowModePromptBundle {
  if (params.currentSegments.length === 0) {
    throw new Error("Window Mode requires at least one current segment.");
  }

  const ids = params.currentSegments.map((segment) => segment.id);
  const batchBlock = joinBlock([
    "Batch",
    `- Source language: ${params.srcLang}`,
    `- Target language: ${params.tgtLang}`,
    `- Current segments: ${params.currentSegments.length}`,
    `- Return translations for ids: ${ids.join(", ")}`,
  ]);
  const currentSegmentsBlock = joinPromptBlocks([
    "Current segments to translate",
    ...params.currentSegments.map(formatCurrentSegment),
  ]);
  const previousContextBlock = formatPreviousContext(params.previousContext);
  const nextContextBlock = formatNextContext(params.nextContext);
  const validationFeedbackBlock = formatValidationFeedback(params.validationFeedback);
  const responseFormatBlock = [
    "Return strict JSON only:",
    '{"translations":[{"id":"<segment-id>","text":"<translated text>"}]}',
  ].join("\n");

  return {
    systemPrompt: buildWindowModeSystemPrompt(params),
    userPrompt: joinPromptBlocks([
      batchBlock,
      currentSegmentsBlock,
      previousContextBlock,
      nextContextBlock,
      validationFeedbackBlock,
      responseFormatBlock,
    ]),
    sections: {
      batchBlock,
      currentSegmentsBlock,
      previousContextBlock,
      nextContextBlock,
      responseFormatBlock,
      validationFeedbackBlock,
      referencePromptBlock: currentSegmentsBlock,
    },
  };
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseAIWindowModeResponse(
  content: string,
  expectedIds: string[],
): WindowModeTranslation[] {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Window Mode response was empty.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error("Window Mode response was invalid strict JSON.");
  }

  if (!isRecord(parsed)) {
    throw new Error("Window Mode response must be a JSON object.");
  }

  const topLevelKeys = Object.keys(parsed);
  const unexpectedKey = topLevelKeys.find((key) => key !== "translations");
  if (unexpectedKey) {
    throw new Error(`Window Mode response had unexpected top-level field: ${unexpectedKey}`);
  }

  if (!Array.isArray(parsed.translations)) {
    throw new Error("Window Mode translations must be an array.");
  }

  const expectedSet = new Set(expectedIds);
  const byId = new Map<string, WindowModeTranslation>();

  for (const item of parsed.translations) {
    if (!isRecord(item)) {
      throw new Error("Window Mode translation entries must be JSON objects.");
    }

    if (typeof item.id !== "string" || !item.id.trim()) {
      throw new Error("Window Mode translation id must be a non-empty string.");
    }
    if (!expectedSet.has(item.id)) {
      throw new Error(`Window Mode response included unknown translation id: ${item.id}`);
    }
    if (byId.has(item.id)) {
      throw new Error(`Window Mode response included duplicate translation id: ${item.id}`);
    }
    if (typeof item.text !== "string") {
      throw new Error(`Window Mode translation text must be a string for id: ${item.id}`);
    }

    byId.set(item.id, {
      id: item.id,
      text: item.text,
    });
  }

  for (const id of expectedIds) {
    if (!byId.has(id)) {
      throw new Error(`Window Mode response is missing translation id: ${id}`);
    }
  }

  return expectedIds.map((id) => {
    const translation = byId.get(id);
    if (!translation) {
      throw new Error(`Window Mode response is missing translation id: ${id}`);
    }
    return translation;
  });
}
```

- [ ] **Step 5: Export Window Mode helpers**

Modify `packages/core/src/project/index.ts` by adding:

```ts
export {
  buildAIWindowModePromptBundle,
  parseAIWindowModeResponse,
} from "./windowModePrompt";
export type {
  WindowModeCurrentSegment,
  WindowModeNextContextRow,
  WindowModePreviousContextRow,
  WindowModePromptBuildParams,
  WindowModePromptBundle,
  WindowModePromptSections,
  WindowModeTranslation,
} from "./windowModePromptTypes";
```

- [ ] **Step 6: Run core prompt/parser tests**

Run:

```bash
npx vitest run packages/core/src/project/windowModePrompt.test.ts packages/core/src/project/index.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit core prompt/parser work**

Run:

```bash
git add packages/core/src/project/windowModePromptTypes.ts packages/core/src/project/windowModePrompt.ts packages/core/src/project/windowModePrompt.test.ts packages/core/src/project/index.ts
git commit -m "feat: add mt window mode prompt parser"
```

---

### Task 2: Ordered Window Mode Job Planning And CLI Batch Size

**Files:**
- Modify: `packages/localization/src/types.ts`
- Modify: `packages/localization/src/job/types.ts`
- Modify: `packages/localization/src/job/TaskPlanner.ts`
- Modify: `packages/localization/src/job/TaskPlanner.test.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.ts`
- Modify: `packages/localization/src/job/TranslationJobRunner.test.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.ts`
- Modify: `packages/localization/src/fileTranslationJobAdapter.test.ts`
- Modify: `packages/localization/src/cli/translateFileCommand.ts`
- Modify: `packages/localization/src/index.ts`
- Modify: `scripts/translate-file.mjs`

- [ ] **Step 1: Write failing planner tests**

Append to `packages/localization/src/job/TaskPlanner.test.ts`:

```ts
import {
  DEFAULT_WINDOW_MODE_BATCH_SIZE,
  WindowModeTaskPlanner,
  normalizeWindowModeBatchSize,
} from './TaskPlanner';

describe('WindowModeTaskPlanner', () => {
  it('groups units into deterministic default batches of five', () => {
    const units = Array.from({ length: 12 }, (_, index) =>
      makeUnit({ unitId: `unit-${index + 1}`, sourceHash: `hash-${index + 1}` }),
    );

    expect(new WindowModeTaskPlanner().plan(units)).toEqual([
      { taskId: 'window-task-1', units: units.slice(0, 5) },
      { taskId: 'window-task-2', units: units.slice(5, 10) },
      { taskId: 'window-task-3', units: units.slice(10, 12) },
    ]);
    expect(DEFAULT_WINDOW_MODE_BATCH_SIZE).toBe(5);
  });

  it('uses custom batch sizes from one to five', () => {
    const units = [
      makeUnit({ unitId: 'unit-1' }),
      makeUnit({ unitId: 'unit-2' }),
      makeUnit({ unitId: 'unit-3' }),
    ];

    expect(new WindowModeTaskPlanner({ batchSize: 2 }).plan(units)).toEqual([
      { taskId: 'window-task-1', units: units.slice(0, 2) },
      { taskId: 'window-task-2', units: units.slice(2, 3) },
    ]);
  });

  it.each([0, -1, 1.5, Number.NaN, 6])('rejects invalid batch size %s', (batchSize) => {
    expect(() => normalizeWindowModeBatchSize(batchSize)).toThrow(
      'Window Mode batchSize must be an integer from 1 to 5.',
    );
  });
});
```

- [ ] **Step 2: Run the failing planner tests**

Run:

```bash
npx vitest run packages/localization/src/job/TaskPlanner.test.ts
```

Expected: fail because `WindowModeTaskPlanner` is not exported.

- [ ] **Step 3: Implement Window Mode planner**

Modify `packages/localization/src/job/TaskPlanner.ts`:

```ts
import type { JobUnit, TranslationTask } from './types';

export interface TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[];
}

export class OneUnitTaskPlanner implements TaskPlanner {
  plan(units: JobUnit[]): TranslationTask[] {
    return units.map((unit, index) => ({
      taskId: `task-${index + 1}`,
      units: [unit],
    }));
  }
}

export const DEFAULT_WINDOW_MODE_BATCH_SIZE = 5;
export const MAX_WINDOW_MODE_BATCH_SIZE = 5;

export interface WindowModeTaskPlannerOptions {
  batchSize?: number;
}

export function normalizeWindowModeBatchSize(value?: number): number {
  if (value === undefined) {
    return DEFAULT_WINDOW_MODE_BATCH_SIZE;
  }

  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_WINDOW_MODE_BATCH_SIZE
  ) {
    throw new Error('Window Mode batchSize must be an integer from 1 to 5.');
  }

  return value;
}

export class WindowModeTaskPlanner implements TaskPlanner {
  private readonly batchSize: number;

  constructor(options: WindowModeTaskPlannerOptions = {}) {
    this.batchSize = normalizeWindowModeBatchSize(options.batchSize);
  }

  plan(units: JobUnit[]): TranslationTask[] {
    const tasks: TranslationTask[] = [];

    for (let index = 0; index < units.length; index += this.batchSize) {
      tasks.push({
        taskId: `window-task-${tasks.length + 1}`,
        units: units.slice(index, index + this.batchSize),
      });
    }

    return tasks;
  }
}
```

- [ ] **Step 4: Add batch size option to public types**

Modify `packages/localization/src/types.ts`:

```ts
export interface TranslateUnitsOptions {
  targetScope?: LocalizationTargetScope;
  mode?: LocalizationMode;
  includeReferences?: boolean;
  maxConcurrency?: number;
  batchSize?: number;
  providerOverride?: string;
  mt?: MTModuleOptions;
}
```

- [ ] **Step 5: Pass completed result snapshots to task executors**

Modify `packages/localization/src/job/types.ts`:

```ts
export interface TaskExecutionContext {
  job: TranslationJob;
  attempt: number;
  captureArtifacts?: boolean;
  completedResults?: ReadonlyMap<string, UnitResult>;
}
```

Modify `packages/localization/src/job/TranslationJobRunner.ts`:

```ts
const taskResult = await this.executeTaskWithAttempts(job, task, maxAttempts, resultMap);
```

Change the method signature and executor call:

```ts
private async executeTaskWithAttempts(
  job: TranslationJob,
  task: TranslationTask,
  maxAttempts: number,
  completedResults: ReadonlyMap<string, UnitResult>,
): Promise<TaskExecutionResult> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await this.taskExecutor(task, {
        job,
        attempt,
        captureArtifacts: Boolean(this.artifactStore),
        completedResults: new Map(completedResults),
      });

      return {
        results: normalizeTaskResults(job, task, result.results, attempt),
        artifacts: result.artifacts,
      };
    } catch (error) {
      lastError = error;
    }
  }
```

- [ ] **Step 6: Add runner snapshot regression test**

Append to `packages/localization/src/job/TranslationJobRunner.test.ts`:

```ts
  it('passes completed result snapshots into later ordered tasks', async () => {
    const harness = await makeHarness();
    const completedSnapshots: string[][] = [];
    const runner = harness.makeRunner(
      async (task, context) => {
        completedSnapshots.push(
          Array.from(context.completedResults?.values() ?? []).map((result) => result.unitId),
        );

        return {
          results: [
            makeResult({
              unitId: task.units[0].unitId,
              sourceHash: task.units[0].sourceHash,
              source: task.units[0].source,
              target: `target ${task.units[0].unitId}`,
            }),
          ],
        };
      },
      { taskPlanner: new OneUnitTaskPlanner() },
    );

    await runner.run(
      makeJob({
        units: [
          makeUnit({ unitId: 'unit-1', sourceHash: 'hash-1' }),
          makeUnit({ unitId: 'unit-2', sourceHash: 'hash-2' }),
        ],
        options: { maxConcurrency: 1 },
      }),
    );

    expect(completedSnapshots).toEqual([[], ['unit-1']]);
  });
```

- [ ] **Step 7: Use Window Mode planner and force same-file order in file jobs**

Modify `packages/localization/src/fileTranslationJobAdapter.ts` import:

```ts
import { WindowModeTaskPlanner } from './job/TaskPlanner';
```

Modify `translateSpreadsheetFileJob`:

```ts
prepared.job.options = {
  ...prepared.job.options,
  maxConcurrency: 1,
};
const runnerDependencies: TranslationJobRunnerDependencies = {
  checkpointStore: new CheckpointStore(prepared.sidecarPaths.checkpointPath),
  eventSink: new EventSink(prepared.sidecarPaths.eventsPath, {
    stdout: input.job?.progressStdout,
  }),
  taskPlanner: new WindowModeTaskPlanner({ batchSize: input.options?.batchSize }),
  taskExecutor: options.taskExecutor,
  writeSnapshot: async (results) => {
```

- [ ] **Step 8: Add file job adapter tests for batch size and forced order**

Modify the import in `packages/localization/src/fileTranslationJobAdapter.test.ts`:

```ts
import type {
  TranslationJob,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
} from './job/types';
```

Append to `packages/localization/src/fileTranslationJobAdapter.test.ts`:

```ts
  it('uses Window Mode planner with configured batch size and ordered job concurrency', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-window-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['One', ''],
        ['Two', ''],
        ['Three', ''],
      ]);
      const outputPath = join(root, 'out.xlsx');
      const seenJobs: TranslationJob[] = [];
      const seenTasks: TranslationTask[][] = [];

      await translateSpreadsheetFileJob(
        {
          projectId: 1,
          inputPath,
          outputPath,
          options: { batchSize: 2, maxConcurrency: 8 },
          job: { maxAttempts: 1 },
        },
        {
          taskExecutor: async (task, context) => {
            return {
              results: task.units.map((unit) => ({
                jobId: context.job.id,
                documentId: unit.documentId,
                unitId: unit.unitId,
                sourceHash: unit.sourceHash,
                status: 'translated' as const,
                source: unit.source,
                target: `target ${unit.unitId}`,
              })),
            };
          },
          runnerFactory: (dependencies) => ({
            run: async (job) => {
              seenJobs.push(job);
              const tasks = dependencies.taskPlanner.plan(job.units);
              seenTasks.push(tasks);
              return {
                jobId: job.id,
                summary: { total: 3, translated: 3, skipped: 0, reused: 0, failed: 0 },
                results: [],
              };
            },
          }),
        },
      );

      expect(seenJobs[0].options?.maxConcurrency).toBe(1);
      expect(seenTasks[0].map((task) => task.units.map((unit) => unit.unitId))).toEqual([
        ['row-2', 'row-3'],
        ['row-4'],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
```

Update the existing test named `passes input maxConcurrency first and then adapter default to the runner job` so it reflects Window Mode's ordered-only rule:

```ts
  it('forces ordered Window Mode job concurrency regardless of legacy concurrency options', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-job-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.translated.xlsx');
      writeWorkbook(inputPath, [
        ['source', 'target'],
        ['Hello', ''],
      ]);
      const seenMaxConcurrency: Array<number | undefined> = [];

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          job: {},
        },
        {
          defaultMaxConcurrency: 3,
          taskExecutor: async () => ({ results: [] }),
          runnerFactory: () => ({
            run: async (job) => {
              seenMaxConcurrency.push(job.options?.maxConcurrency);
              return {
                jobId: job.id,
                summary: { total: 1, translated: 0, skipped: 0, reused: 0, failed: 0 },
                results: [],
              };
            },
          }),
        },
      );

      await translateSpreadsheetFileJob(
        {
          projectId: 7,
          inputPath,
          outputPath,
          options: { maxConcurrency: 5 },
          job: {},
        },
        {
          defaultMaxConcurrency: 3,
          taskExecutor: async () => ({ results: [] }),
          runnerFactory: () => ({
            run: async (job) => {
              seenMaxConcurrency.push(job.options?.maxConcurrency);
              return {
                jobId: job.id,
                summary: { total: 1, translated: 0, skipped: 0, reused: 0, failed: 0 },
                results: [],
              };
            },
          }),
        },
      );

      expect(seenMaxConcurrency).toEqual([1, 1]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 9: Add CLI batch size plumbing**

Modify `packages/localization/src/cli/translateFileCommand.ts`:

```ts
export interface TranslateFileCommandConfig {
  dbPath: string;
  projectId: number;
  inputPath: string;
  outputPath: string;
  targetScope?: 'blank-only' | 'overwrite-non-confirmed';
  batchSize?: number;
  checkpointPath?: string;
  eventsPath?: string;
  artifactsPath?: string;
  resume?: boolean;
  maxAttempts?: number;
  snapshotPath?: string;
  snapshotEveryUnits?: number;
  snapshotEverySeconds?: number;
  progressStdout?: boolean;
}
```

Then include `batchSize` in `input.options`:

```ts
options: {
  targetScope: config.targetScope,
  batchSize: config.batchSize,
},
```

Modify `scripts/translate-file.mjs`:

```js
const OPTION_NAMES = new Set([
  "db",
  "db-path",
  "project-id",
  "input",
  "output",
  "target-scope",
  "batch-size",
  "checkpoint",
  "events",
  "artifacts",
  "resume",
  "max-attempts",
  "snapshot",
  "snapshot-every-units",
  "snapshot-every-seconds",
  "progress-stdout",
]);
```

Add usage text:

```text
  --batch-size <n>               Window Mode batch size, integer from 1 to 5. Default: 5.
```

Add config field:

```js
batchSize: "",
```

Add assignment:

```js
if (name === "batch-size") {
  config.batchSize = optionValue;
  return;
}
```

Add validation:

```js
if (config.batchSize && !isIntegerInRange(config.batchSize, 1, 5)) {
  throw new Error("--batch-size must be an integer from 1 to 5.");
}
```

Add helper:

```js
function isIntegerInRange(value, min, max) {
  const numberValue = Number(value);
  return Number.isInteger(numberValue) && numberValue >= min && numberValue <= max;
}
```

Pass the value to the runner:

```js
batchSize: config.batchSize ? Number(config.batchSize) : undefined,
```

- [ ] **Step 10: Export planner types**

Modify `packages/localization/src/index.ts`:

```ts
export {
  DEFAULT_WINDOW_MODE_BATCH_SIZE,
  MAX_WINDOW_MODE_BATCH_SIZE,
  OneUnitTaskPlanner,
  WindowModeTaskPlanner,
  normalizeWindowModeBatchSize,
} from './job/TaskPlanner';
export type { TaskPlanner, WindowModeTaskPlannerOptions } from './job/TaskPlanner';
```

- [ ] **Step 11: Run planning and CLI tests**

Run:

```bash
npx vitest run packages/localization/src/job/TaskPlanner.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts
node scripts/translate-file.mjs --help
```

Expected: Vitest suites pass. Help output includes `--batch-size`.

- [ ] **Step 12: Commit planning work**

Run:

```bash
git add packages/localization/src/types.ts packages/localization/src/job/types.ts packages/localization/src/job/TaskPlanner.ts packages/localization/src/job/TaskPlanner.test.ts packages/localization/src/job/TranslationJobRunner.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.ts packages/localization/src/fileTranslationJobAdapter.test.ts packages/localization/src/cli/translateFileCommand.ts packages/localization/src/index.ts scripts/translate-file.mjs
git commit -m "feat: plan ordered mt window batches"
```

---

### Task 3: MTModule Batch Prompt Composition And Strict JSON Transport

**Files:**
- Modify: `packages/localization/src/artifacts.ts`
- Modify: `packages/localization/src/modules/MTModule.ts`
- Modify: `packages/localization/src/modules/MTModule.test.ts`
- Modify: `packages/localization/src/index.ts`

- [ ] **Step 1: Write failing MTModule batch tests**

Append to `packages/localization/src/modules/MTModule.test.ts`:

```ts
  it('composes a Window Mode batch prompt without calling provider transport', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Window Prompt', 'en', 'fr');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segmentA = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
      const segmentB = createTransientSegment({ id: 'row-3', source: 'Close' }, 1);
      const transport = createTransport();
      const module = createModule(db, transport);

      const artifact = await module.composeBatchPrompt({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'row-2',
            segment: segmentA,
            tm: createTMArtifact(segmentA),
            tb: createTBArtifact(segmentA),
            context: 'Toolbar label',
          },
          {
            responseId: 'row-3',
            documentId: 'doc.xlsx',
            unitId: 'row-3',
            segment: segmentB,
            tm: createTMArtifact(segmentB),
            tb: createTBArtifact(segmentB),
          },
        ],
        previousContext: [{ source: 'Open', target: 'Ouvrir' }],
        nextContext: [{ source: 'Preferences' }],
      });

      expect(artifact.batch).toEqual({
        mode: 'window',
        taskId: 'window-task-1',
        currentIds: ['row-2', 'row-3'],
        previousContextCount: 1,
        nextContextCount: 1,
      });
      expect(artifact.userPrompt).toContain('Current segments to translate');
      expect(artifact.userPrompt).toContain('id: row-2');
      expect(artifact.userPrompt).toContain('Previous 5 translated rows');
      expect(artifact.userPrompt).toContain('Open -> Ouvrir');
      expect(artifact.userPrompt).toContain('Next 5 source rows');
      expect(artifact.userPrompt).not.toContain('documentId');
      expect(artifact.userPrompt).not.toContain('doc.xlsx');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });

  it('translates Window Mode strict JSON responses into per-unit tokens', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Window Translate', 'en', 'fr');
      db.setSetting('openai_api_key', 'test-api-key');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segmentA = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
      const segmentB = createTransientSegment({ id: 'row-3', source: 'Close' }, 1);
      const transport = createTransport(
        JSON.stringify({
          translations: [
            { id: 'row-3', text: 'Fermer' },
            { id: 'row-2', text: 'Enregistrer le fichier' },
          ],
        }),
      );
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project, {
        model: 'test-model',
        reasoningEffort: 'medium',
      });

      const result = await module.translateBatch({
        taskId: 'window-task-1',
        project,
        current: [
          {
            responseId: 'row-2',
            documentId: 'doc.xlsx',
            unitId: 'row-2',
            segment: segmentA,
            tm: createTMArtifact(segmentA),
            tb: createTBArtifact(segmentA),
          },
          {
            responseId: 'row-3',
            documentId: 'doc.xlsx',
            unitId: 'row-3',
            segment: segmentB,
            tm: createTMArtifact(segmentB),
            tb: createTBArtifact(segmentB),
          },
        ],
        previousContext: [],
        nextContext: [],
        apiKey: config.apiKey,
        baseUrl: config.provider.baseUrl,
        model: config.model,
        reasoningEffort: config.reasoningEffort,
        provider: config.provider,
        srcLang: 'en',
        tgtLang: 'fr',
      });

      expect(result.results.map((unit) => unit.unitId)).toEqual(['row-2', 'row-3']);
      expect(serializeTokensToDisplayText(result.results[0].targetTokens)).toBe(
        'Enregistrer le fichier',
      );
      expect(serializeTokensToDisplayText(result.results[1].targetTokens)).toBe('Fermer');
      expect(transport.createResponse).toHaveBeenCalledTimes(1);
    } finally {
      db.close();
    }
  });

  it('rejects Window Mode responses with missing current ids', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('MT Window Missing', 'en', 'fr');
      db.setSetting('openai_api_key', 'test-api-key');
      const project = db.getProject(projectId);
      if (!project) throw new Error('Project not created');
      const segment = createTransientSegment({ id: 'row-2', source: 'Save file' }, 0);
      const transport = createTransport(JSON.stringify({ translations: [] }));
      const module = createModule(db, transport);
      const config = await module.resolveConfig(project);

      await expect(
        module.translateBatch({
          taskId: 'window-task-1',
          project,
          current: [
            {
              responseId: 'row-2',
              documentId: 'doc.xlsx',
              unitId: 'row-2',
              segment,
              tm: createTMArtifact(segment),
              tb: createTBArtifact(segment),
            },
          ],
          previousContext: [],
          nextContext: [],
          apiKey: config.apiKey,
          baseUrl: config.provider.baseUrl,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
          provider: config.provider,
          srcLang: 'en',
          tgtLang: 'fr',
        }),
      ).rejects.toThrow(/missing translation id: row-2/i);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 2: Run the failing MTModule tests**

Run:

```bash
npx vitest run packages/localization/src/modules/MTModule.test.ts
```

Expected: fail because `composeBatchPrompt` and `translateBatch` do not exist.

- [ ] **Step 3: Add Window Mode metadata to prompt artifacts**

Modify `packages/localization/src/artifacts.ts`:

```ts
export interface PromptBatchArtifact {
  mode: 'window';
  taskId: string;
  currentIds: string[];
  previousContextCount: number;
  nextContextCount: number;
}

export interface PromptArtifact {
  unitId: string;
  provider: PromptProviderArtifact;
  model: string | null;
  reasoningEffort: ReasoningEffort | null;
  projectPrompt: string;
  projectType: ProjectType;
  sourcePayload: string;
  tmPromptBlock: string;
  concordancePromptBlock: string;
  tbPromptBlock: string;
  referencePromptBlock: string;
  systemPrompt: string;
  userPrompt: string;
  promptChars: {
    system: number;
    user: number;
    total: number;
  };
  batch?: PromptBatchArtifact;
}
```

- [ ] **Step 4: Add MTModule batch types**

Modify `packages/localization/src/modules/MTModule.ts` imports:

```ts
import {
  DEFAULT_PROJECT_AI_MODEL,
  buildAITextPromptBundle,
  buildAIWindowModePromptBundle,
  normalizeProjectAIModel,
  normalizeProjectType,
  parseAIWindowModeResponse,
  type Project,
  type ProjectType,
  type WindowModeNextContextRow,
  type WindowModePreviousContextRow,
} from '@cat/core/project';
```

Add types below `TranslatePreparedPromptInput`:

```ts
export interface MTBatchCurrentUnitInput {
  responseId: string;
  documentId: string;
  unitId: string;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  context?: string;
}

export interface ComposeBatchPromptInput {
  taskId: string;
  project: Project;
  current: MTBatchCurrentUnitInput[];
  previousContext: WindowModePreviousContextRow[];
  nextContext: WindowModeNextContextRow[];
  mtOptions?: LocalizationMTOptions;
  providerOverride?: string;
  projectPromptOverride?: string;
}

export interface PreparedBatchPromptInput extends ComposeBatchPromptInput {
  baseUrl: string;
  model: string;
  reasoningEffort?: ReasoningEffort;
  srcLang: string;
  tgtLang: string;
  provider?: ResolvedAIProviderConfig['provider'];
  validationFeedback?: string;
}

export interface TranslatePreparedBatchPromptInput extends PreparedBatchPromptInput {
  apiKey: string;
}

export interface MTBatchUnitResult {
  documentId: string;
  unitId: string;
  responseId: string;
  targetTokens: Segment['targetTokens'];
}

export interface MTBatchTranslateResult {
  results: MTBatchUnitResult[];
  prompt: PromptArtifact;
}
```

- [ ] **Step 5: Add `composeBatchPrompt` and `composePreparedBatchPrompt`**

Add methods to `MTModule` after `composePrompt`:

```ts
  async composeBatchPrompt(input: ComposeBatchPromptInput): Promise<PromptArtifact> {
    const config = await this.resolvePromptConfig(
      input.project,
      input.mtOptions,
      input.providerOverride,
    );

    return this.composePreparedBatchPrompt({
      ...input,
      baseUrl: config.provider.baseUrl,
      model: config.model,
      reasoningEffort: config.reasoningEffort,
      provider: config.provider,
      srcLang: input.project.srcLang,
      tgtLang: input.project.tgtLang,
    });
  }

  composePreparedBatchPrompt(input: PreparedBatchPromptInput): PromptArtifact {
    const promptParams = this.buildBatchPromptParams(input);
    const promptBundle = buildAIWindowModePromptBundle({
      srcLang: input.srcLang,
      tgtLang: input.tgtLang,
      projectPrompt: promptParams.projectPrompt,
      currentSegments: promptParams.currentSegments,
      previousContext: input.previousContext,
      nextContext: input.nextContext,
      validationFeedback: input.validationFeedback,
    });

    return {
      unitId: input.taskId,
      provider: {
        id: input.provider?.id ?? null,
        name: input.provider?.name ?? null,
        baseUrl: input.baseUrl,
      },
      model: input.model,
      reasoningEffort: input.reasoningEffort ?? null,
      projectPrompt: promptParams.projectPrompt,
      projectType: promptParams.projectType,
      sourcePayload: promptParams.currentSegments
        .map((segment) => `${segment.id}: ${segment.sourcePayload}`)
        .join('\n'),
      tmPromptBlock: promptBundle.sections.currentSegmentsBlock,
      concordancePromptBlock: promptBundle.sections.currentSegmentsBlock,
      tbPromptBlock: promptBundle.sections.currentSegmentsBlock,
      referencePromptBlock: promptBundle.sections.referencePromptBlock,
      systemPrompt: promptBundle.systemPrompt,
      userPrompt: promptBundle.userPrompt,
      promptChars: {
        system: promptBundle.systemPrompt.length,
        user: promptBundle.userPrompt.length,
        total: promptBundle.systemPrompt.length + promptBundle.userPrompt.length,
      },
      batch: {
        mode: 'window',
        taskId: input.taskId,
        currentIds: input.current.map((unit) => unit.responseId),
        previousContextCount: input.previousContext.length,
        nextContextCount: input.nextContext.length,
      },
    };
  }
```

- [ ] **Step 6: Add batch translation with strict JSON parsing**

Add method to `MTModule` after `translate`:

```ts
  async translateBatch(input: TranslatePreparedBatchPromptInput): Promise<MTBatchTranslateResult> {
    const prompt = this.composePreparedBatchPrompt(input);
    const promptParams = this.buildBatchPromptParams(input);
    const maxAttempts = 3;
    let validationFeedback: string | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptPrompt =
        attempt === 1
          ? prompt
          : this.composePreparedBatchPrompt({
              ...input,
              validationFeedback,
            });
      const response = await this.aiTransport.createResponse({
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        reasoningEffort: input.reasoningEffort ?? 'medium',
        systemPrompt: attemptPrompt.systemPrompt,
        userPrompt: attemptPrompt.userPrompt,
      });
      const translations = parseAIWindowModeResponse(
        response.content,
        input.current.map((unit) => unit.responseId),
      );
      const results: MTBatchUnitResult[] = [];
      const validationErrors: string[] = [];

      for (const translation of translations) {
        const current = input.current.find((unit) => unit.responseId === translation.id);
        if (!current) {
          throw new Error(`Window Mode response included unknown translation id: ${translation.id}`);
        }

        this.assertChangedTranslation(
          translation.text.trim(),
          promptParams.sourceTextByResponseId.get(current.responseId) ?? '',
          prompt.sourcePayload,
          {
            projectType: promptParams.projectType,
            srcLang: input.srcLang,
            tgtLang: input.tgtLang,
          },
        );

        const targetTokens = parseEditorTextToTokens(
          translation.text.trim(),
          current.segment.sourceTokens,
        );

        if (promptParams.projectType !== 'custom') {
          const validationResult = this.tagValidator.validate(
            current.segment.sourceTokens,
            targetTokens,
          );
          const errors = validationResult.issues.filter((issue) => issue.severity === 'error');
          if (errors.length > 0) {
            validationErrors.push(
              `- ${current.responseId}: ${errors.map((error) => error.message).join('; ')}`,
            );
          }
        }

        results.push({
          documentId: current.documentId,
          unitId: current.unitId,
          responseId: current.responseId,
          targetTokens,
        });
      }

      if (validationErrors.length === 0) {
        return { results, prompt };
      }

      if (attempt === maxAttempts) {
        throw new Error(
          `Tag validation failed after ${maxAttempts} attempts: ${validationErrors.join('; ')}`,
        );
      }

      validationFeedback = [
        'Previous Window Mode batch response was invalid.',
        ...validationErrors,
        'Retry by preserving marker content and sequence exactly for each id.',
      ].join('\n');
    }

    throw new Error('Unexpected Window Mode translation retry failure');
  }
```

- [ ] **Step 7: Add batch prompt param builder**

Add private method before `buildPromptParams`:

```ts
  private buildBatchPromptParams(input: ComposeBatchPromptInput & { validationFeedback?: string }): {
    projectPrompt: string;
    projectType: ProjectType;
    currentSegments: Array<{
      id: string;
      sourcePayload: string;
      context?: string;
      tmReferences?: TMArtifact['selectedReferences']['tmReferences'];
      concordanceReferences?: TMArtifact['selectedReferences']['concordanceReferences'];
      tbReferences?: TBArtifact['selectedReferences'];
    }>;
    sourceTextByResponseId: Map<string, string>;
  } {
    const sourceTextByResponseId = new Map<string, string>();
    const currentSegments = input.current.map((unit) => {
      const sourceText = serializeTokensToDisplayText(unit.segment.sourceTokens);
      const sourcePayload = serializeTokensToEditorText(
        unit.segment.sourceTokens,
        unit.segment.sourceTokens,
      );
      sourceTextByResponseId.set(unit.responseId, sourceText);

      return {
        id: unit.responseId,
        sourcePayload,
        context:
          unit.context ??
          (unit.segment.meta?.context ? String(unit.segment.meta.context).trim() : undefined),
        tmReferences:
          unit.tm.selectedReferences.tmReferences.length > 0
            ? unit.tm.selectedReferences.tmReferences
            : undefined,
        concordanceReferences:
          unit.tm.selectedReferences.concordanceReferences.length > 0
            ? unit.tm.selectedReferences.concordanceReferences
            : undefined,
        tbReferences:
          unit.tb.selectedReferences.length > 0 ? unit.tb.selectedReferences : undefined,
      };
    });

    return {
      projectPrompt:
        input.projectPromptOverride ??
        input.mtOptions?.systemPrompt ??
        input.project.aiPrompt ??
        '',
      projectType: normalizeProjectType(input.project.projectType),
      currentSegments,
      sourceTextByResponseId,
    };
  }
```

- [ ] **Step 8: Export batch MT types**

Modify `packages/localization/src/index.ts`:

```ts
export type {
  ComposeBatchPromptInput,
  ComposePromptInput,
  MTBatchCurrentUnitInput,
  MTBatchTranslateResult,
  MTBatchUnitResult,
  MTModuleDependencies,
  MTTranslateResult,
  PreparedBatchPromptInput,
  PreparedPromptInput,
  PromptMTConfig,
  ResolvedMTConfig,
  TranslatePreparedBatchPromptInput,
  TranslatePreparedPromptInput,
} from './modules/MTModule';
```

- [ ] **Step 9: Run MTModule tests**

Run:

```bash
npx vitest run packages/localization/src/modules/MTModule.test.ts
```

Expected: pass.

- [ ] **Step 10: Commit MTModule batch work**

Run:

```bash
git add packages/localization/src/artifacts.ts packages/localization/src/modules/MTModule.ts packages/localization/src/modules/MTModule.test.ts packages/localization/src/index.ts
git commit -m "feat: add mt window mode transport"
```

---

### Task 4: LocalizationEngine Window Mode Executor

**Files:**
- Modify: `packages/localization/src/LocalizationEngine.ts`
- Modify: `packages/localization/src/LocalizationEngine.test.ts`

- [ ] **Step 1: Write failing engine tests for ordered Window Mode file jobs**

Append to `packages/localization/src/LocalizationEngine.test.ts` under `describe('LocalizationEngine.translateFile job mode', ...)`:

```ts
  it('uses Window Mode batches by default and sends later batches only after earlier targets exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-engine-window-job-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Window File Job', 'en', 'fr');
      seedApiKey(db);
      const inputPath = join(root, 'window.xlsx');
      const outputPath = join(root, 'window.translated.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['One', ''],
          ['Two', ''],
          ['Three', ''],
          ['Four', ''],
          ['Five', ''],
          ['Six', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const requestPrompts: string[] = [];
      const transport: MockTransport = {
        testConnection: vi.fn().mockResolvedValue({ ok: true, status: 200, endpoint: '/mock' }),
        createResponse: vi.fn(async (request: { userPrompt: string }) => {
          requestPrompts.push(request.userPrompt);
          if (request.userPrompt.includes('id: row-7')) {
            expect(request.userPrompt).toContain('Previous 5 translated rows');
            expect(request.userPrompt).toContain('One -> Un');
            expect(request.userPrompt).toContain('Five -> Cinq');
            return {
              content: JSON.stringify({ translations: [{ id: 'row-7', text: 'Six' }] }),
              status: 200,
              endpoint: '/mock',
            };
          }

          return {
            content: JSON.stringify({
              translations: [
                { id: 'row-2', text: 'Un' },
                { id: 'row-3', text: 'Deux' },
                { id: 'row-4', text: 'Trois' },
                { id: 'row-5', text: 'Quatre' },
                { id: 'row-6', text: 'Cinq' },
              ],
            }),
            status: 200,
            endpoint: '/mock',
          };
        }),
      } as unknown as MockTransport;
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        job: { maxAttempts: 1 },
      });

      expect(result.summary).toEqual({ total: 6, translated: 6, skipped: 0, failed: 0 });
      expect(transport.createResponse).toHaveBeenCalledTimes(2);
      expect(requestPrompts[0]).toContain('Return translations for ids: row-2, row-3, row-4, row-5, row-6');
      expect(requestPrompts[1]).toContain('Return translations for ids: row-7');
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][1]).toBe('Un');
      expect(rows[6][1]).toBe('Six');
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Write failing engine test for per-segment references**

Append under `describe('LocalizationEngine task executor', ...)`:

```ts
  it('attaches each current unit own TM and TB references in one Window Mode request', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Window References', 'en', 'fr');
      seedApiKey(db);
      const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');
      for (const [sourceText, targetText] of [
        ['Save file', 'Enregistrer le fichier'],
        ['Close window', 'Fermer la fenetre'],
      ] as const) {
        const entry = createTMEntry({ tmId, projectId, sourceText, targetText });
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
        id: 'term-save',
        tbId,
        srcLang: 'en',
        srcTerm: 'Save',
        tgtTerm: 'Enregistrer',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-close',
        tbId,
        srcLang: 'en',
        srcTerm: 'Close',
        tgtTerm: 'Fermer',
      });

      const transport = createTransport(
        JSON.stringify({
          translations: [
            { id: 'unit-1', text: 'Enregistrer le fichier' },
            { id: 'unit-2', text: 'Fermer la fenetre' },
          ],
        }),
      );
      const engine = new LocalizationEngine(db, {
        dbPath: ':memory:',
        aiTransport: transport,
      });

      await engine.executeTranslationTask(
        {
          taskId: 'window-task-1',
          units: [
            {
              documentId: 'doc-1',
              unitId: 'unit-1',
              source: 'Save file',
              sourceHash: 'hash-1',
            },
            {
              documentId: 'doc-1',
              unitId: 'unit-2',
              source: 'Close window',
              sourceHash: 'hash-2',
            },
          ],
        },
        {
          attempt: 1,
          job: {
            id: 'job-1',
            projectId,
            units: [],
          },
        },
      );

      const prompt = transport.createResponse.mock.calls[0]?.[0].userPrompt;
      expect(prompt).toMatch(/id: unit-1[\s\S]*Enregistrer le fichier[\s\S]*Save => Enregistrer/);
      expect(prompt).toMatch(/id: unit-2[\s\S]*Fermer la fenetre[\s\S]*Close => Fermer/);
    } finally {
      db.close();
    }
  });
```

- [ ] **Step 3: Run failing engine tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "Window"
```

Expected: fail because `executeTranslationTask` still rejects multi-unit tasks and file jobs do not call batch MT.

- [ ] **Step 4: Update engine imports**

Modify `packages/localization/src/LocalizationEngine.ts` imports:

```ts
import type {
  ArtifactRecord,
  JobUnit,
  TaskExecutionContext,
  TaskExecutionResult,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
  UnitResultStatus,
} from './job/types';
import type { MTBatchCurrentUnitInput, ResolvedMTConfig } from './modules/MTModule';
```

- [ ] **Step 5: Replace the multi-unit rejection with Window Mode execution**

In `executeTranslationTask`, remove:

```ts
if (task.units.length !== 1) {
  throw new Error('LocalizationEngine task executor supports one unit per task in this MVP');
}
```

Leave the code from `const project = this.projectRepo.getProject(...)` through the `const artifacts: ArtifactRecord[] | undefined = captureArtifacts ? [] : undefined;` declaration in place. Replace the per-unit translation loop that starts with `for (let index = 0; index < preparedUnits.length; index += 1)` with this structure:

```ts
    const skippedResults: UnitResult[] = [];
    const translatable: Array<{
      jobUnit: JobUnit;
      prepared: Extract<PreparedUnit, { kind: 'translatable' }>;
      references: ResolvedReferences;
    }> = [];

    for (let index = 0; index < preparedUnits.length; index += 1) {
      const jobUnit = task.units[index];
      const prepared = preparedUnits[index];

      if (!jobUnit || !prepared) {
        continue;
      }

      if (prepared.kind === 'skipped') {
        const result = toUnitResult(context.job.id, jobUnit, prepared.result);
        skippedResults.push(result);
        artifacts?.push(toArtifactRecord(context.job.id, task.taskId, jobUnit, result));
        continue;
      }

      const references =
        (project.projectType ?? 'translation') === 'translation'
          ? await this.resolveReferences(project.id, prepared.segment)
          : emptyReferencesForUnit(prepared.unit.id, prepared.segment.segmentId);
      translatable.push({ jobUnit, prepared, references });
    }

    results.push(...skippedResults);

    if (translatable.length === 0) {
      return { results, artifacts };
    }

    if (!mtConfig) {
      throw new Error('MT configuration was not resolved for translatable units.');
    }

    const translated = await this.translatePreparedWindowBatchWithArtifacts({
      task,
      context,
      project,
      mtConfig,
      mtOptions,
      translationOptions,
      translatable,
      skippedResults,
      captureArtifacts,
    });

    results.push(...translated.results);
    artifacts?.push(...translated.artifacts);

    return { results, artifacts };
```

- [ ] **Step 6: Add Window Mode batch helper methods**

Add private helper methods inside `LocalizationEngine`:

```ts
  private async translatePreparedWindowBatchWithArtifacts(params: {
    task: TranslationTask;
    context: TaskExecutionContext;
    project: ProjectRecord;
    mtConfig: ResolvedMTConfig;
    mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
    translationOptions: TranslateUnitsInput['options'];
    translatable: Array<{
      jobUnit: JobUnit;
      prepared: Extract<PreparedUnit, { kind: 'translatable' }>;
      references: ResolvedReferences;
    }>;
    skippedResults: UnitResult[];
    captureArtifacts: boolean;
  }): Promise<{ results: UnitResult[]; artifacts: ArtifactRecord[] }> {
    const completedResults = mergeCompletedResults(
      params.context.completedResults,
      params.skippedResults,
    );
    const current: MTBatchCurrentUnitInput[] = params.translatable.map(
      ({ jobUnit, prepared, references }) => ({
        responseId: jobUnit.unitId,
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        segment: prepared.segment,
        tm: references.tm,
        tb: references.tb,
        context: jobUnit.context,
      }),
    );
    const previousContext = this.buildPreviousTranslatedContext({
      jobUnits: params.context.job.units.length > 0 ? params.context.job.units : params.task.units,
      task: params.task,
      current,
      completedResults,
    });
    const nextContext = this.buildNextSourceContext({
      jobUnits: params.context.job.units.length > 0 ? params.context.job.units : params.task.units,
      current,
    });
    const batch = await this.mtModule.translateBatch({
      taskId: params.task.taskId,
      project: params.project,
      current,
      previousContext,
      nextContext,
      mtOptions: params.mtOptions,
      apiKey: params.mtConfig.apiKey,
      baseUrl: params.mtConfig.provider.baseUrl,
      model: params.mtConfig.model,
      reasoningEffort: params.mtConfig.reasoningEffort,
      provider: params.mtConfig.provider,
      srcLang: params.project.srcLang,
      tgtLang: params.project.tgtLang,
    });
    const referencesByUnit = new Map(
      params.translatable.map(({ jobUnit, references }) => [jobUnit.unitId, references] as const),
    );
    const jobUnitById = new Map(params.translatable.map(({ jobUnit }) => [jobUnit.unitId, jobUnit]));
    const resultRecords = batch.results.map((batchResult) => {
      const jobUnit = jobUnitById.get(batchResult.unitId);
      if (!jobUnit) {
        throw new Error(`Window Mode returned unknown unit result: ${batchResult.unitId}`);
      }
      const references = referencesByUnit.get(batchResult.unitId);
      return {
        jobId: params.context.job.id,
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        sourceHash: jobUnit.sourceHash,
        status: 'translated' as const,
        source: jobUnit.source,
        target: serializeTokensToDisplayText(batchResult.targetTokens),
        references: params.translationOptions?.includeReferences
          ? references?.engineReferences
          : undefined,
        metadata: jobUnit.metadata,
      };
    });
    const artifactRecords = params.captureArtifacts
      ? resultRecords.map((result) => {
          const jobUnit = jobUnitById.get(result.unitId);
          const references = referencesByUnit.get(result.unitId);
          if (!jobUnit) {
            throw new Error(`Window Mode artifact missing job unit: ${result.unitId}`);
          }
          return toArtifactRecord(params.context.job.id, params.task.taskId, jobUnit, result, {
            tm: references?.tm ?? emptyReferences().tm,
            tb: references?.tb ?? emptyReferences().tb,
            prompt: batch.prompt,
          });
        })
      : [];

    return {
      results: resultRecords,
      artifacts: artifactRecords,
    };
  }

  private buildPreviousTranslatedContext(params: {
    jobUnits: JobUnit[];
    task: TranslationTask;
    current: MTBatchCurrentUnitInput[];
    completedResults: ReadonlyMap<string, UnitResult>;
  }): Array<{ source: string; target: string }> {
    const firstCurrent = params.current[0];
    if (!firstCurrent) return [];

    const firstIndex = params.jobUnits.findIndex(
      (unit) => unit.documentId === firstCurrent.documentId && unit.unitId === firstCurrent.unitId,
    );
    if (firstIndex <= 0) return [];

    const rows: Array<{ source: string; target: string }> = [];
    for (let index = firstIndex - 1; index >= 0 && rows.length < 5; index -= 1) {
      const unit = params.jobUnits[index];
      const completed = params.completedResults.get(unitKey(unit));
      const target = completed?.target?.trim();
      if (!target) continue;
      rows.unshift({ source: unit.source, target });
    }

    return rows;
  }

  private buildNextSourceContext(params: {
    jobUnits: JobUnit[];
    current: MTBatchCurrentUnitInput[];
  }): Array<{ source: string }> {
    const lastCurrent = params.current[params.current.length - 1];
    if (!lastCurrent) return [];

    const lastIndex = params.jobUnits.findIndex(
      (unit) => unit.documentId === lastCurrent.documentId && unit.unitId === lastCurrent.unitId,
    );
    if (lastIndex < 0) return [];

    return params.jobUnits
      .slice(lastIndex + 1)
      .filter((unit) => unit.source.trim())
      .slice(0, 5)
      .map((unit) => ({ source: unit.source }));
  }
```

Add file-level helpers near existing helpers:

```ts
function mergeCompletedResults(
  completedResults: ReadonlyMap<string, UnitResult> | undefined,
  skippedResults: UnitResult[],
): ReadonlyMap<string, UnitResult> {
  const merged = new Map(completedResults ?? []);
  for (const result of skippedResults) {
    merged.set(unitKeyFromParts(result.documentId, result.unitId), result);
  }
  return merged;
}

function unitKey(unit: Pick<JobUnit, 'documentId' | 'unitId'>): string {
  return unitKeyFromParts(unit.documentId, unit.unitId);
}

function unitKeyFromParts(documentId: string, unitId: string): string {
  return `${documentId}\u0000${unitId}`;
}

function emptyReferencesForUnit(unitId: string, segmentId: string): ResolvedReferences {
  const references = emptyReferences();
  return {
    ...references,
    tm: {
      ...references.tm,
      unitId,
      segmentId,
    },
    tb: {
      ...references.tb,
      unitId,
      segmentId,
    },
  };
}
```

- [ ] **Step 7: Run engine Window Mode tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationEngine.test.ts -t "Window|job mode|task executor"
```

Expected: pass, including existing job mode and task executor tests.

- [ ] **Step 8: Commit engine Window Mode work**

Run:

```bash
git add packages/localization/src/LocalizationEngine.ts packages/localization/src/LocalizationEngine.test.ts
git commit -m "feat: execute mt window mode batches"
```

---

### Task 5: Window Mode Inspect Artifacts

**Files:**
- Modify: `packages/localization/src/LocalizationInspector.ts`
- Modify: `packages/localization/src/LocalizationInspector.test.ts`

- [ ] **Step 1: Write failing inspect test**

Append to `packages/localization/src/LocalizationInspector.test.ts`:

```ts
  it('inspects Window Mode batch prompts without provider requests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-inspector-window-'));
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Window Inspect', 'en', 'fr');
      mountReferenceData(db, projectId);
      const inputPath = writeInputWorkbook(root, [
        ['source', 'target'],
        ['Open', 'Ouvrir'],
        ['Hello world', ''],
        ['Preferences', ''],
      ]);
      const transport = createTransport();
      const inspector = new LocalizationInspector(db, {
        aiTransport: transport,
        aiRuntimeConfigProvider: runtimeConfigProvider(),
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath: join(root, 'inspect.xlsx'),
      });

      const json = JSON.parse(await readFile(result.jsonOutputPath, 'utf8'));
      expect(json.units[1].mt.batch).toMatchObject({
        mode: 'window',
        currentIds: expect.arrayContaining(['row-3']),
      });
      expect(json.units[1].mt.userPrompt).toContain('Previous 5 translated rows');
      expect(json.units[1].mt.userPrompt).toContain('Open -> Ouvrir');
      expect(json.units[1].mt.userPrompt).toContain('Next 5 source rows');
      expect(json.units[1].mt.userPrompt).toContain('Preferences');
      expect(json.units[1].mt.userPrompt).not.toContain('documentId');
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
```

- [ ] **Step 2: Run failing inspect test**

Run:

```bash
npx vitest run packages/localization/src/LocalizationInspector.test.ts -t "Window Mode"
```

Expected: fail because inspect still composes one prompt per row.

- [ ] **Step 3: Extend inspector MT module type**

Modify `packages/localization/src/LocalizationInspector.ts`:

```ts
export interface LocalizationInspectorOptions extends LocalizationEngineOptions {
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
  tmModule?: TMModule;
  tbModule?: TBModule;
  mtModule?: Pick<MTModule, 'composePrompt' | 'composeBatchPrompt'>;
}
```

Also change the class field:

```ts
private readonly mtModule: Pick<MTModule, 'composePrompt' | 'composeBatchPrompt'>;
```

- [ ] **Step 4: Compose batch prompts during inspect**

In `inspectFile`, replace the one-row loop:

```ts
const units: InspectUnitArtifact[] = [];
for (const [index, row] of limitedRows.entries()) {
  const segment = createTransientSegment(rowToUnit(row, project, parsed.inputPath), index, {
    projectId: project.id,
    sourceLanguage: project.srcLang,
    targetLanguage: project.tgtLang,
    fileName: basename(parsed.inputPath),
  });
  units.push(await this.inspectRow(project, row, segment, index, maxCellChars));
}
```

with:

```ts
const units = await this.inspectRowsWindowMode(
  project,
  limitedRows,
  parsed.inputPath,
  maxCellChars,
);
```

Add a private method:

```ts
  private async inspectRowsWindowMode(
    project: ProjectRecord,
    rows: FileParseRowArtifact[],
    inputPath: string,
    maxCellChars: number,
  ): Promise<InspectUnitArtifact[]> {
    const segments = rows.map((row, index) =>
      createTransientSegment(rowToUnit(row, project, inputPath), index, {
        projectId: project.id,
        sourceLanguage: project.srcLang,
        targetLanguage: project.tgtLang,
        fileName: basename(inputPath),
      }),
    );
    const inspected: InspectUnitArtifact[] = [];

    for (let start = 0; start < rows.length; start += 5) {
      const batchRows = rows.slice(start, start + 5);
      const batchSegments = segments.slice(start, start + 5);
      const unitArtifacts = await Promise.all(
        batchRows.map((row, index) =>
          this.inspectRowReferences(project, row, batchSegments[index], start + index),
        ),
      );
      const readyArtifacts = unitArtifacts.filter(
        (artifact): artifact is InspectUnitArtifact & { status: 'ready' } =>
          artifact.status === 'ready',
      );

      if (readyArtifacts.length === 0) {
        inspected.push(...unitArtifacts);
        continue;
      }

      try {
        const mt = await this.mtModule.composeBatchPrompt({
          taskId: `inspect-window-${Math.floor(start / 5) + 1}`,
          project,
          current: readyArtifacts.map((artifact) => ({
            responseId: artifact.unit.unitId,
            documentId: basename(inputPath),
            unitId: artifact.unit.unitId,
            segment: segments[rows.findIndex((row) => row.unitId === artifact.unit.unitId)],
            tm: artifact.tm,
            tb: artifact.tb,
            context: artifact.unit.context,
          })),
          previousContext: buildInspectPreviousContext(rows, start),
          nextContext: buildInspectNextContext(rows, start + batchRows.length),
          mtOptions: this.options.mt,
          providerOverride: this.options.mt?.providerId,
        });

        for (const artifact of unitArtifacts) {
          if (artifact.status !== 'ready') {
            inspected.push(artifact);
            continue;
          }

          inspected.push({
            ...artifact,
            mt,
            xlsx: buildXlsxFields(mt, inspected.length, maxCellChars),
          });
        }
      } catch (error) {
        for (const artifact of unitArtifacts) {
          inspected.push(
            buildErrorUnit({
              row: artifact.unit,
              segment: segments[rows.findIndex((row) => row.unitId === artifact.unit.unitId)],
              project,
              tm: artifact.tm,
              tb: artifact.tb,
              error: `mt: ${errorMessage(error)}`,
            }),
          );
        }
      }
    }

    return inspected;
  }
```

- [ ] **Step 5: Split reference inspection from prompt composition**

Rename the old `inspectRow` body to `inspectRowReferences` and make it stop before calling `composePrompt`:

```ts
  private async inspectRowReferences(
    project: ProjectRecord,
    row: FileParseRowArtifact,
    segment: Segment,
    unitIndex: number,
  ): Promise<InspectUnitArtifact> {
    const [tmResult, tbResult] = await Promise.allSettled([
      this.tmModule.inspect(project.id, segment),
      this.tbModule.inspect(project.id, segment),
    ]);
    const tm =
      tmResult.status === 'fulfilled'
        ? tmResult.value
        : emptyTMArtifact(row.unitId, segment.segmentId);
    const tb =
      tbResult.status === 'fulfilled'
        ? tbResult.value
        : emptyTBArtifact(row.unitId, segment.segmentId);
    const referenceErrors = [stageError('tm', tmResult), stageError('tb', tbResult)].filter(
      (error): error is string => Boolean(error),
    );

    if (referenceErrors.length > 0) {
      return buildErrorUnit({
        row,
        segment,
        project,
        tm,
        tb,
        error: referenceErrors.join('; '),
      });
    }

    return {
      unit: row,
      transientSegment: segmentMetadata(segment),
      tm,
      tb,
      mt: emptyPromptArtifact(row.unitId, project),
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

Add helpers near `rowToUnit`:

```ts
function buildInspectPreviousContext(
  rows: FileParseRowArtifact[],
  batchStart: number,
): Array<{ source: string; target: string }> {
  const context: Array<{ source: string; target: string }> = [];
  for (let index = batchStart - 1; index >= 0 && context.length < 5; index -= 1) {
    const row = rows[index];
    if (!row.target.trim()) continue;
    context.unshift({ source: row.source, target: row.target });
  }
  return context;
}

function buildInspectNextContext(
  rows: FileParseRowArtifact[],
  batchEnd: number,
): Array<{ source: string }> {
  return rows
    .slice(batchEnd)
    .filter((row) => row.source.trim())
    .slice(0, 5)
    .map((row) => ({ source: row.source }));
}
```

- [ ] **Step 6: Run inspect tests**

Run:

```bash
npx vitest run packages/localization/src/LocalizationInspector.test.ts
```

Expected: pass.

- [ ] **Step 7: Commit inspect work**

Run:

```bash
git add packages/localization/src/LocalizationInspector.ts packages/localization/src/LocalizationInspector.test.ts
git commit -m "feat: inspect mt window mode prompts"
```

---

### Task 6: Documentation And Targeted Validation

**Files:**
- Modify: `DOCS/agent-first/MT_MODULE.md`
- Modify: `DOCS/agent-first/CLI.md`
- Modify: `DOCS/00_START_HERE.md`

- [ ] **Step 1: Update MT module docs**

Modify `DOCS/agent-first/MT_MODULE.md`:

```md
## Current Request Model

`translate:file` job mode now uses Window Mode by default.

Window Mode:

```text
One ordered file
  -> WindowModeTaskPlanner batches 1..5 current units
  -> one provider request at a time
  -> strict JSON response
  -> per-unit UnitResult records
  -> per-unit checkpoints/events/snapshots/final output
```

Same-file provider requests are not concurrent. Later batches wait until earlier
batches finish so previous translated context is real target output from
completed units.
```

In the same file, rename `## Future Batch Request Model` to `## Window Mode Request Model` and replace its opening sentence with:

```md
Window Mode sends 1 to 5 current segments in one provider request, plus previous translated context and next source context. This does not change the file API or checkpoint format.
```

Delete this sentence from that section because it becomes obsolete:

```md
The remaining work is to replace the one-unit task executor path with a batch-capable planner and executor.
```

- [ ] **Step 2: Update CLI docs**

Modify `DOCS/agent-first/CLI.md` under `Translate File` useful options:

```md
--batch-size <n>
```

Add:

```md
Window Mode is the default request mode for `translate:file`. It sends ordered
batches of up to 5 current rows by default. Use `--batch-size <n>` with an
integer from 1 to 5 to tune batch size during prompt evaluation. Same-file
provider requests remain ordered even if older concurrency options are present.
```

- [ ] **Step 3: Ensure start doc points at the Window Mode spec**

Modify `DOCS/00_START_HERE.md` source-of-truth list:

```md
- MT Window Mode design: `DOCS/superpowers/specs/2026-05-20-mt-window-mode-design.md`
```

- [ ] **Step 4: Run targeted tests**

Run:

```bash
npx vitest run packages/core/src/project/windowModePrompt.test.ts packages/core/src/project/index.test.ts
npx vitest run packages/localization/src/job/TaskPlanner.test.ts packages/localization/src/job/TranslationJobRunner.test.ts packages/localization/src/fileTranslationJobAdapter.test.ts
npx vitest run packages/localization/src/modules/MTModule.test.ts
npx vitest run packages/localization/src/LocalizationEngine.test.ts
npx vitest run packages/localization/src/LocalizationInspector.test.ts
```

Expected: all targeted suites pass.

- [ ] **Step 5: Run package type/build validation**

Run:

```bash
npm run build --workspace=packages/core
npm run build --workspace=packages/localization
```

Expected: both package builds pass.

- [ ] **Step 6: Run broader repo gate**

Run:

```bash
npm run gate:check
```

Expected: gate passes, or only known historical warnings remain. New Window Mode files must not introduce lint errors.

- [ ] **Step 7: Commit docs and validation updates**

Run:

```bash
git add DOCS/agent-first/MT_MODULE.md DOCS/agent-first/CLI.md DOCS/00_START_HERE.md
git commit -m "docs: document mt window mode default"
```

---

## Self-Review Checklist

- [x] Spec coverage: Task 1 covers pure prompt/parser; Task 2 covers batch size, ordered planning, and CLI option; Task 3 covers MT transport and strict JSON; Task 4 covers engine execution, context windows, per-unit references, and ordered file requests; Task 5 covers inspect artifacts; Task 6 covers docs and validation.
- [x] Same-file request concurrency is fixed at `1` in `translateSpreadsheetFileJob`, and later batches receive completed result snapshots from `TranslationJobRunner`.
- [x] Current segment references stay per segment. No task merges TM, concordance, or TB into a shared batch pool.
- [x] Context rows omit internal ids in the core prompt builder and inspect assertions.
- [x] Normal translation artifacts remain opt-in through the existing artifact store.
- [x] `translateUnits` remains on the existing single-unit path for this increment.
- [x] Batch size defaults to `5` and accepts only integers from `1` to `5`.
- [x] No implementation step changes the legacy desktop CAT editor workflow.
