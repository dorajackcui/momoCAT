# Agent-First CLI

## Purpose

The agent-first CLI lets humans and agents inspect projects, preview TM/TB/MT prompt artifacts, and run resumable file translation without using the CAT editor UI.

Run commands from the repo root.

## Commands

### Inspect Projects

```bash
npm run inspect:projects -- --db <path>
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

The command reports whether an API key exists but must not print full API keys.

### Inspect Localization

```bash
npm run inspect:localization -- --db <path> --project-id <id> --input <path> --output <inspect.xlsx>
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
npm run translate:file -- --db <path> --project-id <id> --input <path> --output <translated.xlsx>
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

1. Inspect project config.

```bash
npm run inspect:projects -- --db <db> --project-id <id>
```

2. Inspect prompt artifacts without sending requests.

```bash
npm run inspect:localization -- --db <db> --project-id <id> --input <input.xlsx> --output <inspect.xlsx>
```

3. Run real translation only when provider calls are intended.

```bash
npm run translate:file -- --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx>
```

4. Resume with the same paths if needed.

```bash
npm run translate:file -- --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --resume
```

5. Add diagnostic artifacts only for debug runs.

```bash
npm run translate:file -- --db <db> --project-id <id> --input <input.xlsx> --output <translated.xlsx> --artifacts <artifacts.jsonl>
```

## Clean Run Policy

For ordinary translation runs, prefer:

- Final output.
- Checkpoint JSONL.
- Events JSONL.
- Snapshot XLSX.

Avoid prompt artifact JSONL unless you are inspecting MT behavior. This keeps output directories clean and keeps large prompt payloads out of routine runs.
