# Agent-First CLI

## Purpose

The agent-first CLI lets humans and agents inspect projects, preview TM/TB/MT prompt artifacts, and run resumable file translation without using the CAT editor UI.

Run commands from the repo root.

When running from a source checkout before installing or linking the bin, run `npm run build:cli` after source changes, then use `npm --silent run cli -- <momocat arguments>`, for example:

```bash
npm --silent run cli -- inspect projects --db <path>
```

## Commands

`momocat` is owned by `apps/cli` and calls `@cat/localization`; tests verify the same package APIs without serving as the command runtime.

### Inspect Projects

```bash
momocat inspect projects --db <path>
```

Useful options:

```bash
--project-id <id>
--json
```

Use this before translation to confirm:

- Project id and language pair.
- Mounted TM/TB resources.
- File coverage stored in the project DB.
- AI provider status.

Provider status:

- Reads configured AI providers from connection-backed provider settings.
- Reports provider id, connection base URL, selected model, and API key status.
- Does not list hard-coded built-in OpenAI models.

The command reports whether an API key exists but must not print full API keys.

### Inspect Localization

```bash
momocat inspect localization --db <path> --project-id <id> --input <path> --output <inspect.xlsx>
```

Useful options:

```bash
--json-output <path>
--unit-limit <n>
--max-cell-chars <n>
```

Use this before prompt changes and before real MT smoke. It does not send provider requests.

Outputs:

- Inspect workbook with `Segments` and `MT_SystemPrompt` sheets.
- JSON sidecar with full TM/TB/prompt artifacts.

The `Segments` sheet preserves original file rows and appends:

- `_tm_for_mt`
- `_tb_for_mt`
- `_mt_user_prompt`
- `_inspect_status`
- `_inspect_json_ref`

### Translate File

```bash
momocat translate file --db <path> --project-id <id> --input <path> --output <translated.xlsx>
```

Default behavior:

- Reads project settings, mounted TM/TB resources, and AI provider config from the DB.
- Does not import the input file into project `files` or `segments`.
- Detects `source` and `target` headers by default.
- Translates blank target cells by default.
- Writes the translated spreadsheet to `--output`.
- Leaves the input file unchanged.

Useful options:

```bash
--target-scope blank-only
--target-scope overwrite-non-confirmed
--resume
--max-attempts <n>
--checkpoint <path>
--events <path>
--snapshot <path>
--snapshot-every-units <n>
--snapshot-every-seconds <n>
--progress-stdout
--artifacts <path>
--batch-size <n>
--request-mode window
--request-mode window-partial
```

Request modes:

- `window`: default dense Window Mode. Each physical batch requests the rows in target scope.
- `window-partial`: opt-in physical scan window with dynamic request rows. Existing-target rows in a scan window are read-only context unless `--target-scope overwrite-non-confirmed` makes them request rows.

Batch size defaults to 5, accepts values from 1 to 5, and controls the physical scan window. Same-file requests remain ordered and sequential even if older concurrency options are present.

Prompt contract:

- Rows requiring target text reuse existing Window Mode current segment rendering.
- Read-only context rows are context only and must not be returned by the provider.
- Response ids are dynamic and request-only.

Rollback to dense Window Mode:

```bash
momocat translate file --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --request-mode window
```

## Sidecars

| Sidecar | Default | Purpose |
| --- | --- | --- |
| `<output base>.checkpoint.jsonl` | Yes | Resume translated units without re-requesting them. |
| `<output base>.events.jsonl` | Yes | Lightweight progress stream. |
| `<output base>.snapshot.xlsx` | Yes | Throttled partial output for long jobs. |
| Artifact JSONL | No | Full TM/TB/prompt diagnostics when `--artifacts <path>` is passed. |

Use the same output and sidecar paths with `--resume` after an interrupted run.

## Recommended Smoke Flow

For the standard local configured smoke, use:

```bash
npm run smoke:momocat
```

This command reads `.momocat-smoke.local.json`, which is intentionally gitignored.
Create it from `.momocat-smoke.example.json` and keep machine paths, project id,
provider metadata, and model names in the local file.

Set `"requestMode": "window-partial"` in the local smoke config, or pass `--request-mode window-partial` to the smoke helper, to run the final translate step in partial Window Mode. Set `"requestMode": "window"` or omit it to use dense Window Mode.

Use `npm run smoke:momocat -- --dry-run` to print the exact commands, or `npm run smoke:momocat -- --inspect-only` to skip provider calls.

1. Inspect project config.

```bash
momocat inspect projects --db <db> --project-id <id>
```

2. Inspect prompt artifacts without sending requests.

```bash
momocat inspect localization --db <db> --project-id <id> --input <input.xlsx> --output <inspect.xlsx>
```

3. Run real translation only when provider calls are intended.

```bash
momocat translate file --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx>
```

For the partial request mode smoke:

```bash
momocat translate file --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --request-mode window-partial
```

4. Resume with the same paths if needed.

```bash
momocat translate file --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --resume
```

5. Add diagnostic artifacts only for debug runs.

```bash
momocat translate file --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --artifacts <artifacts.jsonl>
```

## Clean Run Policy

For ordinary translation runs, prefer:

- Final output.
- Checkpoint JSONL.
- Events JSONL.
- Snapshot XLSX.

Avoid prompt artifact JSONL unless you are inspecting MT behavior. This keeps output directories clean and keeps large prompt payloads out of routine runs.
