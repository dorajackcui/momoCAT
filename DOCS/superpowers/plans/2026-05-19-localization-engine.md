# LocalizationEngine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `LocalizationEngine` facade that translates external units and files through a project's TM + TB + MT resources without creating project `files` or `segments` records.

**Architecture:** Add a new `apps/desktop/src/main/localization` engine boundary. The first slice reuses existing project repositories, `TMService`, `TBService`, prompt bundle creation, and provider transport behind a new no-write facade. File translation is a thin adapter over `translateUnits`: parse xlsx/csv in memory, call the engine, and write an explicit output file.

**Tech Stack:** TypeScript, Vitest, `better-sqlite3`, existing `@cat/core` token/tag utilities, existing desktop service adapters, `xlsx`, Node CLI scripts.

---

## File Structure

- Create `apps/desktop/src/main/localization/types.ts`
  - Public input/result types for `LocalizationEngine`.
- Create `apps/desktop/src/main/localization/RequestScheduler.ts`
  - Bounded concurrency runner that preserves result order and continues after per-item failures.
- Create `apps/desktop/src/main/localization/RequestScheduler.test.ts`
  - Concurrency and failure-continuation tests.
- Create `apps/desktop/src/main/localization/transientSegment.ts`
  - Converts external units into in-memory `Segment` shapes for TM/TB/prompt reuse.
- Create `apps/desktop/src/main/localization/transientSegment.test.ts`
  - Verifies tokenization, hashes, metadata, and no DB dependency.
- Create `apps/desktop/src/main/localization/LocalizationEngine.ts`
  - Facade with `inspectProject`, `translateUnits`, and `translateFile`.
- Create `apps/desktop/src/main/localization/LocalizationEngine.test.ts`
  - Engine integration tests with in-memory DB and mocked transport.
- Create `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts`
  - Parses external xlsx/csv into units and writes translated output files.
- Create `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts`
  - Header detection, output writing, and row-id tests.
- Create `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`
  - Dynamic CLI smoke runner used by `scripts/translate-file.mjs`.
- Create `apps/desktop/src/main/localization/index.ts`
  - Barrel export for the facade and public types.
- Create `scripts/translate-file.mjs`
  - CLI wrapper that runs the dynamic Vitest smoke with long timeout, matching the current `trace:ai-file` pattern.
- Create `scripts/translate-file.test.mjs`
  - CLI help/argument validation tests.
- Modify `package.json`
  - Add `translate:file`.
- Modify `DOCS/00_START_HERE.md`
  - Document no-write external file translation.

## Task 1: Request Scheduler Boundary

**Files:**

- Create: `apps/desktop/src/main/localization/RequestScheduler.ts`
- Test: `apps/desktop/src/main/localization/RequestScheduler.test.ts`

- [ ] **Step 1: Write the failing scheduler tests**

Create `apps/desktop/src/main/localization/RequestScheduler.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runBounded } from "./RequestScheduler";

describe("runBounded", () => {
  it("respects maxConcurrency and preserves input order", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];

    const task = runBounded(
      [1, 2, 3, 4],
      async (value) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((resolve) => releases.push(resolve));
        active -= 1;
        return value * 10;
      },
      { maxConcurrency: 2 },
    );

    await Promise.resolve();
    expect(maxActive).toBe(2);
    releases.splice(0).forEach((release) => release());

    const result = await task;
    expect(result).toEqual([
      { status: "fulfilled", value: 10 },
      { status: "fulfilled", value: 20 },
      { status: "fulfilled", value: 30 },
      { status: "fulfilled", value: 40 },
    ]);
  });

  it("records item failures and continues remaining work", async () => {
    const result = await runBounded(
      ["a", "bad", "c"],
      async (value) => {
        if (value === "bad") {
          throw new Error("provider failed");
        }
        return value.toUpperCase();
      },
      { maxConcurrency: 2 },
    );

    expect(result[0]).toEqual({ status: "fulfilled", value: "A" });
    expect(result[1]).toMatchObject({
      status: "rejected",
      reason: expect.any(Error),
    });
    expect(result[2]).toEqual({ status: "fulfilled", value: "C" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/RequestScheduler.test.ts
```

Expected: FAIL because `RequestScheduler.ts` does not exist.

- [ ] **Step 3: Implement the scheduler**

Create `apps/desktop/src/main/localization/RequestScheduler.ts`:

```ts
export type ScheduledResult<T> =
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

export interface RunBoundedOptions {
  maxConcurrency?: number;
}

export async function runBounded<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  options: RunBoundedOptions = {},
): Promise<Array<ScheduledResult<R>>> {
  if (items.length === 0) return [];

  const maxConcurrency = normalizeMaxConcurrency(
    options.maxConcurrency,
    items.length,
  );
  const results: Array<ScheduledResult<R> | undefined> = new Array(
    items.length,
  );
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;

      try {
        results[index] = {
          status: "fulfilled",
          value: await worker(items[index], index),
        };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };

  await Promise.all(Array.from({ length: maxConcurrency }, () => runWorker()));
  return results.map(
    (result) =>
      result ?? {
        status: "rejected",
        reason: new Error("Missing scheduler result"),
      },
  );
}

function normalizeMaxConcurrency(
  value: number | undefined,
  itemCount: number,
): number {
  if (value === undefined || !Number.isFinite(value))
    return Math.min(4, itemCount);
  return Math.max(1, Math.min(Math.floor(value), itemCount));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/RequestScheduler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/main/localization/RequestScheduler.ts apps/desktop/src/main/localization/RequestScheduler.test.ts
git commit -m "feat: add localization request scheduler"
```

## Task 2: Public Types and Transient Segments

**Files:**

- Create: `apps/desktop/src/main/localization/types.ts`
- Create: `apps/desktop/src/main/localization/transientSegment.ts`
- Test: `apps/desktop/src/main/localization/transientSegment.test.ts`

- [ ] **Step 1: Write the failing transient segment tests**

Create `apps/desktop/src/main/localization/transientSegment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeTokensToDisplayText } from "@cat/core/text";
import { createTransientSegment } from "./transientSegment";

describe("createTransientSegment", () => {
  it("creates a segment shape from an external unit without a persisted file id", () => {
    const segment = createTransientSegment(
      {
        id: "row-2",
        source: '你好 <bpt id="1"/>world<ept id="1"/>',
        target: "",
        context: "speaker: Nikki",
        metadata: { rowNumber: 2 },
      },
      7,
    );

    expect(segment.segmentId).toBe("row-2");
    expect(segment.fileId).toBe(0);
    expect(segment.orderIndex).toBe(7);
    expect(serializeTokensToDisplayText(segment.sourceTokens)).toContain(
      "你好",
    );
    expect(segment.targetTokens).toEqual([]);
    expect(segment.status).toBe("new");
    expect(segment.matchKey.length).toBeGreaterThan(0);
    expect(segment.srcHash.length).toBeGreaterThan(0);
    expect(segment.meta).toMatchObject({
      context: "speaker: Nikki",
      externalUnitId: "row-2",
      rowNumber: 2,
    });
  });

  it("marks units with existing target text as translated", () => {
    const segment = createTransientSegment(
      {
        id: "row-3",
        source: "Hello",
        target: "Bonjour",
      },
      8,
    );

    expect(segment.status).toBe("translated");
    expect(serializeTokensToDisplayText(segment.targetTokens)).toBe("Bonjour");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/transientSegment.test.ts
```

Expected: FAIL because `transientSegment.ts` and `types.ts` do not exist.

- [ ] **Step 3: Add public types**

Create `apps/desktop/src/main/localization/types.ts`:

```ts
export interface LocalizationUnit {
  id: string;
  source: string;
  target?: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface LocalizationRunOptions {
  targetScope?: "blank-only" | "overwrite-non-confirmed";
  mode?: "standard" | "dialogue";
  includeReferences?: boolean;
  maxConcurrency?: number;
  providerOverride?: string;
}

export interface TranslateUnitsInput {
  projectId: number;
  units: LocalizationUnit[];
  options?: LocalizationRunOptions;
}

export interface EngineTMReference {
  kind: "tm" | "concordance";
  rank: number;
  similarity?: number;
  tmName: string;
  sourceText: string;
  targetText: string;
  matchedSourceText?: string;
}

export interface EngineTBReference {
  tbName: string;
  srcTerm: string;
  tgtTerm: string;
  note?: string | null;
}

export interface LocalizationUnitResult {
  id: string;
  source: string;
  target?: string;
  status: "translated" | "skipped" | "failed";
  error?: string;
  references?: {
    tm: EngineTMReference[];
    tb: EngineTBReference[];
  };
  metadata?: Record<string, unknown>;
}

export interface TranslateUnitsResult {
  summary: {
    total: number;
    translated: number;
    skipped: number;
    failed: number;
  };
  results: LocalizationUnitResult[];
}

export interface TranslateFileInput {
  projectId: number;
  inputPath: string;
  outputPath: string;
  format?: "xlsx" | "csv";
  columns?: {
    sourceHeader?: string;
    targetHeader?: string;
    contextHeader?: string;
    sourceCol?: number;
    targetCol?: number;
    contextCol?: number;
    hasHeader?: boolean;
  };
  options?: LocalizationRunOptions;
}

export interface TranslateFileResult extends TranslateUnitsResult {
  inputPath: string;
  outputPath: string;
}

export interface LocalizationEngineProfile {
  projectId: number;
  projectName: string;
  srcLang: string;
  tgtLang: string;
  promptChars: number;
  model: string | null;
  apiKeySet: boolean;
  mountedTMCount: number;
  mountedTBCount: number;
  ready: boolean;
  errors: string[];
}
```

- [ ] **Step 4: Implement transient segment creation**

Create `apps/desktop/src/main/localization/transientSegment.ts`:

```ts
import type { Segment } from "@cat/core/models";
import { parseDisplayTextToTokens, computeTagsSignature } from "@cat/core/tag";
import { computeMatchKey, computeSrcHash } from "@cat/core/text";
import type { LocalizationUnit } from "./types";

export function createTransientSegment(
  unit: LocalizationUnit,
  orderIndex: number,
): Segment {
  const sourceTokens = parseDisplayTextToTokens(unit.source);
  const targetTokens = unit.target ? parseDisplayTextToTokens(unit.target) : [];
  const tagsSignature = computeTagsSignature(sourceTokens);
  const matchKey = computeMatchKey(sourceTokens);

  return {
    segmentId: unit.id,
    fileId: 0,
    orderIndex,
    sourceTokens,
    targetTokens,
    status: targetTokens.length > 0 ? "translated" : "new",
    tagsSignature,
    matchKey,
    srcHash: computeSrcHash(matchKey, tagsSignature),
    meta: {
      ...(unit.metadata ?? {}),
      externalUnitId: unit.id,
      context: unit.context,
      updatedAt: new Date().toISOString(),
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/transientSegment.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/localization/types.ts apps/desktop/src/main/localization/transientSegment.ts apps/desktop/src/main/localization/transientSegment.test.ts
git commit -m "feat: add localization unit types"
```

## Task 3: `LocalizationEngine.translateUnits`

**Files:**

- Create: `apps/desktop/src/main/localization/LocalizationEngine.ts`
- Create: `apps/desktop/src/main/localization/index.ts`
- Test: `apps/desktop/src/main/localization/LocalizationEngine.test.ts`

- [ ] **Step 1: Write failing engine tests**

Create `apps/desktop/src/main/localization/LocalizationEngine.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CATDatabase } from "../../../../../packages/db/src";
import type { AITransport } from "../services/ports";
import { LocalizationEngine } from "./LocalizationEngine";

function createTransport(content = "Bonjour") {
  return {
    testConnection: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content,
      status: 200,
      endpoint: "/mock",
      requestId: "req-localization",
    }),
  } as unknown as AITransport;
}

describe("LocalizationEngine.translateUnits", () => {
  it("translates external units through project MT without creating files or segments", async () => {
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("Engine Project", "zh-CN", "fr-FR");
      db.setSetting("openai_api_key", "test-key");
      const beforeFiles = db.listFiles(projectId);

      const engine = new LocalizationEngine(db, {
        dbPath: ":memory:",
        aiTransport: createTransport("Bonjour le monde"),
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: "row-2", source: "你好世界" }],
      });

      expect(result.summary).toEqual({
        total: 1,
        translated: 1,
        skipped: 0,
        failed: 0,
      });
      expect(result.results[0]).toMatchObject({
        id: "row-2",
        source: "你好世界",
        target: "Bonjour le monde",
        status: "translated",
      });
      expect(db.listFiles(projectId)).toEqual(beforeFiles);
    } finally {
      db.close();
    }
  });

  it("resolves TM and TB references without persisting transient units", async () => {
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("Reference Project", "zh-CN", "fr-FR");
      db.setSetting("openai_api_key", "test-key");

      const tmId = db.createTM("Client TM", "zh-CN", "fr-FR", "main");
      db.mountTMToProject(projectId, tmId, 10, "read");
      db.upsertTMEntry({
        id: "tm-entry-1",
        tmId,
        projectId,
        srcLang: "zh-CN",
        tgtLang: "fr-FR",
        srcHash: "manual-hash",
        matchKey: "大喵",
        tagsSignature: "",
        sourceTokens: [{ type: "text", content: "大喵" }],
        targetTokens: [{ type: "text", content: "Momo" }],
        usageCount: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });

      const tbId = db.createTermBase("Client TB", "zh-CN", "fr-FR");
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "tb-entry-1",
        tbId,
        srcLang: "zh-CN",
        srcTerm: "大喵",
        tgtTerm: "Momo",
      });

      const engine = new LocalizationEngine(db, {
        dbPath: ":memory:",
        aiTransport: createTransport("Momo"),
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: "row-3", source: "大喵" }],
        options: { includeReferences: true },
      });

      expect(result.results[0].references?.tm.length).toBeGreaterThan(0);
      expect(result.results[0].references?.tb).toEqual([
        expect.objectContaining({ srcTerm: "大喵", tgtTerm: "Momo" }),
      ]);
      expect(db.listFiles(projectId)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it("skips non-empty targets in blank-only mode", async () => {
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("Skip Project", "zh-CN", "fr-FR");
      db.setSetting("openai_api_key", "test-key");
      const transport = createTransport("Should not be called");

      const engine = new LocalizationEngine(db, {
        dbPath: ":memory:",
        aiTransport: transport,
      });

      const result = await engine.translateUnits({
        projectId,
        units: [{ id: "row-4", source: "你好", target: "Salut" }],
        options: { targetScope: "blank-only" },
      });

      expect(result.summary).toEqual({
        total: 1,
        translated: 0,
        skipped: 1,
        failed: 0,
      });
      expect(result.results[0]).toMatchObject({
        status: "skipped",
        target: "Salut",
      });
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts
```

Expected: FAIL because `LocalizationEngine.ts` does not exist.

- [ ] **Step 3: Implement `LocalizationEngine`**

Create `apps/desktop/src/main/localization/LocalizationEngine.ts` with this structure:

```ts
import { TagValidator } from "@cat/core/qa";
import { serializeTokensToDisplayText } from "@cat/core/text";
import { serializeTokensToEditorText } from "@cat/core/tag";
import type { CATDatabase } from "../../../../../packages/db/src";
import { SqliteProjectRepository } from "../services/adapters/SqliteProjectRepository";
import { SqliteSettingsRepository } from "../services/adapters/SqliteSettingsRepository";
import { SqliteTBRepository } from "../services/adapters/SqliteTBRepository";
import { SqliteTMRepository } from "../services/adapters/SqliteTMRepository";
import { AIProviderTransport } from "../services/providers/AIProviderTransport";
import { TMService } from "../services/TMService";
import { TBService } from "../services/TBService";
import type { AITransport, AIRuntimeConfigProvider } from "../services/ports";
import { DefaultAIRuntimeConfigProvider } from "../services/modules/ai/AIRuntimeConfigService";
import { AIProviderCatalogService } from "../services/modules/ai/AIProviderCatalogService";
import { AITextTranslator } from "../services/modules/ai/AITextTranslator";
import { resolveBatchTargetScope } from "../services/modules/ai/translationTargetScope";
import { runBounded } from "./RequestScheduler";
import { createTransientSegment } from "./transientSegment";
import type {
  EngineTBReference,
  EngineTMReference,
  LocalizationEngineProfile,
  LocalizationUnit,
  LocalizationUnitResult,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitsInput,
  TranslateUnitsResult,
} from "./types";
import { translateSpreadsheetFile } from "./spreadsheetFileAdapter";

export interface LocalizationEngineOptions {
  dbPath: string;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
}

export class LocalizationEngine {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly settingsRepo: SqliteSettingsRepository;
  private readonly tmService: TMService;
  private readonly tbService: TBService;
  private readonly providerCatalogService: AIProviderCatalogService;
  private readonly aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  private readonly textTranslator: AITextTranslator;

  constructor(
    private readonly db: CATDatabase,
    private readonly options: LocalizationEngineOptions,
  ) {
    this.projectRepo = new SqliteProjectRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    this.settingsRepo = new SqliteSettingsRepository(db);
    this.tmService = new TMService(this.projectRepo, tmRepo);
    this.tbService = new TBService(this.projectRepo, tbRepo);

    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    this.providerCatalogService = new AIProviderCatalogService(
      this.settingsRepo,
      aiTransport,
    );
    this.aiRuntimeConfigProvider =
      options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider();
    this.textTranslator = new AITextTranslator(aiTransport, new TagValidator());
  }

  public async inspectProject(
    projectId: number,
  ): Promise<LocalizationEngineProfile> {
    const project = this.projectRepo.getProject(projectId);
    if (!project) {
      return {
        projectId,
        projectName: "",
        srcLang: "",
        tgtLang: "",
        promptChars: 0,
        model: null,
        apiKeySet: false,
        mountedTMCount: 0,
        mountedTBCount: 0,
        ready: false,
        errors: [`Project not found: ${projectId}`],
      };
    }

    const errors: string[] = [];
    let model: string | null = null;
    let apiKeySet = false;
    try {
      const providerConfig = this.providerCatalogService.resolveProviderConfig(
        project.aiModel,
      );
      model = providerConfig.provider.model;
      apiKeySet = Boolean(providerConfig.apiKey);
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }

    const mountedTMs = this.tmService.getProjectMountedTMs(projectId);
    const mountedTBs = this.tbService.getProjectMountedTBs(projectId);
    return {
      projectId,
      projectName: project.name,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      promptChars: project.aiPrompt?.length ?? 0,
      model,
      apiKeySet,
      mountedTMCount: mountedTMs.length,
      mountedTBCount: mountedTBs.length,
      ready: errors.length === 0,
      errors,
    };
  }

  public async translateUnits(
    input: TranslateUnitsInput,
  ): Promise<TranslateUnitsResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);

    const { provider, apiKey } =
      this.providerCatalogService.resolveProviderConfig(
        input.options?.providerOverride ?? project.aiModel,
      );
    const runtimeConfig = await this.aiRuntimeConfigProvider.getModelConfig(
      provider.model,
    );
    const targetScope = resolveBatchTargetScope(input.options?.targetScope);

    const scheduled = await runBounded(
      input.units,
      async (unit, index): Promise<LocalizationUnitResult> => {
        if (!unit.source.trim()) {
          return buildSkippedResult(unit);
        }
        if (targetScope === "blank-only" && unit.target?.trim()) {
          return buildSkippedResult(unit);
        }

        const segment = createTransientSegment(unit, index);
        const references = await this.resolveReferences(
          input.projectId,
          segment,
        );
        const targetTokens = await this.textTranslator.translateSegment({
          segmentId: unit.id,
          apiKey,
          baseUrl: provider.baseUrl,
          model: provider.model,
          projectPrompt: project.aiPrompt ?? "",
          projectType: project.projectType ?? "translation",
          reasoningEffort: runtimeConfig.reasoningEffort,
          srcLang: project.srcLang,
          tgtLang: project.tgtLang,
          sourceTokens: segment.sourceTokens,
          sourceText: serializeTokensToDisplayText(segment.sourceTokens),
          sourceTagPreservedText: serializeTokensToEditorText(
            segment.sourceTokens,
            segment.sourceTokens,
          ),
          context: unit.context,
          tmReference: references.prompt.tmReferences[0],
          tmReferences: references.prompt.tmReferences,
          concordanceReferences: references.prompt.concordanceReferences,
          tbReferences: references.prompt.tbReferences,
        });

        return {
          id: unit.id,
          source: unit.source,
          target: serializeTokensToDisplayText(targetTokens),
          status: "translated",
          references: input.options?.includeReferences
            ? references.engine
            : undefined,
          metadata: unit.metadata,
        };
      },
      { maxConcurrency: input.options?.maxConcurrency },
    );

    const results = scheduled.map((result, index): LocalizationUnitResult => {
      if (result.status === "fulfilled") return result.value;
      return {
        id: input.units[index].id,
        source: input.units[index].source,
        target: input.units[index].target,
        status: "failed",
        error:
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason),
        metadata: input.units[index].metadata,
      };
    });

    return {
      summary: {
        total: results.length,
        translated: results.filter((result) => result.status === "translated")
          .length,
        skipped: results.filter((result) => result.status === "skipped").length,
        failed: results.filter((result) => result.status === "failed").length,
      },
      results,
    };
  }

  public async translateFile(
    input: TranslateFileInput,
  ): Promise<TranslateFileResult> {
    return translateSpreadsheetFile(input, (units) =>
      this.translateUnits({
        projectId: input.projectId,
        units,
        options: input.options,
      }),
    );
  }

  private async resolveReferences(
    projectId: number,
    segment: ReturnType<typeof createTransientSegment>,
  ) {
    const tmMatches = await this.tmService.findMatches(projectId, segment);
    const tbMatches = await this.tbService.findMatches(projectId, segment);

    const tmReferences = tmMatches
      .filter((match) => match.kind === "tm")
      .slice(0, 3);
    const concordanceReferences = tmMatches
      .filter((match) => match.kind === "concordance")
      .slice(0, 3);

    return {
      prompt: {
        tmReferences: tmReferences.map((match) => ({
          similarity: match.similarity,
          tmName: match.tmName,
          sourceText: serializeTokensToDisplayText(match.sourceTokens),
          targetText: serializeTokensToDisplayText(match.targetTokens),
        })),
        concordanceReferences: concordanceReferences.map((match) => ({
          tmName: match.tmName,
          matchedSourceText: match.matchedSourceText,
          sourceText: serializeTokensToDisplayText(match.sourceTokens),
          targetText: serializeTokensToDisplayText(match.targetTokens),
        })),
        tbReferences: tbMatches.slice(0, 100).map((match) => ({
          srcTerm: match.srcTerm,
          tgtTerm: match.tgtTerm,
          note: match.note ?? null,
        })),
      },
      engine: {
        tm: tmMatches.slice(0, 10).map(
          (match): EngineTMReference => ({
            kind: match.kind,
            rank: match.rank,
            similarity: match.similarity,
            tmName: match.tmName,
            sourceText: serializeTokensToDisplayText(match.sourceTokens),
            targetText: serializeTokensToDisplayText(match.targetTokens),
            matchedSourceText: match.matchedSourceText,
          }),
        ),
        tb: tbMatches.slice(0, 100).map(
          (match): EngineTBReference => ({
            tbName: match.tbName,
            srcTerm: match.srcTerm,
            tgtTerm: match.tgtTerm,
            note: match.note ?? null,
          }),
        ),
      },
    };
  }
}

function buildSkippedResult(unit: LocalizationUnit): LocalizationUnitResult {
  return {
    id: unit.id,
    source: unit.source,
    target: unit.target,
    status: "skipped",
    metadata: unit.metadata,
  };
}
```

- [ ] **Step 4: Add the barrel export**

Create `apps/desktop/src/main/localization/index.ts`:

```ts
export * from "./LocalizationEngine";
export * from "./types";
```

- [ ] **Step 5: Run engine tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run focused typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS. If imports or match field names differ, fix the implementation to match existing service types rather than changing the public `LocalizationEngine` API.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/localization/LocalizationEngine.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/index.ts
git commit -m "feat: add LocalizationEngine units facade"
```

## Task 4: Spreadsheet File Adapter

**Files:**

- Create: `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts`
- Test: `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts`

- [ ] **Step 1: Write failing adapter tests**

Create `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import * as XLSX from "xlsx";
import { translateSpreadsheetFile } from "./spreadsheetFileAdapter";
import type { TranslateUnitsResult } from "./types";

describe("translateSpreadsheetFile", () => {
  it("detects source and target headers and writes translated output", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-localization-file-"));
    try {
      const inputPath = join(root, "mt.xlsx");
      const outputPath = join(root, "mt.fr.xlsx");
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ["source", "target", "note"],
        ["你好", "", "row note"],
        ["已有译文", "Deja traduit", "keep"],
      ]);
      XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet2");
      XLSX.writeFile(workbook, inputPath);

      const result = await translateSpreadsheetFile(
        {
          projectId: 3,
          inputPath,
          outputPath,
          options: { targetScope: "blank-only" },
        },
        async (units): Promise<TranslateUnitsResult> => {
          expect(units).toEqual([
            {
              id: "row-2",
              source: "你好",
              target: "",
              context: undefined,
              metadata: { rowIndex: 1 },
            },
            {
              id: "row-3",
              source: "已有译文",
              target: "Deja traduit",
              context: undefined,
              metadata: { rowIndex: 2 },
            },
          ]);
          return {
            summary: { total: 2, translated: 1, skipped: 1, failed: 0 },
            results: [
              {
                id: "row-2",
                source: "你好",
                target: "Bonjour",
                status: "translated",
              },
              {
                id: "row-3",
                source: "已有译文",
                target: "Deja traduit",
                status: "skipped",
              },
            ],
          };
        },
      );

      expect(result.outputPath).toBe(outputPath);
      const written = XLSX.read(await readFile(outputPath), { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet2, {
        header: 1,
      }) as string[][];
      expect(rows[1][1]).toBe("Bonjour");
      expect(rows[2][1]).toBe("Deja traduit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails when required headers are missing", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-localization-file-"));
    try {
      const inputPath = join(root, "bad.xlsx");
      const outputPath = join(root, "bad.out.xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([["src", "dst"]]),
        "Sheet1",
      );
      XLSX.writeFile(workbook, inputPath);

      await expect(
        translateSpreadsheetFile(
          { projectId: 3, inputPath, outputPath },
          async () => {
            throw new Error("translate should not run");
          },
        ),
      ).rejects.toThrow("Could not detect source/target columns");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
```

Expected: FAIL because `spreadsheetFileAdapter.ts` does not exist.

- [ ] **Step 3: Implement the adapter**

Create `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts`:

```ts
import { readFile, writeFile } from "fs/promises";
import { extname } from "path";
import * as XLSX from "xlsx";
import type {
  LocalizationUnit,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitsResult,
} from "./types";

type TranslateUnitsFn = (
  units: LocalizationUnit[],
) => Promise<TranslateUnitsResult>;
type SheetCell = string | number | boolean | null | undefined;

export async function translateSpreadsheetFile(
  input: TranslateFileInput,
  translateUnits: TranslateUnitsFn,
): Promise<TranslateFileResult> {
  const workbook = XLSX.read(await readFile(input.inputPath), {
    type: "buffer",
  });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`Workbook has no sheets: ${input.inputPath}`);
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: false,
    defval: "",
  }) as SheetCell[][];

  const columns = resolveColumns(rows[0] ?? [], input.columns);
  const units = rowsToUnits(rows, columns);
  const translation = await translateUnits(units);

  for (const result of translation.results) {
    if (result.status === "failed" || result.target === undefined) continue;
    const rowIndex = Number(result.metadata?.rowIndex);
    if (!Number.isInteger(rowIndex)) continue;
    const cellAddress = XLSX.utils.encode_cell({
      r: rowIndex,
      c: columns.targetCol,
    });
    worksheet[cellAddress] = { t: "s", v: result.target };
  }

  const bookType = detectBookType(input.outputPath, input.format);
  const data = XLSX.write(workbook, { bookType, type: "buffer" }) as
    | Buffer
    | Uint8Array
    | string;
  await writeFile(
    input.outputPath,
    typeof data === "string" ? data : Buffer.from(data),
  );

  return {
    ...translation,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
  };
}

function resolveColumns(
  headerRow: SheetCell[],
  options: TranslateFileInput["columns"] = {},
): {
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
  hasHeader: boolean;
} {
  const hasHeader = options.hasHeader !== false;
  const sourceCol =
    options.sourceCol ??
    (hasHeader
      ? findHeaderColumn(headerRow, options.sourceHeader ?? "source")
      : undefined);
  const targetCol =
    options.targetCol ??
    (hasHeader
      ? findHeaderColumn(headerRow, options.targetHeader ?? "target")
      : undefined);
  const contextCol =
    options.contextCol ??
    (hasHeader && options.contextHeader
      ? findHeaderColumn(headerRow, options.contextHeader)
      : undefined);

  if (sourceCol === undefined || targetCol === undefined) {
    throw new Error(
      "Could not detect source/target columns. Provide headers or numeric column indexes.",
    );
  }
  if (sourceCol === targetCol) {
    throw new Error("Source and target columns must be different.");
  }

  return { sourceCol, targetCol, contextCol, hasHeader };
}

function rowsToUnits(
  rows: SheetCell[][],
  columns: {
    sourceCol: number;
    targetCol: number;
    contextCol?: number;
    hasHeader: boolean;
  },
): LocalizationUnit[] {
  const startIndex = columns.hasHeader ? 1 : 0;
  const units: LocalizationUnit[] = [];

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const source = cellToText(row[columns.sourceCol]);
    if (!source.trim()) continue;

    units.push({
      id: `row-${rowIndex + 1}`,
      source,
      target: cellToText(row[columns.targetCol]),
      context:
        columns.contextCol === undefined
          ? undefined
          : cellToText(row[columns.contextCol]),
      metadata: { rowIndex },
    });
  }

  return units;
}

function findHeaderColumn(
  headerRow: SheetCell[],
  headerName: string,
): number | undefined {
  const normalized = headerName.trim().toLowerCase();
  const index = headerRow.findIndex(
    (cell) => cellToText(cell).trim().toLowerCase() === normalized,
  );
  return index >= 0 ? index : undefined;
}

function cellToText(value: SheetCell): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function detectBookType(
  outputPath: string,
  explicitFormat?: "xlsx" | "csv",
): XLSX.BookType {
  if (explicitFormat) return explicitFormat;
  const extension = extname(outputPath).toLowerCase();
  if (extension === ".csv") return "csv";
  return "xlsx";
}
```

- [ ] **Step 4: Run adapter tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run engine tests again**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/main/localization/spreadsheetFileAdapter.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts apps/desktop/src/main/localization/LocalizationEngine.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts
git commit -m "feat: translate external spreadsheets without import"
```

## Task 5: CLI Entry Point

**Files:**

- Create: `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`
- Create: `scripts/translate-file.mjs`
- Test: `scripts/translate-file.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write the CLI dynamic runner test**

Create `apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATDatabase } from "../../../../../packages/db/src";
import { LocalizationEngine } from "./LocalizationEngine";

const ENV_FLAG = "LOCALIZATION_ENGINE_FILE_DYNAMIC";

describe("LocalizationEngine CLI runner", () => {
  it("localization-engine-file-env-run", async () => {
    if (process.env[ENV_FLAG] !== "1") return;

    const dbPath = readRequiredEnv("LOCALIZATION_ENGINE_DB_PATH");
    const projectId = readPositiveInt(
      readRequiredEnv("LOCALIZATION_ENGINE_PROJECT_ID"),
    );
    const inputPath = readRequiredEnv("LOCALIZATION_ENGINE_INPUT_PATH");
    const outputPath = readRequiredEnv("LOCALIZATION_ENGINE_OUTPUT_PATH");

    const db = new CATDatabase(dbPath);
    try {
      const engine = new LocalizationEngine(db, { dbPath });
      const result = await engine.translateFile({
        projectId,
        inputPath,
        outputPath,
        options: {
          targetScope:
            process.env.LOCALIZATION_ENGINE_TARGET_SCOPE ===
            "overwrite-non-confirmed"
              ? "overwrite-non-confirmed"
              : "blank-only",
        },
      });

      console.info(
        JSON.stringify({
          event: "localization_file_complete",
          projectId,
          inputPath,
          outputPath,
          summary: result.summary,
        }),
      );
      expect(result.summary.total).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });
});

function readRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function readPositiveInt(value: string): number {
  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new Error(`Expected positive integer, got ${value}`);
  }
  return numberValue;
}
```

- [ ] **Step 2: Write the CLI script tests**

Create `scripts/translate-file.test.mjs`:

```js
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const scriptPath = path.join(repoRoot, "scripts", "translate-file.mjs");

test("translate file script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /translate-file\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--input <path>/);
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--target-scope <scope>/);
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
node --test scripts/translate-file.test.mjs
```

Expected: FAIL because `scripts/translate-file.mjs` does not exist.

- [ ] **Step 4: Implement `scripts/translate-file.mjs`**

Create `scripts/translate-file.mjs`:

```js
#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_NAME = "localization-engine-file-env-run";
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts";

function usage() {
  console.log(`Usage:
  node scripts/translate-file.mjs --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>                    SQLite DB path.
  --project-id <id>              Project id used as TM+TB+MT engine.
  --input <path>                 External xlsx/csv input file.
  --output <path>                Output xlsx/csv path to write.
  --target-scope <scope>         blank-only or overwrite-non-confirmed. Default: blank-only.
  -h, --help                     Show this help.

Examples:
  npm run translate:file -- --db "C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\simple-cat-tool\\\\cat_v1.db" --project-id 3 --input mt.xlsx --output mt.fr.xlsx`);
}

function parseArgs(argv) {
  const config = {
    dbPath: "",
    projectId: "",
    inputPath: "",
    outputPath: "",
    targetScope: "blank-only",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--db") {
      config.dbPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--project-id") {
      config.projectId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg === "--input") {
      config.inputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--output") {
      config.outputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg === "--target-scope") {
      config.targetScope = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.dbPath || !fs.existsSync(config.dbPath))
    throw new Error(`Database not found: ${config.dbPath}`);
  if (
    !Number.isInteger(Number(config.projectId)) ||
    Number(config.projectId) <= 0
  ) {
    throw new Error("--project-id must be a positive integer.");
  }
  if (!config.inputPath || !fs.existsSync(config.inputPath))
    throw new Error(`Input file not found: ${config.inputPath}`);
  if (!config.outputPath) throw new Error("Missing --output.");
  if (
    config.targetScope !== "blank-only" &&
    config.targetScope !== "overwrite-non-confirmed"
  ) {
    throw new Error(
      "--target-scope must be blank-only or overwrite-non-confirmed.",
    );
  }

  return config;
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--"))
    throw new Error(`Missing value for ${flag}.`);
  return value;
}

function run(config) {
  const vitestCmd = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!fs.existsSync(vitestCmd))
    throw new Error(`Vitest binary not found: ${vitestCmd}`);

  const result = spawnSync(
    vitestCmd,
    [
      "run",
      TEST_PATH,
      "-t",
      TEST_NAME,
      "--reporter=verbose",
      "--testTimeout=3600000",
    ],
    {
      cwd: process.cwd(),
      shell: process.platform === "win32",
      stdio: "inherit",
      env: {
        ...process.env,
        LOCALIZATION_ENGINE_FILE_DYNAMIC: "1",
        LOCALIZATION_ENGINE_DB_PATH: config.dbPath,
        LOCALIZATION_ENGINE_PROJECT_ID: config.projectId,
        LOCALIZATION_ENGINE_INPUT_PATH: config.inputPath,
        LOCALIZATION_ENGINE_OUTPUT_PATH: config.outputPath,
        LOCALIZATION_ENGINE_TARGET_SCOPE: config.targetScope,
      },
    },
  );

  if (result.error)
    throw new Error(`Failed to start ${vitestCmd}: ${result.error.message}`);
  process.exit(result.status ?? 1);
}

try {
  run(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

- [ ] **Step 5: Add package script**

Modify `package.json` scripts:

```json
"translate:file": "npm run rebuild:test && node scripts/translate-file.mjs"
```

- [ ] **Step 6: Run CLI tests and help**

Run:

```bash
node --test scripts/translate-file.test.mjs
npm run translate:file -- --help
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts scripts/translate-file.mjs scripts/translate-file.test.mjs package.json
git commit -m "feat: add external file translation CLI"
```

## Task 6: Documentation and No-Write Smoke Verification

**Files:**

- Modify: `DOCS/00_START_HERE.md`

- [ ] **Step 1: Document the new command**

Add this section after `Headless project/API inspection` in `DOCS/00_START_HERE.md`:

```md
External LocalizationEngine file translation:

- To translate an external spreadsheet through a project as a TM+TB+MT engine without importing the file into the project, run `npm run translate:file -- --db <path> --project-id <id> --input <path> --output <path>`.
- The command reads project settings, mounted TM/TB resources, and AI provider configuration, but does not create `files` or `segments` records.
- The input file is not modified in place. The translated spreadsheet is written to `--output`.
- By default, the file adapter detects `source` and `target` headers and translates only blank targets.
```

- [ ] **Step 2: Run targeted tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/RequestScheduler.test.ts apps/desktop/src/main/localization/transientSegment.test.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
node --test scripts/translate-file.test.mjs
npm run typecheck --workspace=apps/desktop
node node_modules/prettier/bin/prettier.cjs --check apps/desktop/src/main/localization scripts/translate-file.mjs scripts/translate-file.test.mjs DOCS/00_START_HERE.md package.json
```

Expected: all PASS.

- [ ] **Step 3: Run real no-write smoke**

Before running, inspect project `3`:

```bash
npm run inspect:projects -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3
```

Record the listed files. Then run:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.fr.xlsx"
```

Inspect again:

```bash
npm run inspect:projects -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3
```

Expected:

- `mt.fr.xlsx` exists.
- Project `3` has the same file count as before the command.
- No new `mt.xlsx` file record is added.
- The output command reports translated rows.

- [ ] **Step 4: Commit docs and any smoke fixes**

```bash
git add DOCS/00_START_HERE.md apps/desktop/src/main/localization scripts/translate-file.mjs scripts/translate-file.test.mjs package.json
git commit -m "docs: document LocalizationEngine file translation"
```

## Plan Self-Review

- Spec coverage: The plan covers the facade, no-write persistence rule, unit translation, file translation, prompt/provider reuse, scheduling boundary, CLI smoke, and documentation.
- Gap scan: The plan contains concrete file paths, commands, test examples, and implementation snippets. It contains no unresolved gaps.
- Type consistency: Public names are consistent across tasks: `LocalizationEngine`, `translateUnits`, `translateFile`, `LocalizationUnit`, `TranslateUnitsResult`, `TranslateFileInput`, and `translate:file`.
- Scope check: The plan delivers a local engine facade and CLI. HTTP service wrapping is intentionally outside this first implementation slice.
