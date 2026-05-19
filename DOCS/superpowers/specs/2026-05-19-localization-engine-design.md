# LocalizationEngine Design

## Summary

`LocalizationEngine` turns an existing project into a reusable TM + TB + MT engine. External callers provide text units or a file, receive translated results or an output file, and do not create project files or segment records. The project remains the source of language direction, prompt, mounted TM/TB resources, and AI provider configuration.

The first implementation should keep the public interface stable while reusing as much existing TM, TB, prompt, provider, and scheduling logic as possible. Deeper internal refactors can happen behind this interface later.

## Goals

- Treat a project as a localization engine, not as a file workspace.
- Translate external files without inserting rows into `files` or `segments`.
- Provide a stable facade that hides TM, TB, prompt composition, request scheduling, and provider details.
- Make prompt composition and API request scheduling explicit internal module boundaries so they can evolve independently.
- Return enough diagnostics for agent workflows: per-unit status, errors, TM references, TB references, and summary counts.
- Keep current CAT UI and file/segment persistence flows working unchanged.

## Non-Goals

- Replacing the existing CAT editor workflow.
- Writing translated external files back into the project database.
- Updating working TM from AI results during engine translation.
- Building a long-running job queue in the first implementation.
- Designing a public remote API authentication model in this spec.

## Architecture

```text
External caller
  -> FileAdapter or Units API
    -> LocalizationEngine
      -> ProjectConfigResolver
      -> TMModule
      -> TBModule
      -> MTModule
        -> PromptComposer
        -> RequestScheduler
        -> ProviderClient
      -> ResultAssembler
  -> JSON result or translated output file
```

`LocalizationEngine` is the stable black-box facade. Its internal modules can change without changing the external file or unit translation interface.

## Public Interfaces

### `inspectProject`

Checks whether a project can run as a localization engine.

```ts
inspectProject(projectId: number): Promise<LocalizationEngineProfile>;
```

The profile includes language direction, project prompt length, selected AI provider, API key status, mounted TM count, mounted TB count, and readiness errors. It must not reveal full API keys.

### `translateUnits`

Core API for agent and service callers.

```ts
translateUnits(input: TranslateUnitsInput): Promise<TranslateUnitsResult>;
```

```ts
interface TranslateUnitsInput {
  projectId: number;
  units: LocalizationUnit[];
  options?: LocalizationRunOptions;
}

interface LocalizationUnit {
  id: string;
  source: string;
  target?: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

interface LocalizationRunOptions {
  targetScope?: "blank-only" | "overwrite-non-confirmed";
  mode?: "standard" | "dialogue";
  includeReferences?: boolean;
  maxConcurrency?: number;
  providerOverride?: string;
}
```

`translateUnits` never writes file or segment records. It reads project configuration, TM, TB, and provider settings from the existing database.

### `translateFile`

Thin file adapter over `translateUnits`.

```ts
translateFile(input: TranslateFileInput): Promise<TranslateFileResult>;
```

```ts
interface TranslateFileInput {
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
```

Default column behavior:

- `hasHeader` defaults to `true`.
- `sourceHeader` defaults to `source`.
- `targetHeader` defaults to `target`.
- Header matching is exact after trimming and lowercasing.
- Numeric column indexes override header detection.

`translateFile` reads the input file, creates in-memory units, calls `translateUnits`, and writes a new output file. It does not call `ProjectFileModule.addFileToProject`.

## Internal Modules

### ProjectConfigResolver

Loads project language direction, project type, project prompt, selected AI provider, provider key, runtime model configuration, and mounted TM/TB resources. Missing project, missing provider, or missing API key are request-level errors.

### TMModule

Finds TM references for each unit using the project-mounted TMs. The first implementation can adapt the existing `TMService.findMatches` by creating transient in-memory `Segment` objects. It must not insert those transient segments into the database.

The module returns normalized references:

```ts
interface EngineTMReference {
  kind: "tm" | "concordance";
  rank: number;
  similarity?: number;
  tmName: string;
  sourceText: string;
  targetText: string;
  matchedSourceText?: string;
}
```

### TBModule

Finds terminology matches for each unit using project-mounted TBs. The first implementation can adapt the existing `TBService.findMatches` with transient in-memory segments.

The module returns normalized references:

```ts
interface EngineTBReference {
  tbName: string;
  srcTerm: string;
  tgtTerm: string;
  note?: string | null;
}
```

### MTModule

Owns prompt composition, request scheduling, provider requests, response normalization, and per-unit validation. It does not know about files or database writeback.

MTModule submodules:

- `PromptComposer`: builds system/user prompts from project config, source, context, existing target, TM references, TB references, and validation feedback.
- `RequestScheduler`: controls concurrency, backoff, per-unit continuation after errors, and progress events.
- `ProviderClient`: sends provider requests through the configured API protocol.

The first implementation can reuse `buildAITextPromptBundle`, `AIProviderTransport`, and the current standard file workflow's bounded concurrency behavior, but these should be called through the MTModule boundary.

## Data Flow

### Units Path

```text
translateUnits
  -> validate input units
  -> load project config
  -> for each unit:
       create transient segment shape
       resolve TM references
       resolve TB references
       compose prompt
  -> schedule provider requests
  -> validate and normalize target text
  -> return per-unit results
```

### File Path

```text
translateFile
  -> parse xlsx/csv in memory
  -> detect source/target/context columns
  -> create units with row ids
  -> translateUnits
  -> write target values into output workbook
  -> return summary and outputPath
```

The input file is never modified in place. The output file path is explicit.

## Result Shape

```ts
interface TranslateUnitsResult {
  summary: {
    total: number;
    translated: number;
    skipped: number;
    failed: number;
  };
  results: LocalizationUnitResult[];
}

interface LocalizationUnitResult {
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
```

`blank-only` skips units with non-empty target text. `overwrite-non-confirmed` translates all non-empty source units supplied by the caller because external units do not have a project-confirmed state.

## Error Handling

- Request-level errors stop the run: project missing, provider missing, API key missing, unreadable input file, missing source/target columns.
- Unit-level errors do not stop the run by default: provider error for one unit, empty provider response, tag validation failure, unchanged source response when source and target languages differ.
- The scheduler records unit-level failures and continues with remaining units.
- A future `failFast` option can be added after the first implementation if workflow users need it.

## Persistence Rules

- `LocalizationEngine.translateUnits` does not call `createFile`, `bulkInsertSegments`, `updateSegmentTarget`, or `updateFileStats`.
- `LocalizationEngine.translateFile` writes only the requested output file.
- Project, TM, TB, settings, provider, and runtime configuration tables are read as engine resources.
- Existing UI workflows keep their current persistence behavior.

## Testing Strategy

1. Unit tests for `translateUnits` with mocked TM/TB/MT modules verify no database file or segment rows are created.
2. Integration tests with an in-memory database verify project config, TM, TB, prompt composition, scheduling, and per-unit result assembly.
3. File adapter tests verify `source` and `target` header detection, output workbook writing, and no DB file insertion.
4. A real-data smoke command verifies an external xlsx can translate through project id `3` without creating `files` or `segments`.
5. Existing CAT file import and `trace:ai-file` tests continue to protect the legacy persisted workflow.

## First Implementation Slice

The first slice should implement:

- `LocalizationEngine.translateUnits`.
- `LocalizationEngine.translateFile`.
- `npm run translate:file -- --project-id <id> --input <path> --output <path>`.
- `npm run translate:units` or a small script-level JSON entrypoint for agent smoke tests.
- Tests proving external file translation does not write to `files` or `segments`.

The first slice may reuse current prompt and provider code internally. It should not move all TM/TB/MT logic at once.

## Future API Service

After the core interface works locally, the HTTP service can wrap the same facade:

```http
POST /v1/projects/:projectId/translate-units
POST /v1/projects/:projectId/translate-file
GET /v1/projects/:projectId/engine-profile
```

The HTTP layer should remain a transport adapter. It should not own prompt logic, scheduling logic, or file parsing logic.

## Self-Review

- No implementation details require unresolved decisions.
- The persistence boundary is explicit: external files and units do not create project files or segments.
- Prompt composition and request scheduling are named module boundaries.
- The first implementation slice is small enough to plan and test in one pass.
