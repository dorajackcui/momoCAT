# 40_CLI_OPERATION

## Purpose

Operational guide for work agents using the `momocat` CLI and headless
localization flows.

## Installed Desktop and CLI Workflow

The `momocat` CLI is the headless companion for the desktop app. Installed
usage has two installation steps:

1. Install and open the desktop app once so it creates its user data directory
   and database.
2. Install the CLI package separately. The CLI is not bundled into the desktop
   installer yet.

Start every new machine or agent session with:

```bash
momocat env
momocat env --json
```

The self-check reports the resolved database, whether it exists, and the
runtime sidecars the CLI will use.

Typical installed usage omits `--db` and lets the CLI resolve the desktop
database:

```bash
momocat inspect projects
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
```

## Source Checkout Workflow

Run source commands from the repo root unless a command says otherwise. Build
the CLI after source changes:

```bash
npm run build:cli
```

From a source checkout, use:

```bash
npm --silent run cli -- <momocat arguments>
```

The source checkout fallback database is `.cat_data/cat_v1.db`.

Use placeholders in docs and examples. Keep real local values in ignored local
config files. For request-mode semantics, use the request model reference in
`DOCS/50_MT_REQUEST_MODEL.md`.

## Database and Runtime Resolution

When `--db` is omitted, Momocat resolves the database in this order:

1. `--db <path>` or `--db-path <path>`
2. `MOMOCAT_DB`
3. `MOMOCAT_USER_DATA_DIR/cat_v1.db`
4. Installed desktop user data directories
5. Source checkout fallback: `.cat_data/cat_v1.db`

Default installed desktop paths:

| Platform | Default path |
| --- | --- |
| Windows | `%APPDATA%/Momocat/cat_v1.db` |
| macOS | `~/Library/Application Support/Momocat/cat_v1.db` |
| Linux | `~/.config/Momocat/cat_v1.db` |

The CLI also checks the legacy desktop app name `simple-cat-tool` as a
fallback on each platform.

Override mechanisms:

```bash
momocat inspect projects --db <local-db>
momocat inspect projects --db-path <local-db>
set MOMOCAT_DB=<local-db>
set MOMOCAT_USER_DATA_DIR=<user-data-dir>
```

Installed runtime sidecars live next to the resolved database:

| Sidecar | Purpose |
| --- | --- |
| `ai-runtime.json` | Provider and runtime configuration used by CLI translation. |
| `proxy.env` | Optional proxy environment values for provider requests. |

## Inspect Projects

```bash
momocat inspect projects
momocat inspect projects --project-id <project-id>
momocat inspect projects --project-id <project-id> --json
momocat inspect projects --db <local-db> --project-id <project-id>
```

Use this before translation to confirm project identity, language pair,
mounted TM/TB resources, file coverage, and provider readiness. The command
may report whether required secrets exist, but it must not print secret values.

## Inspect Localization

```bash
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --tag-policy none
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial --target-baseline use-current-targets
momocat inspect localization --db <local-db> --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
```

Inspect does not send provider requests. Use the same `--request-mode` planned
for real translation. Use the same `--target-baseline` as the intended
translation run when comparing prompt shape.

## Translate File

```bash
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --tag-policy none
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --request-mode window-partial --target-baseline ignore-current-targets --context-header context
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
```

Translate reads project settings, mounted TM/TB resources, and provider config
from the DB. It writes `--output`, leaves the input unchanged, and does not
import the input file into project storage.

Context columns are optional. Use `--context-header <header>` to read a named
context column, or `--context-col <index>` to read a zero-based context column.
When context is present, Window Mode prompts include it with the corresponding
source unit.

Target baseline controls how existing target text is interpreted before Window
Mode planning:

| Option | Meaning |
| --- | --- |
| `--target-baseline use-current-targets` | Default. Keep current target cells as baseline. `window-partial` requests only eligible blank target cells and may use existing targets as read-only context. |
| `--target-baseline ignore-current-targets` | Treat current non-confirmed target text as absent before planning so eligible rows are regenerated. |

`--target-scope` is not a `translate file` option. It belongs to legacy
single-unit concurrent translation APIs, where it selects which units enter the
concurrent work queue. Window and Window Partial CLI runs use
`--target-baseline` instead.

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
`requestMode` and target baseline apply to both inspect and translate.

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
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --resume
momocat translate file --db <local-db> --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --resume
```

Use the same output and sidecar paths when resuming.

## Troubleshooting

Missing database:

- Open the desktop app once.
- Run `momocat env` to see the searched path.
- Use `--db`, `MOMOCAT_DB`, or `MOMOCAT_USER_DATA_DIR` for explicit routing.

Unsupported schema:

- Update the desktop app and CLI package together.
- Open the project in desktop once so migrations can run.

Missing provider:

- Configure the provider in the desktop app.
- Confirm `momocat inspect projects` reports provider readiness.
- Check that `ai-runtime.json` exists in `momocat env`.

Missing native dependency:

- Reinstall dependencies or the CLI package on the target machine.
- Use Node.js 20 or newer.
- Ensure `better-sqlite3` can load for the current OS and architecture.

Concurrent desktop and CLI usage:

- Avoid editing the same project in desktop while a CLI translation is running.
- The CLI reads project settings and writes output workbooks and sidecars; keep
  long translation runs isolated from desktop changes when possible.

## Real Provider Risk

Real translate sends source text and project context to the configured
provider. Run inspect first when debugging prompt shape.
