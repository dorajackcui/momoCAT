# Momocat CLI

`momocat` is the headless application shell for momoCAT. It delegates project inspection and resumable spreadsheet localization to `@cat/localization` while sharing the desktop database and runtime sidecars.

## Build from this repository

```bash
npm run build:cli
npm --silent run cli -- --help
```

Runtime support is declared by this package's [`package.json`](package.json). Exact command grammar and operational defaults are owned by [`DOCS/CLI.md`](../../DOCS/CLI.md).

## Quick start

```bash
momocat env
momocat inspect projects
momocat inspect localization --project-id <id> --input <input.xlsx> --output <inspect.xlsx>
momocat translate file --project-id <id> --input <input.xlsx> --output <translated.xlsx>
```

Run `momocat env` first on every machine. Use `--json` for machine-readable environment and project inspection.

The CLI is installed separately from the desktop app. Open desktop once to create its user-data database and configure the project/provider before running translation.

Use command-specific `--help` for the exact grammar. Read the maintained [CLI operating manual](../../DOCS/CLI.md) before automation, provider requests, resume, or artifact handling.
