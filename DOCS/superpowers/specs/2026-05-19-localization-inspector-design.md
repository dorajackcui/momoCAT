# Localization Inspector Design

## Goal

Build a transparent, no-request inspection pipeline for the agent-first localization engine.
Given an external spreadsheet and a project, the inspector should show what the engine would use at each internal stage before any API call:

- the parsed file rows and unit identities
- the TM references selected for MT
- the TB references selected for MT
- the MT prompt blocks and final user prompt
- the shared system prompt/provider/model metadata

The inspector must make the internals observable without turning inspect logic into a second, divergent translation pipeline.

## Core Principle: Orthogonal Modules

The localization modules must stay orthogonal. Each module owns one kind of business logic and communicates through structured artifacts.

```text
FileModule
  -> external file structure and row/unit mapping

TMModule
  -> TM retrieval, scoring, filtering, selected structured references

TBModule
  -> TB retrieval, term matching, filtering, selected structured references

MTModule
  -> prompt composition, request scheduling, provider requests

LocalizationInspector
  -> calls the same modules and writes artifacts to xlsx/json
```

The key boundaries are:

- TMModule does not know how prompts are written.
- TBModule does not know how prompts are written.
- PromptComposer does not query TM/TB; it consumes structured TM/TB artifacts.
- RequestScheduler does not know prompt structure or TM/TB rules.
- ProviderClient only sends prepared request payloads.
- Inspector does not implement TM, TB, prompt, or request business logic. It only records artifacts produced by the real modules.

This matters because MT prompt orchestration and request mode may be heavily redesigned later. Those changes should stay inside MTModule and should not require changing TMModule, TBModule, or FileModule.

## Selected Approach

Use the large-refactor path:

1. Split the current LocalizationEngine internals into FileModule, TMModule, TBModule, and MTModule.
2. Extract prompt construction from AITextTranslator into MTModule/PromptComposer.
3. Make translation and inspection share the same artifacts.
4. Add LocalizationInspector and an `inspect:localization` CLI that writes xlsx and JSON sidecar outputs.

This is intentionally more structural than a quick CLI script. The branch is already dedicated to an agent-first refactor, and this inspect feature should become the debugging surface for future TM/TB/MT changes.

## Module Responsibilities

### FileModule

FileModule owns external spreadsheet structure.

Responsibilities:

- read xlsx/csv input without importing it into the project DB
- detect source/target/context columns
- preserve the original sheet rows and cells
- produce `LocalizationUnit[]` plus stable row mappings
- write translated output files
- write inspect xlsx files with appended columns

Non-responsibilities:

- TM lookup
- TB lookup
- prompt composition
- provider requests

First implementation slice mirrors the current external file adapter behavior: inspect the first worksheet. The module boundary should make multi-sheet support an additive FileModule change later.

### TMModule

TMModule owns translation memory behavior.

Responsibilities:

- read mounted TMs for a project
- compute TM and concordance matches for a transient segment
- apply selection limits and ranking policy for MT
- output structured `TMArtifact`

Non-responsibilities:

- formatting TM references as prompt text
- formatting xlsx display strings
- calling MT providers

`TMArtifact.selectedReferences` is the only TM input PromptComposer should need for MT prompt construction.

### TBModule

TBModule owns term base behavior.

Responsibilities:

- read mounted TBs for a project
- find matching terms and positions for a transient segment
- apply selection limits and ordering policy for MT
- output structured `TBArtifact`

Non-responsibilities:

- formatting TB references as prompt text
- formatting xlsx display strings
- calling MT providers

`TBArtifact.selectedReferences` is the only TB input PromptComposer should need for MT prompt construction.

### MTModule

MTModule owns all MT-specific behavior.

Subcomponents:

- `PromptComposer`: builds prompt artifacts from project config, source unit, context, TM artifact, and TB artifact.
- `RequestScheduler`: schedules request work and controls concurrency/order/failure policy.
- `ProviderClient`: sends request payloads to the configured provider.

Responsibilities:

- resolve provider/model/runtime config
- build prompt blocks and full prompt payload
- optionally send requests for real translation
- preserve the separation between prompt composition and provider transport

Non-responsibilities:

- file parsing
- TM lookup
- TB lookup

For inspection, only `PromptComposer` is used. No provider request is sent.

### LocalizationInspector

LocalizationInspector orchestrates artifact capture.

Responsibilities:

- call FileModule to parse external input
- create transient segments
- call TMModule and TBModule
- call MTModule.composePrompt
- write inspect xlsx and JSON sidecar
- avoid DB writes and provider calls

Non-responsibilities:

- owning TM/TB/MT business rules
- duplicating prompt formatting logic

## Artifact Model

### FileParseArtifact

```ts
interface FileParseArtifact {
  inputPath: string;
  sheetName: string;
  columns: {
    sourceCol: number;
    targetCol: number;
    contextCol?: number;
    hasHeader: boolean;
  };
  rows: FileParseRowArtifact[];
}

interface FileParseRowArtifact {
  rowIndex: number;
  rowNumber: number;
  unitId: string;
  source: string;
  target: string;
  context?: string;
  originalCells: Array<string | number | boolean | null>;
}
```

### TMArtifact

```ts
interface TMArtifact {
  unitId: string;
  segmentId: string;
  mountedTMs: MountedTMArtifact[];
  rawMatches: TMMatchArtifact[];
  selectedReferences: PromptTMReferenceArtifact[];
  selectionPolicy: {
    maxTmReferences: number;
    maxConcordanceReferences: number;
  };
  diagnostics: string[];
}
```

`selectedReferences` is structured data. It is not prompt text.

### TBArtifact

```ts
interface TBArtifact {
  unitId: string;
  segmentId: string;
  mountedTBs: MountedTBArtifact[];
  rawMatches: TBMatchArtifact[];
  selectedReferences: PromptTBReferenceArtifact[];
  selectionPolicy: {
    maxTbReferences: number;
  };
  diagnostics: string[];
}
```

`selectedReferences` is structured data. It is not prompt text.

### PromptArtifact

```ts
interface PromptArtifact {
  unitId: string;
  provider: {
    id: string | null;
    name: string | null;
    baseUrl: string | null;
  };
  model: string | null;
  reasoningEffort: string | null;
  projectPrompt: string;
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
```

The inspect xlsx columns `_tm_for_mt` and `_tb_for_mt` are written from `PromptArtifact.tmPromptBlock` and `PromptArtifact.tbPromptBlock`.
This guarantees they match the exact prompt blocks used by MT while keeping TM/TB modules independent from prompt text formatting.

### InspectArtifact

```ts
interface InspectArtifact {
  version: 1;
  generatedAt: string;
  project: {
    id: number;
    name: string;
    srcLang: string;
    tgtLang: string;
    projectType: string;
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

interface InspectUnitArtifact {
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
    truncated: {
      tmForMt: boolean;
      tbForMt: boolean;
      mtUserPrompt: boolean;
    };
  };
  status: "ready" | "skipped-empty-source" | "error";
  error?: string;
}
```

## Inspect Output

The CLI writes two files:

```text
mt.inspect.xlsx
mt.inspect.json
```

### XLSX Output

The xlsx output should preserve the original worksheet structure for row-by-row comparison.

It contains:

- `Segments` sheet
  - original sheet rows and columns
  - appended inspect columns:
    - `_tm_for_mt`
    - `_tb_for_mt`
    - `_mt_user_prompt`
    - `_inspect_status`
    - `_inspect_json_ref`
- `MT_SystemPrompt` sheet
  - project id/name
  - provider/model/reasoning effort
  - system prompt
  - prompt length
  - JSON reference if truncated

For rows without source text:

- original cells are preserved
- appended inspect columns are blank except `_inspect_status = skipped-empty-source`

For rows with source text:

- `_tm_for_mt` is `PromptArtifact.tmPromptBlock`
- `_tb_for_mt` is `PromptArtifact.tbPromptBlock`
- `_mt_user_prompt` is `PromptArtifact.userPrompt`
- `_inspect_status = ready`
- `_inspect_json_ref` points to the JSON sidecar unit path

### JSON Sidecar

The JSON sidecar stores complete artifacts without truncation.

It is the source of truth for:

- full prompt text
- full raw TM/TB matches
- selected structured references
- transient segment data
- truncation status
- per-unit errors

The xlsx file is optimized for human scanning. The JSON file is optimized for exact diffing and debugging.

## Truncation Policy

XLSX cells are not the source of truth for long text.

Default behavior:

- `--max-cell-chars` defaults to `30000`
- if `_tm_for_mt`, `_tb_for_mt`, `_mt_user_prompt`, or system prompt exceeds the limit, xlsx stores a truncated value with a marker
- JSON stores the full value

Marker example:

```text
[TRUNCATED: see mt.inspect.json#/units/row-12/mt/userPrompt]
```

The first implementation should truncate only for xlsx output. It must not truncate the JSON artifact or the prompt artifact itself.

## CLI

Command:

```bash
npm run inspect:localization -- \
  --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" \
  --project-id 3 \
  --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" \
  --output "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.inspect.xlsx"
```

Default sidecar path:

```text
<output basename>.json
```

Options:

```text
--db <path>              SQLite DB path
--project-id <id>        Project id used as TM+TB+MT engine
--input <path>           External xlsx/csv input file
--output <path>          Inspect xlsx output path
--json-output <path>     Optional explicit JSON sidecar path
--unit-limit <n>         Inspect only the first n source-bearing rows
--target-scope <scope>   blank-only or overwrite-non-confirmed
--max-cell-chars <n>     XLSX truncation threshold; default 30000
```

First slice supports standard prompt mode only. Dialogue mode should fail clearly if requested.

## Data Flow

Inspect:

```text
inspectFile(projectId, inputPath)
  -> FileModule.parseExternalSpreadsheet()
  -> for each source-bearing unit:
       createTransientSegment()
       TMModule.inspect()
       TBModule.inspect()
       MTModule.composePrompt()
  -> InspectWriter.writeXlsx()
  -> InspectWriter.writeJson()
```

Translate:

```text
translateFile(projectId, inputPath)
  -> FileModule.parseExternalSpreadsheet()
  -> for each translatable unit:
       createTransientSegment()
       TMModule.inspect()
       TBModule.inspect()
       MTModule.composePrompt()
       MTModule.request()
  -> FileModule.writeTranslatedSpreadsheet()
```

The two flows share FileModule, TMModule, TBModule, and PromptComposer. Inspect stops before `MTModule.request()`.

## Error Handling

Project and file-level errors should fail the command:

- missing DB
- missing project
- unreadable input
- missing source/target column configuration
- unsupported dialogue mode

Per-unit errors should be captured in the artifact:

- `_inspect_status = error`
- `_inspect_json_ref` points to full error detail
- JSON sidecar stores the message and stage

The CLI should exit non-zero if any inspected source-bearing unit has status `error`, unless a future explicit `--allow-errors` option is added.

## No-Write and No-Request Guarantees

`inspect:localization` must not:

- create project `files`
- create or update `segments`
- update TM/TB usage counters
- call the AI provider
- write translations back into the input file

It may:

- read project, TM, TB, and settings data
- write the inspect xlsx output
- write the JSON sidecar output

## Testing Strategy

### Module Tests

- FileModule preserves original rows and appends inspect columns.
- TMModule returns raw matches and selected structured references without prompt text.
- TBModule returns raw matches and selected structured references without prompt text.
- PromptComposer produces prompt blocks and full prompts from structured TM/TB artifacts.
- PromptComposer output matches the existing AI prompt bundle behavior before and after extraction.

### Inspector Integration Tests

- Inspect does not create project files or segments.
- Inspect does not call AITransport.
- Inspect writes `Segments` and `MT_SystemPrompt` sheets.
- Inspect writes JSON sidecar with full artifacts.
- `_tm_for_mt` and `_tb_for_mt` are produced from PromptArtifact blocks.
- XLSX truncates long cells and JSON keeps full content.
- Unit errors are captured and cause CLI failure.

### CLI Tests

- `inspect:localization --help`
- required argument validation
- dynamic runner smoke with in-memory or temporary DB
- real no-request smoke against a configured project can be run manually

## First Implementation Slice

The first implementation should deliver:

1. Module boundary extraction for FileModule, TMModule, TBModule, MTModule/PromptComposer.
2. `LocalizationInspector.inspectFile()`.
3. `inspect:localization` CLI.
4. xlsx output with `Segments` and `MT_SystemPrompt`.
5. JSON sidecar output.
6. Focused tests and one real no-request smoke.

Non-goals for the first slice:

- UI panel
- multi-sheet inspection
- dialogue prompt inspection
- API request inspection
- comparing two inspect artifacts
