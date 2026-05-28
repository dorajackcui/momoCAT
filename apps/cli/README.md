# Momocat CLI

Momocat CLI is the headless companion for the Momocat desktop app. It lets
agents inspect projects, inspect localization workbooks, and run file
translation from the same desktop database and runtime sidecars.

## Install

1. Install and open the Momocat desktop app once so it creates its user data
   directory and database.
2. Install the CLI package separately. The CLI is not bundled into the desktop
   installer yet.

After installation, the executable is `momocat`.

## Agent Quick Start

```bash
momocat env
momocat inspect projects
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
```

Run `momocat env` first. It prints the database path, whether it exists, and
the runtime sidecar paths the CLI will use.

For machine-readable checks:

```bash
momocat env --json
```

## Database Resolution

When a command does not receive an explicit database path, Momocat resolves the
database in this order:

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

The CLI also checks the legacy desktop app name `simple-cat-tool` as a fallback
on each platform.

Use overrides when the desktop database lives somewhere else:

```bash
momocat inspect projects --db <local-db>
set MOMOCAT_DB=<local-db>
set MOMOCAT_USER_DATA_DIR=<user-data-dir>
```

## Commands

List projects and provider readiness:

```bash
momocat inspect projects
momocat inspect projects --json
momocat inspect projects --db <local-db> --project-id <project-id>
```

Inspect a workbook without provider requests:

```bash
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx>
momocat inspect localization --project-id <project-id> --input <input.xlsx> --output <inspect.xlsx> --json-output <inspect.json> --request-mode window-partial
```

Translate a workbook:

```bash
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx>
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --target-baseline ignore-current-targets --context-header context
```

Resume a direct translation run with the same output and sidecar paths:

```bash
momocat translate file --project-id <project-id> --input <input.xlsx> --output <translated.xlsx> --resume
```

## Runtime Sidecars

For installed desktop usage, runtime sidecars live next to the resolved desktop
database:

| Sidecar | Purpose |
| --- | --- |
| `ai-runtime.json` | Provider and runtime configuration used by CLI translation. |
| `proxy.env` | Optional proxy environment values for provider requests. |

For direct `translate file` runs, output sidecars default to the output base
name:

| Output | Purpose |
| --- | --- |
| `<translated>.checkpoint.jsonl` | Resume truth per unit. |
| `<translated>.events.jsonl` | Lightweight progress stream. |
| `<translated>.snapshot.xlsx` | Throttled partial workbook output. |

## Troubleshooting

Missing database:

- Open the desktop app once.
- Run `momocat env` to see the searched path.
- Use `--db`, `MOMOCAT_DB`, or `MOMOCAT_USER_DATA_DIR` for explicit routing.

Missing provider:

- Configure the provider in the desktop app.
- Confirm `momocat inspect projects` reports provider readiness.
- Check that `ai-runtime.json` exists in `momocat env`.

Unsupported schema:

- Update the desktop app and CLI package together.
- Open the project in desktop once so migrations can run.

Native dependency failure:

- Reinstall the CLI package on the target machine.
- Use Node.js 20 or newer.
- Ensure `better-sqlite3` can load for the current OS and architecture.

Concurrent desktop and CLI usage:

- Avoid editing the same project in desktop while a CLI translation is running.
- The CLI reads project settings and writes output workbooks and sidecars; keep
  long translation runs isolated from desktop changes when possible.
