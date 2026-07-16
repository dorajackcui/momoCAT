# CLI operation

## Role and installation model

`momocat` is a thin headless companion to the desktop app. It uses the same project database and runtime configuration but is not currently bundled into the desktop installer.

Installed use therefore requires:

1. Install and open momoCAT once so its user-data directory and database exist.
2. Install/build the CLI separately for the target machine.

The CLI package supports Node.js 20.x or 22 and newer; Node.js 21 is intentionally outside its declared engine range. A source checkout uses the Volta-pinned Node 20.19.0.

## Source checkout

From the repository root:

```bash
npm run build:cli
npm --silent run cli -- --help
npm --silent run cli -- env
```

`npm run build:cli` builds `@cat/localization` first and then produces `apps/cli/dist/index.mjs`.

## Start every session with `env`

```bash
momocat env
momocat env --json
```

The command reports the selected database, whether it exists, the source of that selection, and the runtime sidecars the CLI will use. Prefer `--json` for automation.

## Database resolution

Without an explicit option, the CLI resolves the database in this order:

1. `--db <path>` or `--db-path <path>`
2. `MOMOCAT_DB`
3. `MOMOCAT_USER_DATA_DIR/cat_v1.db`
4. Installed desktop user-data locations (including legacy app-name fallback)
5. Source checkout fallback `.cat_data/cat_v1.db`

Default installed candidates:

| Platform | Database candidates (in order)                                                                |
| -------- | --------------------------------------------------------------------------------------------- |
| Windows  | `%APPDATA%/Simple CAT Tool/cat_v1.db`, then `%APPDATA%/simple-cat-tool/cat_v1.db`             |
| macOS    | `~/Library/Application Support/Simple CAT Tool/cat_v1.db`, then the `simple-cat-tool` sibling |
| Linux    | `$XDG_CONFIG_HOME` or `~/.config` under `Simple CAT Tool`, then `simple-cat-tool`             |

Examples:

```bash
momocat inspect projects --db <database>
MOMOCAT_DB=/path/to/cat_v1.db momocat inspect projects
```

```powershell
$env:MOMOCAT_DB = 'C:\path\to\cat_v1.db'
momocat inspect projects
```

Installed runtime sidecars live next to the selected database:

| File              | Purpose                                             |
| ----------------- | --------------------------------------------------- |
| `ai-runtime.json` | Provider runtime/model tuning used for translation. |
| `proxy.env`       | Optional provider proxy environment.                |

## Command map

```text
momocat env
momocat inspect projects
momocat inspect localization
momocat translate file
```

Run any command with `--help` for the exact option set. Help text in [`apps/cli/src/commands`](../apps/cli/src/commands) is the syntax source of truth.

## Inspect projects

```bash
momocat inspect projects
momocat inspect projects --project-id <id>
momocat inspect projects --json
momocat inspect projects --db <database> --project-id <id>
```

Use this to verify project identity, language pair, file coverage, mounted TM/TB resources, and provider readiness. Readiness may reveal that a required secret exists; output must never reveal the secret value.

## Inspect localization

Inspect reads the workbook and composes TM/TB/MT artifacts without sending provider requests.

```bash
momocat inspect localization --project-id <id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial --target-baseline use-current-targets
```

Important options:

- `--unit-limit <n>` limits inspected source units.
- `--max-cell-chars <n>` bounds generated spreadsheet cell content.
- `--request-mode window|window-partial` defaults to `window-partial`.
- `--target-baseline use-current-targets|ignore-current-targets` defaults to `use-current-targets`.
- `--tag-policy default|none` controls CAT marker recognition.

Use the same request mode, target baseline, and tag policy that the real translation will use so prompt shape is comparable.

## Translate a file

```bash
momocat translate file --project-id <id> --input <input.xlsx> --output <translated.xlsx>
```

The command reads project/provider/TM/TB settings from SQLite, leaves the input unchanged, and does not import the external workbook into project storage.

Common controls:

| Option                                                              | Meaning                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `--request-mode window` or `window-partial`                         | Request planning mode; default `window-partial`.                    |
| `--target-baseline use-current-targets` or `ignore-current-targets` | Keep existing targets or regenerate eligible non-confirmed targets. |
| `--tag-policy default` or `none`                                    | Parse CAT-like markers or preserve them as ordinary text.           |
| `--context-header <name>`                                           | Read a named context column.                                        |
| `--context-col <index>`                                             | Read a zero-based context column.                                   |
| `--batch-size <1..5>`                                               | Override physical request batch size.                               |
| `--max-attempts <n>`                                                | Set positive task retry limit.                                      |
| `--resume`                                                          | Reuse matching checkpoint results.                                  |
| `--progress-stdout`                                                 | Forward progress events to stdout.                                  |
| `--checkpoint`, `--events`, `--snapshot`                            | Override default sidecar paths.                                     |
| `--snapshot-every-units`, `--snapshot-every-seconds`                | Override snapshot cadence.                                          |
| `--artifacts <path>`                                                | Opt in to full prompt/TM/TB diagnostic JSONL.                       |
| `--audit <path>`                                                    | Opt in to lightweight flow audit JSONL.                             |

`--target-scope` is not a file-translation option. It belongs to the legacy single-unit API; file jobs use `--target-baseline`.

Use `--tag-policy none` when strings such as `{1}`, `<name>`, or `%s` are business text rather than CAT-managed tags. The default policy recognizes marker-like content and protects it through MT.

## Outputs, resume, and privacy

For `translated.xlsx`, default runtime outputs are based on the output stem:

| Output                        | Purpose                      |
| ----------------------------- | ---------------------------- |
| `translated.xlsx`             | Final workbook.              |
| `translated.checkpoint.jsonl` | Per-unit resume truth.       |
| `translated.events.jsonl`     | Lightweight progress stream. |
| `translated.snapshot.xlsx`    | Throttled partial workbook.  |

Resume with the same project, input, output, request policy, and sidecar paths:

```bash
momocat translate file --project-id <id> --input <input.xlsx> --output <translated.xlsx> --resume
```

Checkpoints include identity/fingerprints needed to reject incompatible reuse. Events, audit, and artifacts are not resume truth.

Audit records show request/repair/persist/Runtime-TM flow without full source, target, prompts, or provider responses. Full artifacts can contain private source text, rendered prompts, provider metadata, and references; enable them only for a specific investigation and keep them untracked.

## Standard smoke helper

The repository smoke script reads ignored `.momocat-smoke.local.json` configuration:

```bash
npm run smoke:momocat -- --dry-run
npm run smoke:momocat -- --inspect-only
npm run smoke:momocat -- --request-mode window-partial --prefix <prefix>
```

Use `--inspect-only` when provider calls are not intended. Never commit the local smoke config or generated workbooks/sidecars.
The tracked example uses repository-relative placeholder paths so it works in both shells; replace them with existing files or absolute paths for the current host.

## Troubleshooting

### Database not found

- Open the desktop app once.
- Run `momocat env` and inspect its resolution source.
- Use `--db`, `MOMOCAT_DB`, or `MOMOCAT_USER_DATA_DIR` for deliberate routing.

### Unsupported schema

The current code accepts the schema contract documented in [Data model](DATA_MODEL.md). Opening the project does not migrate an older schema marker. Use a matching desktop/CLI version or an explicit recovery/import path; preserve the original database before intervention.

### Provider unavailable

- Configure the provider in desktop.
- Confirm `inspect projects` reports readiness.
- Confirm `ai-runtime.json` is at the path reported by `env`.
- Use inspect before a real request.

### Native dependency cannot load

- Use Node 20.x or 22+ on the target machine.
- Rebuild/reinstall the CLI for that OS, architecture, and Node ABI.
- In a source checkout, run `npm run rebuild:test` before Node-based DB commands.

### Concurrent desktop use

Avoid changing the same project resources while a long CLI run is active. CLI file translation writes external output/sidecars, but it reads live project, provider, and mounted-resource configuration from the shared database.

## Safety boundary

`inspect localization` makes no provider request. `translate file` sends source/context/reference text to the configured provider. Confirm input, project, provider, and artifact paths before a real run.
