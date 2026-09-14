# Momocat CLI

`momocat` is the headless application shell for momoCAT. It delegates project inspection and resumable spreadsheet localization to `@cat/localization` while sharing the desktop database and runtime sidecars.

## Build from this repository

```bash
npm run build:cli
npm --silent run cli -- --help
```

Runtime support is declared by this package's [package.json](package.json). Start with the [CLI operating manual](../../DOCS/CLI.md) for installation, environment resolution, commands, exit codes, resume, and privacy. Command-specific `--help` owns the exact option grammar.

For implementation changes, [cli.ts](src/cli.ts) owns dispatch and the common error boundary, [commands](src/commands) owns parsing/output, and [cli.test.ts](src/cli.test.ts) covers the command contract. Shared workflows stay in `@cat/localization`.
