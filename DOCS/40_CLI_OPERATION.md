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
- For request-mode semantics, use the request model reference in
  `DOCS/50_MT_REQUEST_MODEL.md`.

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
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --tag-policy none
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial
```

Inspect does not send provider requests. Use the same `--request-mode` planned
for real translation.

## Translate File

```bash
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --tag-policy none
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --request-mode window-partial
```

Translate reads project settings, mounted TM/TB resources, and provider config
from the DB. It writes `--output`, leaves the input unchanged, and does not
import the input file into project storage.

Blank target cells are translated by default. Use `--target-scope` only when a
run intentionally needs different target handling.

Tag policy defaults to current CAT marker detection. Use `--tag-policy none`
when input text has already been filtered upstream, or when marker-like content
such as `{1}`, `{1>`, `<2}`, `{3}`, `<xxx>`, or `%s` must remain ordinary text.

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

For direct `translate file` runs, default sidecars use the output base name.
For example, `<translated.xlsx>` produces `<translated>.checkpoint.jsonl`,
`<translated>.events.jsonl`, and `<translated>.snapshot.xlsx`.

Standard smoke uses `<prefix>-translated.xlsx` for translated output and writes
its sidecars with the run prefix.

| Output | Purpose |
| --- | --- |
| `<translated>.checkpoint.jsonl` | Direct translate resume truth per unit. |
| `<translated>.events.jsonl` | Direct translate lightweight progress stream. |
| `<translated>.snapshot.xlsx` | Direct translate throttled partial output. |
| `<prefix>-translated.xlsx` | Standard smoke translated workbook. |
| `<prefix>.checkpoint.jsonl` | Standard smoke resume truth per unit. |
| `<prefix>.events.jsonl` | Standard smoke lightweight progress stream. |
| `<prefix>.snapshot.xlsx` | Standard smoke throttled partial output. |
| `<prefix>.artifacts.jsonl` | Standard smoke opt-in prompt/TM/TB diagnostics for real translate runs. |
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
