# Localization Inspector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a transparent no-request localization inspector that outputs xlsx/json artifacts showing File, TM, TB, and MT prompt stages while keeping TM/TB/MT modules orthogonal.

**Architecture:** Refactor the current LocalizationEngine internals into FileModule, TMModule, TBModule, and MTModule boundaries. Extract prompt block visibility from the shared core prompt builder so real translation and inspection use the same prompt composition logic. Add LocalizationInspector plus an `inspect:localization` CLI that writes a preserved-row xlsx with appended inspect columns and a full JSON sidecar.

**Tech Stack:** TypeScript, Vitest, Node scripts, `xlsx`, `@cat/core` prompt utilities, existing desktop SQLite adapters/services, existing `AITextTranslator` and `AITransport` ports.

---

## Scope Check

This plan covers one coherent subsystem: the transparent localization inspection pipeline and the module extraction needed to make it trustworthy. It intentionally includes File/TM/TB/MT module boundaries because the user chose the large-refactor path for this branch.

Non-goals for this plan:

- UI panel
- multi-sheet inspection
- dialogue prompt inspection
- provider request inspection
- comparing two inspect artifacts

## File Structure

Create:

- `apps/desktop/src/main/localization/artifacts.ts`
  - Shared File/TM/TB/Prompt/Inspect artifact types.
- `apps/desktop/src/main/localization/modules/FileModule.ts`
  - Parse external spreadsheets, convert rows to units, write translated output, expose inspect writer helpers.
- `apps/desktop/src/main/localization/modules/FileModule.test.ts`
  - File parsing and output preservation tests.
- `apps/desktop/src/main/localization/modules/TMModule.ts`
  - TM artifact creation from existing `TMService`.
- `apps/desktop/src/main/localization/modules/TMModule.test.ts`
  - TM raw match and selected reference tests.
- `apps/desktop/src/main/localization/modules/TBModule.ts`
  - TB artifact creation from existing `TBService`.
- `apps/desktop/src/main/localization/modules/TBModule.test.ts`
  - TB raw match and selected reference tests.
- `apps/desktop/src/main/localization/modules/MTModule.ts`
  - Provider config resolution, prompt composition, and provider request boundary.
- `apps/desktop/src/main/localization/modules/MTModule.test.ts`
  - Prompt artifact and no-request composition tests.
- `apps/desktop/src/main/localization/LocalizationInspector.ts`
  - Orchestrates no-request file inspection.
- `apps/desktop/src/main/localization/LocalizationInspector.test.ts`
  - Integration tests for xlsx/json artifact generation.
- `apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts`
  - Dynamic CLI runner test.
- `scripts/inspect-localization.mjs`
  - CLI wrapper.
- `scripts/inspect-localization.test.mjs`
  - CLI help and validation tests.

Modify:

- `packages/core/src/project/aiPromptTypes.ts`
  - Add prompt section/block types and expose them from text prompt bundles.
- `packages/core/src/project/aiPromptTemplates.ts`
  - Build and return prompt blocks from the same template code used for the final prompt.
- `packages/core/src/project/aiPromptTemplateCatalog.test.ts` or `packages/core/src/project/index.test.ts`
  - Add prompt block regression coverage.
- `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`
  - Continue using `buildAITextPromptBundle`; no behavior change, but debug metadata can still read system/user prompt.
- `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts`
  - Delegate parsing/writing to FileModule.
- `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts`
  - Keep current behavior tests green after FileModule extraction.
- `apps/desktop/src/main/localization/LocalizationEngine.ts`
  - Use FileModule, TMModule, TBModule, and MTModule instead of private reference/prompt orchestration.
- `apps/desktop/src/main/localization/LocalizationEngine.test.ts`
  - Keep existing no-import translation tests green.
- `apps/desktop/src/main/localization/index.ts`
  - Export inspector and artifact/module public types.
- `package.json`
  - Add `inspect:localization`.
- `DOCS/00_START_HERE.md`
  - Document the inspector command.

## Execution Order

Tasks are sequenced so each task leaves a working repo:

1. Add artifact types.
2. Extract FileModule and keep `translate:file` behavior unchanged.
3. Add TMModule and TBModule artifact boundaries.
4. Expose prompt sections from core prompt builder.
5. Add MTModule and refactor LocalizationEngine to use the orthogonal modules.
6. Add LocalizationInspector xlsx/json writer.
7. Add `inspect:localization` CLI.
8. Docs, focused verification, and real no-request smoke.

## Task 1: Artifact Types

**Files:**

- Create: `apps/desktop/src/main/localization/artifacts.ts`
- Modify: `apps/desktop/src/main/localization/index.ts`
- Test: typecheck after later tasks; this task is type-only.

- [ ] **Step 1: Create artifact type file**

Create `apps/desktop/src/main/localization/artifacts.ts`:

```ts
import type {
  PromptConcordanceReference,
  PromptTBReference,
  PromptTMReference,
  ProjectType,
} from "@cat/core/project";
import type { TBMatch } from "@cat/core/models";
import type { ReasoningEffort } from "../services/ports";
import type { TMMatch } from "../services/TMService";

export type InspectUnitStatus = "ready" | "skipped-empty-source" | "error";

export interface FileParseColumnsArtifact {
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
  hasHeader: boolean;
}

export type FileCellValue = string | number | boolean | null;

export interface FileParseRowArtifact {
  rowIndex: number;
  rowNumber: number;
  unitId: string;
  source: string;
  target: string;
  context?: string;
  originalCells: FileCellValue[];
}

export interface FileParseArtifact {
  inputPath: string;
  sheetName: string;
  columns: FileParseColumnsArtifact;
  rows: FileParseRowArtifact[];
}

export interface MountedTMArtifact {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  type: string;
  priority: number;
  permission: string;
  isEnabled: boolean;
}

export interface TMArtifact {
  unitId: string;
  segmentId: string;
  mountedTMs: MountedTMArtifact[];
  rawMatches: TMMatch[];
  selectedReferences: {
    tmReferences: PromptTMReference[];
    concordanceReferences: PromptConcordanceReference[];
  };
  selectionPolicy: {
    maxTmReferences: number;
    maxConcordanceReferences: number;
  };
  diagnostics: string[];
}

export interface MountedTBArtifact {
  id: string;
  name: string;
  srcLang: string;
  tgtLang: string;
  priority: number;
  isEnabled: boolean;
}

export interface TBArtifact {
  unitId: string;
  segmentId: string;
  mountedTBs: MountedTBArtifact[];
  rawMatches: TBMatch[];
  selectedReferences: PromptTBReference[];
  selectionPolicy: {
    maxTbReferences: number;
  };
  diagnostics: string[];
}

export interface PromptProviderArtifact {
  id: string | null;
  name: string | null;
  baseUrl: string | null;
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
  tbPromptBlock: string;
  systemPrompt: string;
  userPrompt: string;
  promptChars: {
    system: number;
    user: number;
    total: number;
  };
}

export interface InspectTruncatedFields {
  tmForMt: boolean;
  tbForMt: boolean;
  mtUserPrompt: boolean;
}

export interface InspectUnitArtifact {
  unit: FileParseRowArtifact;
  transientSegment: {
    segmentId: string;
    matchKey: string;
    srcHash: string;
    tagsSignature: string;
  };
  tm: TMArtifact;
  tb: TBArtifact;
  mt: PromptArtifact;
  xlsx: {
    tmForMt: string;
    tbForMt: string;
    mtUserPrompt: string;
    truncated: InspectTruncatedFields;
  };
  status: InspectUnitStatus;
  error?: string;
}

export interface InspectArtifact {
  version: 1;
  generatedAt: string;
  project: {
    id: number;
    name: string;
    srcLang: string;
    tgtLang: string;
    projectType: ProjectType;
    promptChars: number;
  };
  inputFile: FileParseArtifact;
  systemPrompt: {
    value: string;
    promptChars: number;
    xlsxValue: string;
    truncated: boolean;
  };
  units: InspectUnitArtifact[];
}
```

- [ ] **Step 2: Export artifact types**

Modify `apps/desktop/src/main/localization/index.ts`:

```ts
export * from "./LocalizationEngine";
export * from "./types";
export * from "./artifacts";
```

Keep any existing explicit exports only if needed by TypeScript; the final file must export the new artifact types.

- [ ] **Step 3: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/desktop/src/main/localization/artifacts.ts apps/desktop/src/main/localization/index.ts
git commit -m "feat: add localization inspect artifact types"
```

## Task 2: FileModule Extraction

**Files:**

- Create: `apps/desktop/src/main/localization/modules/FileModule.ts`
- Create: `apps/desktop/src/main/localization/modules/FileModule.test.ts`
- Modify: `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts`
- Test: `apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts`

- [ ] **Step 1: Write FileModule tests**

Create `apps/desktop/src/main/localization/modules/FileModule.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { describe, expect, it } from "vitest";
import {
  parseExternalSpreadsheet,
  fileRowsToLocalizationUnits,
  writeTranslatedSpreadsheet,
  writeInspectSpreadsheet,
} from "./FileModule";
import type { InspectArtifact } from "../artifacts";
import type { TranslateUnitsResult } from "../types";

describe("FileModule", () => {
  it("parses first worksheet rows while preserving original cells", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-file-module-"));
    try {
      const inputPath = join(root, "mt.xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["source", "target", "note"],
          ["Hello", "", "row note"],
          ["", "", "empty source row"],
          ["World", "Monde", "existing"],
        ]),
        "Sheet2",
      );
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath: join(root, "out.xlsx"),
      });

      expect(parsed.artifact).toMatchObject({
        inputPath,
        sheetName: "Sheet2",
        columns: { sourceCol: 0, targetCol: 1, hasHeader: true },
      });
      expect(parsed.artifact.rows).toEqual([
        {
          rowIndex: 1,
          rowNumber: 2,
          unitId: "row-2",
          source: "Hello",
          target: "",
          context: undefined,
          originalCells: ["Hello", "", "row note"],
        },
        {
          rowIndex: 2,
          rowNumber: 3,
          unitId: "row-3",
          source: "",
          target: "",
          context: undefined,
          originalCells: ["", "", "empty source row"],
        },
        {
          rowIndex: 3,
          rowNumber: 4,
          unitId: "row-4",
          source: "World",
          target: "Monde",
          context: undefined,
          originalCells: ["World", "Monde", "existing"],
        },
      ]);
      expect(fileRowsToLocalizationUnits(parsed.artifact.rows)).toEqual([
        {
          id: "row-2",
          source: "Hello",
          target: "",
          context: undefined,
          metadata: { rowIndex: 1, rowNumber: 2 },
        },
        {
          id: "row-4",
          source: "World",
          target: "Monde",
          context: undefined,
          metadata: { rowIndex: 3, rowNumber: 4 },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes translated targets to a new workbook without changing input", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-file-module-"));
    try {
      const inputPath = join(root, "mt.xlsx");
      const outputPath = join(root, "mt.fr.xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["source", "target"],
          ["Hello", ""],
        ]),
        "Sheet1",
      );
      XLSX.writeFile(workbook, inputPath);
      const originalInput = await readFile(inputPath);

      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath,
      });
      const translation: TranslateUnitsResult = {
        summary: { total: 1, translated: 1, skipped: 0, failed: 0 },
        results: [
          {
            id: "row-2",
            source: "Hello",
            target: "Bonjour",
            status: "translated",
            metadata: { rowIndex: 1 },
          },
        ],
      };
      await writeTranslatedSpreadsheet(parsed, translation, outputPath);

      expect(await readFile(inputPath)).toEqual(originalInput);
      const written = XLSX.read(await readFile(outputPath), { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: "",
      }) as string[][];
      expect(rows[1][1]).toBe("Bonjour");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("writes inspect workbook with appended columns and system prompt sheet", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-file-module-"));
    try {
      const inputPath = join(root, "mt.xlsx");
      const outputPath = join(root, "mt.inspect.xlsx");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["source", "target"],
          ["Hello", ""],
        ]),
        "Sheet1",
      );
      XLSX.writeFile(workbook, inputPath);
      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath,
      });
      const artifact: InspectArtifact = {
        version: 1,
        generatedAt: "2026-05-19T00:00:00.000Z",
        project: {
          id: 1,
          name: "Demo",
          srcLang: "en",
          tgtLang: "fr",
          projectType: "translation",
          promptChars: 0,
        },
        inputFile: parsed.artifact,
        systemPrompt: {
          value: "System prompt",
          promptChars: 13,
          xlsxValue: "System prompt",
          truncated: false,
        },
        units: [
          {
            unit: parsed.artifact.rows[0],
            transientSegment: {
              segmentId: "transient:row-2",
              matchKey: "hello",
              srcHash: "hash",
              tagsSignature: "",
            },
            tm: {
              unitId: "row-2",
              segmentId: "transient:row-2",
              mountedTMs: [],
              rawMatches: [],
              selectedReferences: {
                tmReferences: [],
                concordanceReferences: [],
              },
              selectionPolicy: {
                maxTmReferences: 3,
                maxConcordanceReferences: 3,
              },
              diagnostics: [],
            },
            tb: {
              unitId: "row-2",
              segmentId: "transient:row-2",
              mountedTBs: [],
              rawMatches: [],
              selectedReferences: [],
              selectionPolicy: { maxTbReferences: 100 },
              diagnostics: [],
            },
            mt: {
              unitId: "row-2",
              provider: { id: null, name: null, baseUrl: null },
              model: "mock-model",
              reasoningEffort: "medium",
              projectPrompt: "",
              projectType: "translation",
              sourcePayload: "Hello",
              tmPromptBlock: "TM block",
              tbPromptBlock: "TB block",
              systemPrompt: "System prompt",
              userPrompt: "User prompt",
              promptChars: { system: 13, user: 11, total: 24 },
            },
            xlsx: {
              tmForMt: "TM block",
              tbForMt: "TB block",
              mtUserPrompt: "User prompt",
              truncated: {
                tmForMt: false,
                tbForMt: false,
                mtUserPrompt: false,
              },
            },
            status: "ready",
          },
        ],
      };

      await writeInspectSpreadsheet(parsed, artifact, outputPath);
      const written = XLSX.read(await readFile(outputPath), { type: "buffer" });
      expect(written.SheetNames).toEqual(["Segments", "MT_SystemPrompt"]);
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: "",
      }) as string[][];
      expect(rows[0].slice(-5)).toEqual([
        "_tm_for_mt",
        "_tb_for_mt",
        "_mt_user_prompt",
        "_inspect_status",
        "_inspect_json_ref",
      ]);
      expect(rows[1].slice(-5)).toEqual([
        "TM block",
        "TB block",
        "User prompt",
        "ready",
        "#/units/row-2",
      ]);
      const systemRows = XLSX.utils.sheet_to_json(
        written.Sheets.MT_SystemPrompt,
        {
          header: 1,
          defval: "",
        },
      ) as string[][];
      expect(systemRows).toContainEqual(["systemPrompt", "System prompt"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run FileModule test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/FileModule.test.ts
```

Expected: FAIL because `FileModule.ts` does not exist.

- [ ] **Step 3: Implement FileModule**

Create `apps/desktop/src/main/localization/modules/FileModule.ts`:

```ts
import { readFile, writeFile } from "fs/promises";
import { extname } from "path";
import * as XLSX from "xlsx";
import type {
  FileCellValue,
  FileParseArtifact,
  FileParseColumnsArtifact,
  FileParseRowArtifact,
  InspectArtifact,
  InspectUnitArtifact,
} from "../artifacts";
import type {
  LocalizationUnit,
  TranslateFileInput,
  TranslateUnitsResult,
} from "../types";

type SheetCell = string | number | boolean | null | undefined;

export interface ParsedSpreadsheetFile {
  inputPath: string;
  workbook: XLSX.WorkBook;
  sheetName: string;
  worksheet: XLSX.WorkSheet;
  columns: FileParseColumnsArtifact;
  rawRows: SheetCell[][];
  artifact: FileParseArtifact;
}

export async function parseExternalSpreadsheet(
  input: TranslateFileInput,
): Promise<ParsedSpreadsheetFile> {
  const workbook = XLSX.read(await readFile(input.inputPath), {
    type: "buffer",
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`Workbook has no sheets: ${input.inputPath}`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: true,
    defval: "",
  }) as SheetCell[][];
  const columns = resolveColumns(rawRows[0] ?? [], input.columns);
  const rows = rowsToFileParseRows(rawRows, columns);

  return {
    inputPath: input.inputPath,
    workbook,
    sheetName,
    worksheet,
    columns,
    rawRows,
    artifact: {
      inputPath: input.inputPath,
      sheetName,
      columns,
      rows,
    },
  };
}

export function fileRowsToLocalizationUnits(
  rows: FileParseRowArtifact[],
): LocalizationUnit[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      id: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      metadata: { rowIndex: row.rowIndex, rowNumber: row.rowNumber },
    }));
}

export async function writeTranslatedSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  translation: TranslateUnitsResult,
  outputPath: string,
  explicitFormat?: "xlsx" | "csv",
): Promise<void> {
  const rowIndexByUnitId = new Map(
    parsed.artifact.rows.map((row) => [row.unitId, row.rowIndex] as const),
  );

  for (const result of translation.results) {
    if (result.status === "failed" || result.target === undefined) continue;
    const rowIndex = resolveResultRowIndex(
      result.metadata?.rowIndex,
      rowIndexByUnitId.get(result.id),
    );
    if (rowIndex === undefined) continue;

    const cellAddress = XLSX.utils.encode_cell({
      r: rowIndex,
      c: parsed.columns.targetCol,
    });
    parsed.worksheet[cellAddress] = { t: "s", v: result.target };
    ensureWorksheetRefIncludesCell(
      parsed.worksheet,
      rowIndex,
      parsed.columns.targetCol,
    );
  }

  await writeWorkbook(parsed.workbook, outputPath, explicitFormat);
}

export async function writeInspectSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  artifact: InspectArtifact,
  outputPath: string,
): Promise<void> {
  const workbook = XLSX.utils.book_new();
  const inspectByUnitId = new Map(
    artifact.units.map((unit) => [unit.unit.unitId, unit] as const),
  );
  const inspectHeaders = [
    "_tm_for_mt",
    "_tb_for_mt",
    "_mt_user_prompt",
    "_inspect_status",
    "_inspect_json_ref",
  ];
  const sourceRows = parsed.rawRows.map((row, rowIndex) => {
    if (rowIndex === 0 && parsed.columns.hasHeader) {
      return [...row.map(cellToSerializable), ...inspectHeaders];
    }

    const unitId = `row-${rowIndex + 1}`;
    const inspect = inspectByUnitId.get(unitId);
    if (!inspect) {
      return [
        ...row.map(cellToSerializable),
        "",
        "",
        "",
        "skipped-empty-source",
        "",
      ];
    }

    return [
      ...row.map(cellToSerializable),
      inspect.xlsx.tmForMt,
      inspect.xlsx.tbForMt,
      inspect.xlsx.mtUserPrompt,
      inspect.status,
      `#/units/${inspect.unit.unitId}`,
    ];
  });

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(sourceRows),
    "Segments",
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["projectId", artifact.project.id],
      ["projectName", artifact.project.name],
      ["srcLang", artifact.project.srcLang],
      ["tgtLang", artifact.project.tgtLang],
      ["projectType", artifact.project.projectType],
      ["promptChars", artifact.systemPrompt.promptChars],
      ["truncated", artifact.systemPrompt.truncated ? "true" : "false"],
      ["jsonRef", "#/systemPrompt/value"],
      ["systemPrompt", artifact.systemPrompt.xlsxValue],
    ]),
    "MT_SystemPrompt",
  );
  await writeWorkbook(workbook, outputPath);
}

function resolveColumns(
  headerRow: SheetCell[],
  options: TranslateFileInput["columns"] = {},
): FileParseColumnsArtifact {
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

function rowsToFileParseRows(
  rows: SheetCell[][],
  columns: FileParseColumnsArtifact,
): FileParseRowArtifact[] {
  const startIndex = columns.hasHeader ? 1 : 0;
  const result: FileParseRowArtifact[] = [];
  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const source = cellToText(row[columns.sourceCol]);
    const target = cellToText(row[columns.targetCol]);
    const context =
      columns.contextCol === undefined
        ? undefined
        : cellToText(row[columns.contextCol]);
    result.push({
      rowIndex,
      rowNumber: rowIndex + 1,
      unitId: `row-${rowIndex + 1}`,
      source,
      target,
      context,
      originalCells: row.map(cellToSerializable),
    });
  }
  return result;
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

function cellToSerializable(value: SheetCell): FileCellValue {
  if (value === undefined) return null;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}

function resolveResultRowIndex(
  metadataRowIndex: unknown,
  unitRowIndex: number | undefined,
): number | undefined {
  const rowIndex = Number(metadataRowIndex ?? unitRowIndex);
  return Number.isInteger(rowIndex) ? rowIndex : undefined;
}

function ensureWorksheetRefIncludesCell(
  worksheet: XLSX.WorkSheet,
  rowIndex: number,
  columnIndex: number,
): void {
  const cellRange = {
    s: { r: rowIndex, c: columnIndex },
    e: { r: rowIndex, c: columnIndex },
  };
  if (!worksheet["!ref"]) {
    worksheet["!ref"] = XLSX.utils.encode_range(cellRange);
    return;
  }
  const range = XLSX.utils.decode_range(worksheet["!ref"]);
  range.s.r = Math.min(range.s.r, rowIndex);
  range.s.c = Math.min(range.s.c, columnIndex);
  range.e.r = Math.max(range.e.r, rowIndex);
  range.e.c = Math.max(range.e.c, columnIndex);
  worksheet["!ref"] = XLSX.utils.encode_range(range);
}

async function writeWorkbook(
  workbook: XLSX.WorkBook,
  outputPath: string,
  explicitFormat?: "xlsx" | "csv",
): Promise<void> {
  const bookType = detectBookType(outputPath, explicitFormat);
  const data = XLSX.write(workbook, { bookType, type: "buffer" }) as
    | Buffer
    | Uint8Array
    | string;
  if (typeof data === "string") {
    await writeFile(outputPath, data, "utf8");
    return;
  }
  await writeFile(outputPath, Buffer.from(data));
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

- [ ] **Step 4: Refactor spreadsheet adapter to use FileModule**

Replace `apps/desktop/src/main/localization/spreadsheetFileAdapter.ts` with:

```ts
import type {
  LocalizationUnit,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitsResult,
} from "./types";
import {
  fileRowsToLocalizationUnits,
  parseExternalSpreadsheet,
  writeTranslatedSpreadsheet,
} from "./modules/FileModule";

type TranslateUnitsFn = (
  units: LocalizationUnit[],
) => Promise<TranslateUnitsResult>;

export async function translateSpreadsheetFile(
  input: TranslateFileInput,
  translateUnits: TranslateUnitsFn,
): Promise<TranslateFileResult> {
  const parsed = await parseExternalSpreadsheet(input);
  const units = fileRowsToLocalizationUnits(parsed.artifact.rows);
  const translation = await translateUnits(units);
  await writeTranslatedSpreadsheet(
    parsed,
    translation,
    input.outputPath,
    input.format,
  );

  return {
    ...translation,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
  };
}
```

- [ ] **Step 5: Run FileModule and adapter tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/FileModule.test.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/localization/modules/FileModule.ts apps/desktop/src/main/localization/modules/FileModule.test.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.ts apps/desktop/src/main/localization/spreadsheetFileAdapter.test.ts
git commit -m "feat: extract localization file module"
```

## Task 3: TMModule and TBModule Boundaries

**Files:**

- Create: `apps/desktop/src/main/localization/modules/TMModule.ts`
- Create: `apps/desktop/src/main/localization/modules/TMModule.test.ts`
- Create: `apps/desktop/src/main/localization/modules/TBModule.ts`
- Create: `apps/desktop/src/main/localization/modules/TBModule.test.ts`

- [ ] **Step 1: Write TMModule tests**

Create `apps/desktop/src/main/localization/modules/TMModule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { serializeTokensToDisplayText } from "@cat/core/text";
import type { TMEntry } from "@cat/core/models";
import { CATDatabase } from "../../../../../../packages/db/src";
import { SqliteProjectRepository } from "../../services/adapters/SqliteProjectRepository";
import { SqliteTMRepository } from "../../services/adapters/SqliteTMRepository";
import { TMService } from "../../services/TMService";
import { createTransientSegment } from "../transientSegment";
import { TMModule } from "./TMModule";

function createTMEntry(params: {
  tmId: string;
  projectId: number;
  sourceText: string;
  targetText: string;
}): TMEntry & { tmId: string } {
  const transient = createTransientSegment(
    {
      id: `seed-${params.sourceText}`,
      source: params.sourceText,
      target: params.targetText,
    },
    0,
  );
  const now = new Date().toISOString();
  return {
    id: `tm-${transient.srcHash}`,
    tmId: params.tmId,
    projectId: params.projectId,
    srcLang: "en",
    tgtLang: "fr",
    srcHash: transient.srcHash,
    matchKey: transient.matchKey,
    tagsSignature: transient.tagsSignature,
    sourceTokens: transient.sourceTokens,
    targetTokens: transient.targetTokens,
    usageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

describe("TMModule", () => {
  it("returns raw matches and selected prompt references without prompt text formatting", async () => {
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("TM Inspect", "en", "fr");
      const tmId = db.createTM("Main TM", "en", "fr", "main");
      db.mountTMToProject(projectId, tmId, 10, "read");
      const entry = createTMEntry({
        tmId,
        projectId,
        sourceText: "Hello world",
        targetText: "Bonjour le monde",
      });
      const entryId = db.upsertTMEntryBySrcHash(entry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(entry.sourceTokens),
        serializeTokensToDisplayText(entry.targetTokens),
        entryId,
      );

      const projectRepo = new SqliteProjectRepository(db);
      const tmRepo = new SqliteTMRepository(db);
      const module = new TMModule(tmRepo, new TMService(projectRepo, tmRepo));
      const segment = createTransientSegment(
        { id: "row-2", source: "Hello world" },
        0,
      );

      const artifact = await module.inspect(projectId, segment);

      expect(artifact).toMatchObject({
        unitId: "row-2",
        segmentId: "transient:row-2",
        selectionPolicy: { maxTmReferences: 3, maxConcordanceReferences: 3 },
        diagnostics: [],
      });
      expect(artifact.mountedTMs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: tmId, name: "Main TM" }),
        ]),
      );
      expect(artifact.rawMatches.length).toBeGreaterThan(0);
      expect(artifact.selectedReferences.tmReferences).toEqual([
        expect.objectContaining({
          similarity: 100,
          tmName: "Main TM",
          sourceText: "Hello world",
          targetText: "Bonjour le monde",
        }),
      ]);
      expect(JSON.stringify(artifact)).not.toContain("Translation Memory");
      expect(JSON.stringify(artifact)).not.toContain("_tm_for_mt");
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Write TBModule tests**

Create `apps/desktop/src/main/localization/modules/TBModule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATDatabase } from "../../../../../../packages/db/src";
import { SqliteProjectRepository } from "../../services/adapters/SqliteProjectRepository";
import { SqliteTBRepository } from "../../services/adapters/SqliteTBRepository";
import { TBService } from "../../services/TBService";
import { createTransientSegment } from "../transientSegment";
import { TBModule } from "./TBModule";

describe("TBModule", () => {
  it("returns raw term matches and selected prompt references without prompt text formatting", async () => {
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("TB Inspect", "en", "fr");
      const tbId = db.createTermBase("Terms", "en", "fr");
      db.mountTermBaseToProject(projectId, tbId, 10);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: "term-world",
        tbId,
        srcLang: "en",
        srcTerm: "world",
        tgtTerm: "monde",
        note: "Use common noun.",
      });

      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule(tbRepo, new TBService(projectRepo, tbRepo));
      const segment = createTransientSegment(
        { id: "row-2", source: "Hello world" },
        0,
      );

      const artifact = await module.inspect(projectId, segment);

      expect(artifact).toMatchObject({
        unitId: "row-2",
        segmentId: "transient:row-2",
        selectionPolicy: { maxTbReferences: 100 },
        diagnostics: [],
      });
      expect(artifact.mountedTBs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: tbId, name: "Terms" }),
        ]),
      );
      expect(artifact.rawMatches.length).toBeGreaterThan(0);
      expect(artifact.selectedReferences).toEqual([
        expect.objectContaining({
          srcTerm: "world",
          tgtTerm: "monde",
          note: "Use common noun.",
        }),
      ]);
      expect(JSON.stringify(artifact)).not.toContain("Terminology");
      expect(JSON.stringify(artifact)).not.toContain("_tb_for_mt");
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 3: Run module tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/TMModule.test.ts apps/desktop/src/main/localization/modules/TBModule.test.ts
```

Expected: FAIL because `TMModule.ts` and `TBModule.ts` do not exist.

- [ ] **Step 4: Implement TMModule**

Create `apps/desktop/src/main/localization/modules/TMModule.ts`:

```ts
import type { Segment } from "@cat/core/models";
import { serializeTokensToDisplayText } from "@cat/core/text";
import type {
  PromptConcordanceReference,
  PromptTMReference,
} from "@cat/core/project";
import type { TMArtifact, MountedTMArtifact } from "../artifacts";
import type { SqliteTMRepository } from "../../services/adapters/SqliteTMRepository";
import type { TMMatch, TMService } from "../../services/TMService";

const MAX_TM_PROMPT_REFERENCES = 3;
const MAX_CONCORDANCE_PROMPT_REFERENCES = 3;

export class TMModule {
  constructor(
    private readonly tmRepo: SqliteTMRepository,
    private readonly tmService: TMService,
  ) {}

  public async inspect(
    projectId: number,
    segment: Segment,
  ): Promise<TMArtifact> {
    const mountedTMs = this.tmRepo.getProjectMountedTMs(projectId).map(
      (tm): MountedTMArtifact => ({
        id: tm.id,
        name: tm.name,
        srcLang: tm.srcLang,
        tgtLang: tm.tgtLang,
        type: tm.type,
        priority: tm.priority,
        permission: tm.permission,
        isEnabled: Boolean(tm.isEnabled),
      }),
    );
    const rawMatches = await this.tmService.findMatches(projectId, segment);
    const tmReferences = rawMatches
      .filter(
        (match): match is Extract<TMMatch, { kind: "tm" }> =>
          match.kind === "tm",
      )
      .slice(0, MAX_TM_PROMPT_REFERENCES)
      .map(mapTMReference);
    const concordanceReferences = rawMatches
      .filter(
        (match): match is Extract<TMMatch, { kind: "concordance" }> =>
          match.kind === "concordance",
      )
      .slice(0, MAX_CONCORDANCE_PROMPT_REFERENCES)
      .map(mapConcordanceReference);

    return {
      unitId: segment.meta.externalUnitId
        ? String(segment.meta.externalUnitId)
        : segment.segmentId,
      segmentId: segment.segmentId,
      mountedTMs,
      rawMatches,
      selectedReferences: {
        tmReferences,
        concordanceReferences,
      },
      selectionPolicy: {
        maxTmReferences: MAX_TM_PROMPT_REFERENCES,
        maxConcordanceReferences: MAX_CONCORDANCE_PROMPT_REFERENCES,
      },
      diagnostics: [],
    };
  }
}

function mapTMReference(
  match: Extract<TMMatch, { kind: "tm" }>,
): PromptTMReference {
  return {
    similarity: match.similarity,
    tmName: match.tmName,
    sourceText: serializeTokensToDisplayText(match.sourceTokens),
    targetText: serializeTokensToDisplayText(match.targetTokens),
  };
}

function mapConcordanceReference(
  match: Extract<TMMatch, { kind: "concordance" }>,
): PromptConcordanceReference {
  return {
    tmName: match.tmName,
    matchedSourceText: match.matchedSourceText,
    sourceText: serializeTokensToDisplayText(match.sourceTokens),
    targetText: serializeTokensToDisplayText(match.targetTokens),
  };
}
```

- [ ] **Step 5: Implement TBModule**

Create `apps/desktop/src/main/localization/modules/TBModule.ts`:

```ts
import type { Segment } from "@cat/core/models";
import type { PromptTBReference } from "@cat/core/project";
import type { MountedTBArtifact, TBArtifact } from "../artifacts";
import type { SqliteTBRepository } from "../../services/adapters/SqliteTBRepository";
import type { TBService } from "../../services/TBService";

const MAX_TB_PROMPT_REFERENCES = 100;

export class TBModule {
  constructor(
    private readonly tbRepo: SqliteTBRepository,
    private readonly tbService: TBService,
  ) {}

  public async inspect(
    projectId: number,
    segment: Segment,
  ): Promise<TBArtifact> {
    const mountedTBs = this.tbRepo.getProjectMountedTermBases(projectId).map(
      (tb): MountedTBArtifact => ({
        id: tb.id,
        name: tb.name,
        srcLang: tb.srcLang,
        tgtLang: tb.tgtLang,
        priority: tb.priority,
        isEnabled: Boolean(tb.isEnabled),
      }),
    );
    const rawMatches = await this.tbService.findMatches(projectId, segment);
    const selectedReferences = rawMatches
      .slice(0, MAX_TB_PROMPT_REFERENCES)
      .map(
        (match): PromptTBReference => ({
          srcTerm: match.srcTerm,
          tgtTerm: match.tgtTerm,
          note: match.note ?? null,
        }),
      );

    return {
      unitId: segment.meta.externalUnitId
        ? String(segment.meta.externalUnitId)
        : segment.segmentId,
      segmentId: segment.segmentId,
      mountedTBs,
      rawMatches,
      selectedReferences,
      selectionPolicy: {
        maxTbReferences: MAX_TB_PROMPT_REFERENCES,
      },
      diagnostics: [],
    };
  }
}
```

- [ ] **Step 6: Run module tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/TMModule.test.ts apps/desktop/src/main/localization/modules/TBModule.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/localization/modules/TMModule.ts apps/desktop/src/main/localization/modules/TMModule.test.ts apps/desktop/src/main/localization/modules/TBModule.ts apps/desktop/src/main/localization/modules/TBModule.test.ts
git commit -m "feat: add localization TM and TB modules"
```

## Task 4: Core Prompt Sections

**Files:**

- Modify: `packages/core/src/project/aiPromptTypes.ts`
- Modify: `packages/core/src/project/aiPromptTemplates.ts`
- Test: `packages/core/src/project/aiPromptTemplateCatalog.test.ts` or `packages/core/src/project/index.test.ts`
- Modify: `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`

- [ ] **Step 1: Write prompt section tests**

Add this test to `packages/core/src/project/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildAITextPromptBundle } from "./index";

describe("AI text prompt sections", () => {
  it("returns TM and TB prompt blocks from the same user prompt composition", () => {
    const bundle = buildAITextPromptBundle("translation", {
      srcLang: "en",
      tgtLang: "fr",
      projectPrompt: "Project style.",
      sourceText: "Hello world",
      tmReferences: [
        {
          similarity: 100,
          tmName: "Main TM",
          sourceText: "Hello world",
          targetText: "Bonjour le monde",
        },
      ],
      tbReferences: [
        {
          srcTerm: "world",
          tgtTerm: "monde",
          note: "Use common noun.",
        },
      ],
    });

    expect(bundle.sections.tmPromptBlock).toContain("Main TM");
    expect(bundle.sections.tmPromptBlock).toContain("Bonjour le monde");
    expect(bundle.sections.tbPromptBlock).toContain("world");
    expect(bundle.sections.tbPromptBlock).toContain("monde");
    expect(bundle.sections.referencePromptBlock).toContain(
      bundle.sections.tmPromptBlock,
    );
    expect(bundle.sections.referencePromptBlock).toContain(
      bundle.sections.tbPromptBlock,
    );
    expect(bundle.userPrompt).toContain(bundle.sections.tmPromptBlock);
    expect(bundle.userPrompt).toContain(bundle.sections.tbPromptBlock);
  });
});
```

If `packages/core/src/project/index.test.ts` already has a `describe` block, add only the `it(...)` case inside the existing import structure.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts
```

Expected: FAIL because `bundle.sections` does not exist.

- [ ] **Step 3: Add prompt section types**

Modify `packages/core/src/project/aiPromptTypes.ts`:

```ts
export interface TextPromptSections {
  sourceBlock: string;
  contextBlock: string;
  currentTranslationBlock: string;
  tmPromptBlock: string;
  concordancePromptBlock: string;
  tbPromptBlock: string;
  validationFeedbackBlock: string;
  referencePromptBlock: string;
}

export interface TextPromptBundle {
  systemPrompt: string;
  userPrompt: string;
  hasProtectedMarkers: boolean;
  sourcePayload: string;
  sections: TextPromptSections;
}
```

Keep the existing `TextPromptBundle` export name and extend it; do not rename it.

- [ ] **Step 4: Refactor text prompt builder to return sections**

Modify `packages/core/src/project/aiPromptTemplates.ts` so `buildAITextPromptBundle` returns `TextPromptBundle`.

Add helpers near `buildTranslationUserPrompt`:

```ts
function buildEmptyTextPromptSections(): TextPromptSections {
  return {
    sourceBlock: "",
    contextBlock: "",
    currentTranslationBlock: "",
    tmPromptBlock: "",
    concordancePromptBlock: "",
    tbPromptBlock: "",
    validationFeedbackBlock: "",
    referencePromptBlock: "",
  };
}

function joinBlock(parts: string[]): string {
  return parts.filter((part) => part.length > 0).join("\n");
}
```

Change the translation user prompt builder shape to:

```ts
function buildTranslationUserPromptWithSections(
  params: UserPromptBuildParams,
): { userPrompt: string; sections: TextPromptSections } {
  const sections = buildEmptyTextPromptSections();
  const userParts: string[] = [];

  sections.sourceBlock = joinBlock([
    buildTranslationSourceHeader(params.srcLang, params.hasProtectedMarkers),
    params.sourcePayload,
  ]);
  userParts.push(sections.sourceBlock);

  const contextText =
    typeof params.context === "string" ? params.context.trim() : "";
  if (contextText) {
    sections.contextBlock = renderTemplate(TRANSLATION_PROMPTS.contextLine, {
      context: contextText,
    });
    userParts.push("", sections.contextBlock);
  }

  const currentTranslationText =
    typeof params.currentTranslationPayload === "string"
      ? params.currentTranslationPayload.trim()
      : "";
  const refinementInstructionText =
    typeof params.refinementInstruction === "string"
      ? params.refinementInstruction.trim()
      : "";
  if (currentTranslationText && refinementInstructionText) {
    sections.currentTranslationBlock = joinBlock([
      TRANSLATION_PROMPTS.currentTranslationLabel,
      currentTranslationText,
      "",
      TRANSLATION_PROMPTS.refinementInstructionLabel,
      refinementInstructionText,
    ]);
    userParts.push("", sections.currentTranslationBlock);
  }

  const tmReferences = normalizeTMReferences(
    params.tmReferences,
    params.tmReference,
  );
  const tbReferences = params.tbReferences ?? [];
  const concordanceReferences = getRenderableConcordanceReferences({
    tmReferenceCount: tmReferences.length,
    tbReferenceCount: tbReferences.length,
    concordanceReferences: params.concordanceReferences,
  });

  if (tmReferences.length > 0) {
    const tmParts = [TRANSLATION_PROMPTS.tmHeader];
    for (const reference of tmReferences) {
      tmParts.push(
        renderTemplate(TRANSLATION_PROMPTS.tmEntrySummary, {
          similarity: reference.similarity,
          tmName: reference.tmName,
        }),
        renderTemplate(TRANSLATION_PROMPTS.tmEntrySource, {
          sourceText: reference.sourceText,
        }),
        renderTemplate(TRANSLATION_PROMPTS.tmEntryTarget, {
          targetText: reference.targetText,
        }),
      );
    }
    sections.tmPromptBlock = joinBlock(tmParts);
    userParts.push("", sections.tmPromptBlock);
  }

  if (concordanceReferences.length > 0) {
    const concordanceParts = [TRANSLATION_PROMPTS.concordanceHeader];
    for (const reference of concordanceReferences) {
      concordanceParts.push(
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
    sections.concordancePromptBlock = joinBlock(concordanceParts);
    userParts.push("", sections.concordancePromptBlock);
  }

  if (tbReferences.length > 0) {
    const tbParts = [TRANSLATION_PROMPTS.tbHeader];
    for (const reference of tbReferences) {
      const note =
        typeof reference.note === "string" ? reference.note.trim() : "";
      const noteSuffix = note ? ` (note: ${note})` : "";
      tbParts.push(
        renderTemplate(TRANSLATION_PROMPTS.tbEntry, {
          srcTerm: reference.srcTerm,
          tgtTerm: reference.tgtTerm,
          noteSuffix,
        }),
      );
    }
    sections.tbPromptBlock = joinBlock(tbParts);
    userParts.push("", sections.tbPromptBlock);
  }

  sections.referencePromptBlock = joinBlock([
    sections.tmPromptBlock,
    sections.concordancePromptBlock,
    sections.tbPromptBlock,
  ]);

  if (params.validationFeedback) {
    sections.validationFeedbackBlock = joinBlock([
      TRANSLATION_PROMPTS.validationFeedbackHeader,
      params.validationFeedback,
    ]);
    userParts.push("", sections.validationFeedbackBlock);
  }

  return {
    userPrompt: userParts.join("\n"),
    sections,
  };
}
```

Then update `buildAIUserPrompt` or `buildAITextPromptBundle` so translation mode uses `buildTranslationUserPromptWithSections`.
For review/custom modes, return the existing user prompt and `buildEmptyTextPromptSections()` with `sourceBlock` populated if practical. The important first-slice requirement is exact section visibility for translation mode.

- [ ] **Step 5: Keep AITextTranslator behavior unchanged**

Inspect `apps/desktop/src/main/services/modules/ai/AITextTranslator.ts`.
No behavior change should be needed if it reads only:

```ts
promptBundle.systemPrompt;
promptBundle.userPrompt;
promptBundle.sourcePayload;
```

If TypeScript errors occur due to return type annotations, adjust imports/types only; do not change provider request payload behavior.

- [ ] **Step 6: Run core prompt tests**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts packages/core/src/project/aiPromptTemplateCatalog.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run desktop AI translator tests**

Run:

```bash
npx vitest run apps/desktop/src/main/services/modules/ai/AITranslationWorkflows.test.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/project/aiPromptTypes.ts packages/core/src/project/aiPromptTemplates.ts packages/core/src/project/index.test.ts apps/desktop/src/main/services/modules/ai/AITextTranslator.ts
git commit -m "feat: expose AI prompt composition sections"
```

## Task 5: MTModule and LocalizationEngine Refactor

**Files:**

- Create: `apps/desktop/src/main/localization/modules/MTModule.ts`
- Create: `apps/desktop/src/main/localization/modules/MTModule.test.ts`
- Modify: `apps/desktop/src/main/localization/LocalizationEngine.ts`
- Modify: `apps/desktop/src/main/localization/LocalizationEngine.test.ts`

- [ ] **Step 1: Write MTModule tests**

Create `apps/desktop/src/main/localization/modules/MTModule.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { CATDatabase } from "../../../../../../packages/db/src";
import { SqliteSettingsRepository } from "../../services/adapters/SqliteSettingsRepository";
import { AIProviderCatalogService } from "../../services/modules/ai/AIProviderCatalogService";
import { DefaultAIRuntimeConfigProvider } from "../../services/modules/ai/AIRuntimeConfigService";
import type { AITransport } from "../../services/ports";
import { createTransientSegment } from "../transientSegment";
import type { TBArtifact, TMArtifact } from "../artifacts";
import { MTModule } from "./MTModule";

function createTransport(): AITransport {
  return {
    testConnection: vi.fn(),
    createResponse: vi.fn().mockResolvedValue({
      content: "Bonjour",
      status: 200,
      endpoint: "/mock",
    }),
  } as unknown as AITransport;
}

function emptyTMArtifact(unitId: string, segmentId: string): TMArtifact {
  return {
    unitId,
    segmentId,
    mountedTMs: [],
    rawMatches: [],
    selectedReferences: { tmReferences: [], concordanceReferences: [] },
    selectionPolicy: { maxTmReferences: 3, maxConcordanceReferences: 3 },
    diagnostics: [],
  };
}

function emptyTBArtifact(unitId: string, segmentId: string): TBArtifact {
  return {
    unitId,
    segmentId,
    mountedTBs: [],
    rawMatches: [],
    selectedReferences: [],
    selectionPolicy: { maxTbReferences: 100 },
    diagnostics: [],
  };
}

describe("MTModule", () => {
  it("composes prompt artifacts from structured TM and TB artifacts without sending requests", async () => {
    const db = new CATDatabase(":memory:");
    try {
      db.setSetting("openai_api_key", "test-key");
      const transport = createTransport();
      const providerCatalog = new AIProviderCatalogService(
        new SqliteSettingsRepository(db),
        transport,
      );
      const module = new MTModule({
        providerCatalogService: providerCatalog,
        aiRuntimeConfigProvider: new DefaultAIRuntimeConfigProvider(),
        aiTransport: transport,
      });
      const segment = createTransientSegment(
        { id: "row-2", source: "Hello world" },
        0,
      );
      const tm = emptyTMArtifact("row-2", segment.segmentId);
      tm.selectedReferences.tmReferences = [
        {
          similarity: 100,
          tmName: "Main TM",
          sourceText: "Hello world",
          targetText: "Bonjour le monde",
        },
      ];
      const tb = emptyTBArtifact("row-2", segment.segmentId);
      tb.selectedReferences = [
        { srcTerm: "world", tgtTerm: "monde", note: null },
      ];

      const artifact = await module.composePrompt({
        unitId: "row-2",
        project: {
          id: 1,
          uuid: "project-1",
          name: "Demo",
          srcLang: "en",
          tgtLang: "fr",
          projectType: "translation",
          aiPrompt: "Project style.",
          aiModel: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        segment,
        tm,
        tb,
      });

      expect(artifact.tmPromptBlock).toContain("Main TM");
      expect(artifact.tbPromptBlock).toContain("world");
      expect(artifact.userPrompt).toContain(artifact.tmPromptBlock);
      expect(artifact.userPrompt).toContain(artifact.tbPromptBlock);
      expect(artifact.promptChars.total).toBe(
        artifact.promptChars.system + artifact.promptChars.user,
      );
      expect(transport.createResponse).not.toHaveBeenCalled();
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Run MTModule test to verify it fails**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/MTModule.test.ts
```

Expected: FAIL because `MTModule.ts` does not exist.

- [ ] **Step 3: Implement MTModule**

Create `apps/desktop/src/main/localization/modules/MTModule.ts`:

```ts
import type { Segment, Token } from "@cat/core/models";
import { TagValidator } from "@cat/core/qa";
import { serializeTokensToEditorText } from "@cat/core/tag";
import { serializeTokensToDisplayText } from "@cat/core/text";
import {
  buildAITextPromptBundle,
  normalizeProjectType,
  type Project,
} from "@cat/core/project";
import type { PromptArtifact, TBArtifact, TMArtifact } from "../artifacts";
import type {
  AIRuntimeConfigProvider,
  AITransport,
  ReasoningEffort,
} from "../../services/ports";
import { AIProviderCatalogService } from "../../services/modules/ai/AIProviderCatalogService";
import { AITextTranslator } from "../../services/modules/ai/AITextTranslator";

export interface MTModuleDeps {
  providerCatalogService: AIProviderCatalogService;
  aiRuntimeConfigProvider: AIRuntimeConfigProvider;
  aiTransport: AITransport;
}

export interface ComposePromptInput {
  unitId: string;
  project: Project;
  segment: Segment;
  tm: TMArtifact;
  tb: TBArtifact;
  providerOverride?: string | null;
  modelOverride?: string;
  reasoningEffortOverride?: ReasoningEffort;
  projectPromptOverride?: string;
}

export interface TranslatePreparedInput extends ComposePromptInput {
  apiKey?: string;
}

export class MTModule {
  private readonly textTranslator: AITextTranslator;

  constructor(private readonly deps: MTModuleDeps) {
    this.textTranslator = new AITextTranslator(
      deps.aiTransport,
      new TagValidator(),
    );
  }

  public async composePrompt(
    input: ComposePromptInput,
  ): Promise<PromptArtifact> {
    const { provider, runtimeConfig } = await this.resolveRuntime(input);
    const projectType = normalizeProjectType(
      input.project.projectType ?? "translation",
    );
    const sourceText = serializeTokensToDisplayText(input.segment.sourceTokens);
    const sourceTagPreservedText = serializeTokensToEditorText(
      input.segment.sourceTokens,
      input.segment.sourceTokens,
    );
    const context = input.segment.meta?.context
      ? String(input.segment.meta.context).trim()
      : "";
    const bundle = buildAITextPromptBundle(projectType, {
      srcLang: input.project.srcLang,
      tgtLang: input.project.tgtLang,
      projectPrompt:
        input.projectPromptOverride ?? input.project.aiPrompt ?? "",
      sourceText,
      sourceTagPreservedText,
      context,
      tmReferences: input.tm.selectedReferences.tmReferences,
      concordanceReferences: input.tm.selectedReferences.concordanceReferences,
      tbReferences: input.tb.selectedReferences,
    });

    return {
      unitId: input.unitId,
      provider: {
        id: provider.id,
        name: provider.name,
        baseUrl: provider.baseUrl,
      },
      model: input.modelOverride ?? provider.model,
      reasoningEffort:
        input.reasoningEffortOverride ?? runtimeConfig.reasoningEffort,
      projectPrompt:
        input.projectPromptOverride ?? input.project.aiPrompt ?? "",
      projectType,
      sourcePayload: bundle.sourcePayload,
      tmPromptBlock: bundle.sections.tmPromptBlock,
      tbPromptBlock: bundle.sections.tbPromptBlock,
      systemPrompt: bundle.systemPrompt,
      userPrompt: bundle.userPrompt,
      promptChars: {
        system: bundle.systemPrompt.length,
        user: bundle.userPrompt.length,
        total: bundle.systemPrompt.length + bundle.userPrompt.length,
      },
    };
  }

  public async translate(input: TranslatePreparedInput): Promise<Token[]> {
    const { provider, apiKey, runtimeConfig } =
      await this.resolveRuntime(input);
    const projectType = normalizeProjectType(
      input.project.projectType ?? "translation",
    );
    const sourceText = serializeTokensToDisplayText(input.segment.sourceTokens);
    const sourceTagPreservedText = serializeTokensToEditorText(
      input.segment.sourceTokens,
      input.segment.sourceTokens,
    );
    const context = input.segment.meta?.context
      ? String(input.segment.meta.context).trim()
      : "";

    return this.textTranslator.translateSegment({
      segmentId: input.segment.segmentId,
      apiKey,
      baseUrl: provider.baseUrl,
      model: input.modelOverride ?? provider.model,
      projectPrompt:
        input.projectPromptOverride ?? input.project.aiPrompt ?? "",
      projectType,
      reasoningEffort:
        input.reasoningEffortOverride ?? runtimeConfig.reasoningEffort,
      srcLang: input.project.srcLang,
      tgtLang: input.project.tgtLang,
      sourceTokens: input.segment.sourceTokens,
      sourceText,
      sourceTagPreservedText,
      context,
      tmReferences: input.tm.selectedReferences.tmReferences,
      concordanceReferences: input.tm.selectedReferences.concordanceReferences,
      tbReferences: input.tb.selectedReferences,
    });
  }

  private async resolveRuntime(input: ComposePromptInput): Promise<{
    provider: ReturnType<AIProviderCatalogService["listProviders"]>[number];
    apiKey: string;
    runtimeConfig: Awaited<
      ReturnType<AIRuntimeConfigProvider["getModelConfig"]>
    >;
  }> {
    const { provider, apiKey } =
      this.deps.providerCatalogService.resolveProviderConfig(
        input.providerOverride ?? input.project.aiModel,
      );
    const model = input.modelOverride ?? provider.model;
    return {
      provider,
      apiKey,
      runtimeConfig:
        await this.deps.aiRuntimeConfigProvider.getModelConfig(model),
    };
  }
}
```

- [ ] **Step 4: Refactor LocalizationEngine to use TM/TB/MT modules**

Modify `apps/desktop/src/main/localization/LocalizationEngine.ts`:

- Create `TMModule`, `TBModule`, and `MTModule` in the constructor after repositories are created.
- Replace private `resolveReferences()` and `translatePreparedUnit()` reference construction with:

```ts
const tmArtifact =
  projectType === "translation"
    ? await this.tmModule.inspect(params.project.id, params.segment)
    : emptyTMArtifact(params.unit.id, params.segment.segmentId);
const tbArtifact =
  projectType === "translation"
    ? await this.tbModule.inspect(params.project.id, params.segment)
    : emptyTBArtifact(params.unit.id, params.segment.segmentId);
const targetTokens = await this.mtModule.translate({
  unitId: params.unit.id,
  project: params.project,
  segment: params.segment,
  tm: tmArtifact,
  tb: tbArtifact,
  providerOverride: params.providerOverride,
  modelOverride: params.modelOverride,
  reasoningEffortOverride: params.reasoningEffortOverride,
  projectPromptOverride: params.systemPrompt,
});
```

- Keep existing public behavior:
  - skip-only batches do not require provider setup
  - dialogue mode fails clearly
  - per-unit provider failures become failed unit results
  - no file/segment records are created

Use small local helper functions for empty TM/TB artifacts if needed.

- [ ] **Step 5: Run MTModule and engine tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/modules/MTModule.test.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all localization tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization
```

Expected: PASS.

- [ ] **Step 7: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add apps/desktop/src/main/localization/modules/MTModule.ts apps/desktop/src/main/localization/modules/MTModule.test.ts apps/desktop/src/main/localization/LocalizationEngine.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts
git commit -m "feat: add localization MT module"
```

## Task 6: LocalizationInspector and Writers

**Files:**

- Create: `apps/desktop/src/main/localization/LocalizationInspector.ts`
- Create: `apps/desktop/src/main/localization/LocalizationInspector.test.ts`
- Modify: `apps/desktop/src/main/localization/index.ts`

- [ ] **Step 1: Write inspector integration tests**

Create `apps/desktop/src/main/localization/LocalizationInspector.test.ts`:

```ts
import { mkdtemp, readFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import * as XLSX from "xlsx";
import { describe, expect, it, vi } from "vitest";
import { CATDatabase } from "../../../../../packages/db/src";
import type { AITransport } from "../services/ports";
import { LocalizationInspector } from "./LocalizationInspector";

function createTransport(): AITransport {
  return {
    testConnection: vi.fn(),
    createResponse: vi.fn(),
  } as unknown as AITransport;
}

describe("LocalizationInspector", () => {
  it("writes xlsx and json artifacts without creating files or calling the provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-localization-inspect-"));
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("Inspect Project", "en", "fr");
      db.setSetting("openai_api_key", "test-key");
      const inputPath = join(root, "mt.xlsx");
      const outputPath = join(root, "mt.inspect.xlsx");
      const jsonOutputPath = join(root, "mt.inspect.json");
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["source", "target"],
          ["Hello world", ""],
          ["", ""],
        ]),
        "Sheet2",
      );
      XLSX.writeFile(workbook, inputPath);
      const beforeFiles = db.listFiles(projectId);
      const transport = createTransport();
      const inspector = new LocalizationInspector(db, {
        dbPath: ":memory:",
        aiTransport: transport,
      });

      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath,
        jsonOutputPath,
        maxCellChars: 30000,
      });

      expect(result.artifact.units).toHaveLength(1);
      expect(result.summary).toEqual({ total: 1, ready: 1, error: 0 });
      expect(transport.createResponse).not.toHaveBeenCalled();
      expect(db.listFiles(projectId)).toEqual(beforeFiles);

      const inspectWorkbook = XLSX.read(await readFile(outputPath), {
        type: "buffer",
      });
      expect(inspectWorkbook.SheetNames).toEqual([
        "Segments",
        "MT_SystemPrompt",
      ]);
      const rows = XLSX.utils.sheet_to_json(inspectWorkbook.Sheets.Segments, {
        header: 1,
        defval: "",
      }) as string[][];
      expect(rows[0].slice(-5)).toEqual([
        "_tm_for_mt",
        "_tb_for_mt",
        "_mt_user_prompt",
        "_inspect_status",
        "_inspect_json_ref",
      ]);
      expect(rows[1][rows[1].length - 2]).toBe("ready");
      expect(rows[2][rows[2].length - 2]).toBe("skipped-empty-source");

      const json = JSON.parse(await readFile(jsonOutputPath, "utf8"));
      expect(json.version).toBe(1);
      expect(json.units[0].mt.userPrompt).toContain("Hello world");
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("truncates xlsx cells while preserving full prompt in json", async () => {
    const root = await mkdtemp(join(tmpdir(), "cat-localization-inspect-"));
    const db = new CATDatabase(":memory:");
    try {
      const projectId = db.createProject("Inspect Truncate", "en", "fr");
      db.setSetting("openai_api_key", "test-key");
      const inputPath = join(root, "mt.xlsx");
      const outputPath = join(root, "mt.inspect.xlsx");
      const jsonOutputPath = join(root, "mt.inspect.json");
      const longSource = "Hello ".repeat(100);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ["source", "target"],
          [longSource, ""],
        ]),
        "Sheet1",
      );
      XLSX.writeFile(workbook, inputPath);

      const inspector = new LocalizationInspector(db, {
        dbPath: ":memory:",
        aiTransport: createTransport(),
      });
      await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath,
        jsonOutputPath,
        maxCellChars: 80,
      });

      const inspectWorkbook = XLSX.read(await readFile(outputPath), {
        type: "buffer",
      });
      const rows = XLSX.utils.sheet_to_json(inspectWorkbook.Sheets.Segments, {
        header: 1,
        defval: "",
      }) as string[][];
      const userPromptCell = rows[1][rows[0].indexOf("_mt_user_prompt")];
      expect(userPromptCell).toContain("[TRUNCATED: see");
      const json = JSON.parse(await readFile(jsonOutputPath, "utf8"));
      expect(json.units[0].mt.userPrompt.length).toBeGreaterThan(80);
      expect(json.units[0].xlsx.truncated.mtUserPrompt).toBe(true);
    } finally {
      db.close();
      await rm(root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run inspector tests to verify they fail**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/LocalizationInspector.test.ts
```

Expected: FAIL because `LocalizationInspector.ts` does not exist.

- [ ] **Step 3: Implement LocalizationInspector**

Create `apps/desktop/src/main/localization/LocalizationInspector.ts`:

```ts
import { writeFile } from "fs/promises";
import type { CATDatabase } from "@cat/db";
import type { Project } from "@cat/core/project";
import { SqliteProjectRepository } from "../services/adapters/SqliteProjectRepository";
import { SqliteSettingsRepository } from "../services/adapters/SqliteSettingsRepository";
import { SqliteTBRepository } from "../services/adapters/SqliteTBRepository";
import { SqliteTMRepository } from "../services/adapters/SqliteTMRepository";
import { AIProviderCatalogService } from "../services/modules/ai/AIProviderCatalogService";
import { DefaultAIRuntimeConfigProvider } from "../services/modules/ai/AIRuntimeConfigService";
import { AIProviderTransport } from "../services/providers/AIProviderTransport";
import { TBService } from "../services/TBService";
import { TMService } from "../services/TMService";
import type { AIRuntimeConfigProvider, AITransport } from "../services/ports";
import type { InspectArtifact, InspectUnitArtifact } from "./artifacts";
import {
  parseExternalSpreadsheet,
  writeInspectSpreadsheet,
} from "./modules/FileModule";
import { MTModule } from "./modules/MTModule";
import { TBModule } from "./modules/TBModule";
import { TMModule } from "./modules/TMModule";
import { createTransientSegment } from "./transientSegment";
import type { TranslateFileInput } from "./types";

export interface LocalizationInspectorOptions {
  dbPath: string;
  aiTransport?: AITransport;
  aiRuntimeConfigProvider?: AIRuntimeConfigProvider;
}

export interface InspectFileInput extends TranslateFileInput {
  jsonOutputPath?: string;
  unitLimit?: number;
  maxCellChars?: number;
}

export interface InspectFileResult {
  artifact: InspectArtifact;
  outputPath: string;
  jsonOutputPath: string;
  summary: {
    total: number;
    ready: number;
    error: number;
  };
}

const DEFAULT_MAX_CELL_CHARS = 30000;

export class LocalizationInspector {
  private readonly projectRepo: SqliteProjectRepository;
  private readonly tmModule: TMModule;
  private readonly tbModule: TBModule;
  private readonly mtModule: MTModule;

  constructor(db: CATDatabase, options: LocalizationInspectorOptions) {
    this.projectRepo = new SqliteProjectRepository(db);
    const settingsRepo = new SqliteSettingsRepository(db);
    const tmRepo = new SqliteTMRepository(db);
    const tbRepo = new SqliteTBRepository(db);
    const aiTransport = options.aiTransport ?? new AIProviderTransport();
    this.tmModule = new TMModule(
      tmRepo,
      new TMService(this.projectRepo, tmRepo),
    );
    this.tbModule = new TBModule(
      tbRepo,
      new TBService(this.projectRepo, tbRepo),
    );
    this.mtModule = new MTModule({
      providerCatalogService: new AIProviderCatalogService(
        settingsRepo,
        aiTransport,
      ),
      aiRuntimeConfigProvider:
        options.aiRuntimeConfigProvider ?? new DefaultAIRuntimeConfigProvider(),
      aiTransport,
    });
  }

  public async inspectFile(
    input: InspectFileInput,
  ): Promise<InspectFileResult> {
    const project = this.projectRepo.getProject(input.projectId);
    if (!project) throw new Error(`Project not found: ${input.projectId}`);
    if (input.options?.mode === "dialogue") {
      throw new Error(
        "Dialogue mode is not supported for localization inspection.",
      );
    }

    const parsed = await parseExternalSpreadsheet(input);
    const maxCellChars = input.maxCellChars ?? DEFAULT_MAX_CELL_CHARS;
    const sourceRows = parsed.artifact.rows.filter((row) => row.source.trim());
    const limitedRows =
      input.unitLimit === undefined
        ? sourceRows
        : sourceRows.slice(0, input.unitLimit);
    const units: InspectUnitArtifact[] = [];

    for (const row of limitedRows) {
      units.push(
        await this.inspectRow(
          project,
          row,
          parsed.artifact.rows.indexOf(row),
          maxCellChars,
        ),
      );
    }

    const firstSystemPrompt = units[0]?.mt.systemPrompt ?? "";
    const systemPromptXlsx = truncateForXlsx(
      firstSystemPrompt,
      maxCellChars,
      "#/systemPrompt/value",
    );
    const artifact: InspectArtifact = {
      version: 1,
      generatedAt: new Date().toISOString(),
      project: {
        id: project.id,
        name: project.name,
        srcLang: project.srcLang,
        tgtLang: project.tgtLang,
        projectType: project.projectType ?? "translation",
        promptChars: project.aiPrompt?.length ?? 0,
      },
      inputFile: parsed.artifact,
      systemPrompt: {
        value: firstSystemPrompt,
        promptChars: firstSystemPrompt.length,
        xlsxValue: systemPromptXlsx.value,
        truncated: systemPromptXlsx.truncated,
      },
      units,
    };
    const jsonOutputPath =
      input.jsonOutputPath ?? inferJsonOutputPath(input.outputPath);
    await writeInspectSpreadsheet(parsed, artifact, input.outputPath);
    await writeFile(
      jsonOutputPath,
      `${JSON.stringify(artifact, null, 2)}\n`,
      "utf8",
    );

    return {
      artifact,
      outputPath: input.outputPath,
      jsonOutputPath,
      summary: {
        total: units.length,
        ready: units.filter((unit) => unit.status === "ready").length,
        error: units.filter((unit) => unit.status === "error").length,
      },
    };
  }

  private async inspectRow(
    project: Project,
    row: InspectArtifact["inputFile"]["rows"][number],
    orderIndex: number,
    maxCellChars: number,
  ): Promise<InspectUnitArtifact> {
    const segment = createTransientSegment(
      {
        id: row.unitId,
        source: row.source,
        target: row.target,
        context: row.context,
        metadata: { rowIndex: row.rowIndex, rowNumber: row.rowNumber },
      },
      orderIndex,
      {
        projectId: project.id,
        sourceLanguage: project.srcLang,
        targetLanguage: project.tgtLang,
      },
    );
    try {
      const tm = await this.tmModule.inspect(project.id, segment);
      const tb = await this.tbModule.inspect(project.id, segment);
      const mt = await this.mtModule.composePrompt({
        unitId: row.unitId,
        project,
        segment,
        tm,
        tb,
      });
      const tmForMt = truncateForXlsx(
        mt.tmPromptBlock,
        maxCellChars,
        `#/units/${row.unitId}/mt/tmPromptBlock`,
      );
      const tbForMt = truncateForXlsx(
        mt.tbPromptBlock,
        maxCellChars,
        `#/units/${row.unitId}/mt/tbPromptBlock`,
      );
      const mtUserPrompt = truncateForXlsx(
        mt.userPrompt,
        maxCellChars,
        `#/units/${row.unitId}/mt/userPrompt`,
      );

      return {
        unit: row,
        transientSegment: {
          segmentId: segment.segmentId,
          matchKey: segment.matchKey,
          srcHash: segment.srcHash,
          tagsSignature: segment.tagsSignature,
        },
        tm,
        tb,
        mt,
        xlsx: {
          tmForMt: tmForMt.value,
          tbForMt: tbForMt.value,
          mtUserPrompt: mtUserPrompt.value,
          truncated: {
            tmForMt: tmForMt.truncated,
            tbForMt: tbForMt.truncated,
            mtUserPrompt: mtUserPrompt.truncated,
          },
        },
        status: "ready",
      };
    } catch (error) {
      throw error;
    }
  }
}

function truncateForXlsx(
  value: string,
  maxCellChars: number,
  jsonRef: string,
): { value: string; truncated: boolean } {
  if (value.length <= maxCellChars) {
    return { value, truncated: false };
  }
  const marker = `[TRUNCATED: see ${jsonRef}]`;
  const sliceLength = Math.max(0, maxCellChars - marker.length - 1);
  return {
    value: `${value.slice(0, sliceLength)}\n${marker}`,
    truncated: true,
  };
}

function inferJsonOutputPath(outputPath: string): string {
  return outputPath.replace(/\.[^.\\/]+$/, ".json");
}
```

If TypeScript rejects `row` type references, import `FileParseRowArtifact` from `./artifacts` and use that type directly.

- [ ] **Step 4: Export inspector**

Modify `apps/desktop/src/main/localization/index.ts`:

```ts
export * from "./LocalizationEngine";
export * from "./LocalizationInspector";
export * from "./types";
export * from "./artifacts";
```

- [ ] **Step 5: Run inspector tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization/LocalizationInspector.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run all localization tests**

Run:

```bash
npx vitest run apps/desktop/src/main/localization
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/localization/LocalizationInspector.ts apps/desktop/src/main/localization/LocalizationInspector.test.ts apps/desktop/src/main/localization/index.ts
git commit -m "feat: add localization inspector"
```

## Task 7: Inspect CLI

**Files:**

- Create: `apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts`
- Create: `scripts/inspect-localization.mjs`
- Create: `scripts/inspect-localization.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Write dynamic CLI runner test**

Create `apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CATDatabase } from "../../../../../packages/db/src";
import { LocalizationInspector } from "./LocalizationInspector";

const runDynamic = process.env.LOCALIZATION_INSPECT_DYNAMIC === "1";
const maybeIt = runDynamic ? it : it.skip;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function readOptionalPositiveInt(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

describe("LocalizationInspector CLI runner", () => {
  maybeIt("localization-inspect-env-run", async () => {
    const dbPath = requireEnv("LOCALIZATION_INSPECT_DB_PATH");
    const projectId = Number(requireEnv("LOCALIZATION_INSPECT_PROJECT_ID"));
    const inputPath = requireEnv("LOCALIZATION_INSPECT_INPUT_PATH");
    const outputPath = requireEnv("LOCALIZATION_INSPECT_OUTPUT_PATH");
    const jsonOutputPath = process.env.LOCALIZATION_INSPECT_JSON_OUTPUT_PATH;
    const unitLimit = readOptionalPositiveInt(
      "LOCALIZATION_INSPECT_UNIT_LIMIT",
    );
    const maxCellChars = readOptionalPositiveInt(
      "LOCALIZATION_INSPECT_MAX_CELL_CHARS",
    );
    const db = new CATDatabase(dbPath);

    try {
      const inspector = new LocalizationInspector(db, { dbPath });
      const result = await inspector.inspectFile({
        projectId,
        inputPath,
        outputPath,
        jsonOutputPath,
        unitLimit,
        maxCellChars,
      });

      console.log(
        JSON.stringify({
          event: "localization_inspect_complete",
          inputPath,
          outputPath,
          jsonOutputPath: result.jsonOutputPath,
          summary: result.summary,
        }),
      );

      expect(result.summary.total).toBeGreaterThan(0);
      expect(result.summary.error).toBe(0);
    } finally {
      db.close();
    }
  });
});
```

- [ ] **Step 2: Write CLI script test**

Create `scripts/inspect-localization.test.mjs`:

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
const scriptPath = path.join(repoRoot, "scripts", "inspect-localization.mjs");

test("inspect localization script exposes help", () => {
  assert.equal(fs.existsSync(scriptPath), true);

  const result = spawnSync(process.execPath, [scriptPath, "--help"], {
    cwd: repoRoot,
    encoding: "utf8",
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /inspect-localization\.mjs/);
  assert.match(result.stdout, /--db <path>/);
  assert.match(result.stdout, /--project-id <id>/);
  assert.match(result.stdout, /--input <path>/);
  assert.match(result.stdout, /--output <path>/);
  assert.match(result.stdout, /--json-output <path>/);
  assert.match(result.stdout, /--unit-limit <n>/);
  assert.match(result.stdout, /--max-cell-chars <n>/);
});
```

- [ ] **Step 3: Run script test to verify it fails**

Run:

```bash
node --test scripts/inspect-localization.test.mjs
```

Expected: FAIL because `scripts/inspect-localization.mjs` does not exist.

- [ ] **Step 4: Implement CLI script**

Create `scripts/inspect-localization.mjs`:

```js
#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const TEST_NAME = "localization-inspect-env-run";
const TEST_PATH =
  "apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts";

function usage() {
  console.log(`Usage:
  node scripts/inspect-localization.mjs --db <path> --project-id <id> --input <path> --output <path> [options]

Options:
  --db <path>                    SQLite DB path.
  --project-id <id>              Project id used as TM+TB+MT engine.
  --input <path>                 External xlsx/csv input file.
  --output <path>                Inspect xlsx output path.
  --json-output <path>           Optional JSON sidecar output path.
  --unit-limit <n>               Inspect only first n source-bearing rows.
  --max-cell-chars <n>           XLSX cell truncation threshold. Default: 30000.
  -h, --help                     Show this help.

Examples:
  npm run inspect:localization -- --db .cat_data/cat_v1.db --project-id 3 --input mt.xlsx --output mt.inspect.xlsx
  npm run inspect:localization -- --db .cat_data/cat_v1.db --project-id 3 --input mt.xlsx --output mt.inspect.xlsx --unit-limit 20`);
}

function readValue(argv, index, flag) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return value;
}

function parseArgs(argv) {
  const config = {
    dbPath: "",
    projectId: "",
    inputPath: "",
    outputPath: "",
    jsonOutputPath: "",
    unitLimit: "",
    maxCellChars: "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--db" || arg === "--db-path") {
      config.dbPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--db=")) {
      config.dbPath = path.resolve(arg.slice("--db=".length));
      continue;
    }
    if (arg === "--project-id") {
      config.projectId = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--project-id=")) {
      config.projectId = arg.slice("--project-id=".length);
      continue;
    }
    if (arg === "--input") {
      config.inputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      config.inputPath = path.resolve(arg.slice("--input=".length));
      continue;
    }
    if (arg === "--output") {
      config.outputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      config.outputPath = path.resolve(arg.slice("--output=".length));
      continue;
    }
    if (arg === "--json-output") {
      config.jsonOutputPath = path.resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--json-output=")) {
      config.jsonOutputPath = path.resolve(arg.slice("--json-output=".length));
      continue;
    }
    if (arg === "--unit-limit") {
      config.unitLimit = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--unit-limit=")) {
      config.unitLimit = arg.slice("--unit-limit=".length);
      continue;
    }
    if (arg === "--max-cell-chars") {
      config.maxCellChars = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--max-cell-chars=")) {
      config.maxCellChars = arg.slice("--max-cell-chars=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!config.dbPath) throw new Error("Missing --db.");
  if (!fs.existsSync(config.dbPath))
    throw new Error(`Database not found: ${config.dbPath}`);
  if (!isPositiveInteger(config.projectId))
    throw new Error("--project-id must be a positive integer.");
  if (!config.inputPath) throw new Error("Missing --input.");
  if (!fs.existsSync(config.inputPath))
    throw new Error(`Input file not found: ${config.inputPath}`);
  if (!config.outputPath) throw new Error("Missing --output.");
  if (config.unitLimit && !isPositiveInteger(config.unitLimit)) {
    throw new Error("--unit-limit must be a positive integer.");
  }
  if (config.maxCellChars && !isPositiveInteger(config.maxCellChars)) {
    throw new Error("--max-cell-chars must be a positive integer.");
  }
  return config;
}

function isPositiveInteger(value) {
  return Number.isInteger(Number(value)) && Number(value) > 0;
}

function runInspect(config) {
  const vitestCmd = path.join(
    process.cwd(),
    "node_modules",
    ".bin",
    process.platform === "win32" ? "vitest.cmd" : "vitest",
  );
  if (!fs.existsSync(vitestCmd)) {
    throw new Error(`Vitest binary not found: ${vitestCmd}`);
  }

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
        LOCALIZATION_INSPECT_DYNAMIC: "1",
        LOCALIZATION_INSPECT_DB_PATH: config.dbPath,
        LOCALIZATION_INSPECT_PROJECT_ID: config.projectId,
        LOCALIZATION_INSPECT_INPUT_PATH: config.inputPath,
        LOCALIZATION_INSPECT_OUTPUT_PATH: config.outputPath,
        LOCALIZATION_INSPECT_JSON_OUTPUT_PATH: config.jsonOutputPath,
        LOCALIZATION_INSPECT_UNIT_LIMIT: config.unitLimit,
        LOCALIZATION_INSPECT_MAX_CELL_CHARS: config.maxCellChars,
      },
    },
  );

  if (result.error) {
    throw new Error(`Failed to start ${vitestCmd}: ${result.error.message}`);
  }
  process.exit(result.status ?? 1);
}

try {
  runInspect(parseArgs(process.argv.slice(2)));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
```

- [ ] **Step 5: Add package script**

Modify `package.json` scripts:

```json
"inspect:localization": "npm run rebuild:test && node scripts/inspect-localization.mjs"
```

Place it near `translate:file`.

- [ ] **Step 6: Run CLI tests and help**

Run:

```bash
node --test scripts/inspect-localization.test.mjs
npm run inspect:localization -- --help
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/desktop/src/main/localization/LocalizationInspector.cli.test.ts scripts/inspect-localization.mjs scripts/inspect-localization.test.mjs package.json
git commit -m "feat: add localization inspect CLI"
```

## Task 8: Docs and Verification

**Files:**

- Modify: `DOCS/00_START_HERE.md`

- [ ] **Step 1: Document inspect command**

Add after the existing external LocalizationEngine file translation section:

```md
LocalizationEngine inspection:

- To inspect a spreadsheet through the project's TM+TB+MT prompt pipeline without calling the AI provider, run `npm run inspect:localization -- --db <path> --project-id <id> --input <path> --output <inspect.xlsx>`.
- The command writes an inspect workbook with a `Segments` sheet and an `MT_SystemPrompt` sheet, plus a JSON sidecar next to the xlsx output.
- The `Segments` sheet preserves original rows and appends `_tm_for_mt`, `_tb_for_mt`, `_mt_user_prompt`, `_inspect_status`, and `_inspect_json_ref`.
- The command does not create project `files` or `segments` records and does not send API requests.
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run packages/core/src/project/index.test.ts packages/core/src/project/aiPromptTemplateCatalog.test.ts
npx vitest run apps/desktop/src/main/localization
node --test scripts/inspect-localization.test.mjs
node --test scripts/translate-file.test.mjs
npm run typecheck --workspace=apps/desktop
node node_modules/prettier/bin/prettier.cjs --check packages/core/src/project apps/desktop/src/main/localization scripts/inspect-localization.mjs scripts/inspect-localization.test.mjs DOCS/00_START_HERE.md package.json
```

Expected: all PASS.

- [ ] **Step 3: Run no-request real smoke**

Before smoke, inspect project files:

```bash
npm run inspect:projects -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3
```

Run inspector:

```bash
npm run inspect:localization -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.inspect.xlsx" --unit-limit 14
```

Inspect project files again:

```bash
npm run inspect:projects -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3
```

Expected:

- `mt.inspect.xlsx` exists.
- `mt.inspect.json` exists.
- Project 3 file list is unchanged before and after.
- No API request is made.
- `Segments` sheet contains appended inspect columns.
- `MT_SystemPrompt` sheet exists.

- [ ] **Step 4: Commit docs and smoke fixes**

```bash
git add DOCS/00_START_HERE.md packages/core/src/project apps/desktop/src/main/localization scripts/inspect-localization.mjs scripts/inspect-localization.test.mjs package.json
git commit -m "docs: document localization inspection"
```

## Plan Self-Review

Spec coverage:

- Orthogonal File/TM/TB/MT modules are implemented in Tasks 2, 3, 5, and 6.
- PromptComposer visibility is implemented by exposing prompt sections from the shared core prompt builder in Task 4.
- Inspector xlsx/json output is implemented in Task 6.
- CLI is implemented in Task 7.
- No-write/no-request guarantees are tested in Task 6 and verified in Task 8.
- Truncation policy is tested in Task 6.

Gap scan:

- The plan uses concrete tasks, file paths, commands, and expected results.
- Each task lists concrete files, commands, expected results, and code-level direction.

Type consistency:

- `FileParseArtifact`, `TMArtifact`, `TBArtifact`, `PromptArtifact`, and `InspectArtifact` are defined in Task 1 and reused by later tasks.
- `TMModule.inspect`, `TBModule.inspect`, and `MTModule.composePrompt` names are consistent across tasks.
- CLI environment variable names use the `LOCALIZATION_INSPECT_*` prefix consistently.
