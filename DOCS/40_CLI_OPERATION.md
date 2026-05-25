# 40_CLI_OPERATION

## Purpose

Operational guide for work agents using the `momocat` CLI and headless
localization flows.

## Before Running Commands

- Run commands from the repo root unless a command says otherwise.
- Build the CLI after source changes: `npm run build:cli`.
- From source checkout, use `npm --silent run cli -- <momocat arguments>`.
- Use placeholders in docs and examples. Keep real local values in ignored
  local config files.
- See `DOCS/50_MT_REQUEST_MODEL.md` for request-mode semantics.

## Inspect Projects

```bash
momocat inspect projects --db <local-db> --project-id <project-id>
momocat inspect projects --db <local-db> --project-id <project-id> --json
```

Use this before translation to confirm project identity, language pair,
mounted TM/TB resources, file coverage, and provider readiness. The command
may report whether required secrets exist, but it must not print secret values.

## Inspect Localization

```bash
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial
```

Inspect does not send provider requests. Use the same `--request-mode` planned
for real translation.

## Translate File

```bash
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --request-mode window-partial
```

Translate reads project settings, mounted TM/TB resources, and provider config
from the DB. It writes `--output`, leaves the input unchanged, and does not
import the input file into project storage.

Blank target cells are translated by default. Use `--target-scope` only when a
run intentionally needs different target handling.

## Standard Smoke

```bash
npm run smoke:momocat
npm run smoke:momocat -- --dry-run
npm run smoke:momocat -- --inspect-only
npm run smoke:momocat -- --request-mode window-partial --prefix <run-prefix>
```

The smoke helper reads `.momocat-smoke.local.json`, which is gitignored.
`requestMode` applies to both inspect and translate.

Use `--dry-run` to print commands before execution. Use `--inspect-only` when
provider calls are not intended.

## Sidecars and Outputs

| Output | Purpose |
| --- | --- |
| `<output>.checkpoint.jsonl` | Resume truth per unit. |
| `<output>.events.jsonl` | Lightweight progress stream. |
| `<output>.snapshot.xlsx` | Throttled partial output. |
| `<output>.artifacts.jsonl` | Opt-in prompt/TM/TB diagnostics for real translate runs. |
| `<prefix>-inspect.json` | No-request inspect artifacts. |
| `<prefix>-inspect.xlsx` | No-request inspect workbook. |

Keep routine runs to final output plus default sidecars. Add artifacts only for
diagnostic translate runs.

## Resume

```bash
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --resume
```

Use the same output and sidecar paths when resuming.

## Real Provider Risk

Real translate sends source text and project context to the configured
provider. Run inspect first when debugging prompt shape.
