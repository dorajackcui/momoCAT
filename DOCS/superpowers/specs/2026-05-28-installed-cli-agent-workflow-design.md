# Installed CLI Agent Workflow Design

Date: 2026-05-28

## Purpose

Make the installed `momocat` CLI a first-class headless control surface for
agentic workers after a user installs both the desktop app and CLI package.
The desired workflow is the same shape as the current development repo flow:
the desktop app owns project setup, data, provider configuration, TM, and TB;
an agent can then use `momocat` commands to inspect projects, inspect prompt
artifacts, run file translation, and resume jobs without knowing repository
paths.

## Product Boundary

Version 1 keeps two deliverables:

- Desktop installer: owns the GUI, project database, project resources, provider
  setup, proxy setup, and user data directory.
- CLI package: owns agent/headless command execution and defaults to the same
  desktop data directory.

Bundling the CLI inside the desktop installer is out of scope for this design.
That can come later after the separate CLI package has a stable installation
and runtime contract.

## Current Gaps

The development repo flow works because commands run from the repo root and
can rely on `.cat_data/cat_v1.db`. Installed users do not have that structure.

Current gaps:

- `DOCS/40_CLI_OPERATION.md` is written for repo-root operation.
- `inspect projects` defaults to `.cat_data/cat_v1.db`.
- `inspect localization` and `translate file` require `--db`.
- The CLI package is not yet a clean external distribution artifact.
- The CLI package has no user-facing README or agent workflow document.
- Runtime dependencies and workspace package boundaries are not ready for
  installation outside the monorepo.
- CLI translation currently creates the localization engine with default model
  runtime config, instead of reading the desktop `ai-runtime.json` next to the
  desktop database.

## Desired Installed Workflow

1. User installs and launches the desktop app.
2. User creates or imports projects, mounts TM/TB resources, and configures AI
   providers in the desktop app.
3. User installs the CLI package so `momocat` is available on `PATH`.
4. Agent runs:

   ```bash
   momocat env
   momocat inspect projects
   momocat inspect localization --project-id <id> --input <input.xlsx> --output <inspect.xlsx>
   momocat translate file --project-id <id> --input <input.xlsx> --output <translated.xlsx>
   ```

5. CLI commands resolve the installed desktop data directory by default, open
   the same `cat_v1.db`, and use the same provider catalog, API keys, project
   settings, mounted TM/TB resources, proxy-relevant environment, and model
   runtime config available to the headless localization layer.

## Data Directory Resolution

Add a small CLI data-environment resolver in `apps/cli`. It must be pure and
unit-tested. Resolution order:

1. Explicit `--db` or `--db-path`.
2. `MOMOCAT_DB`.
3. `MOMOCAT_USER_DATA_DIR/cat_v1.db`.
4. Platform desktop user-data candidates for the installed app.
5. Source checkout fallback: `<cwd>/.cat_data/cat_v1.db`.

The resolver must not create a missing database. If no candidate exists, it
returns a diagnostic result and commands fail with guidance to open the desktop
app first or pass `--db`.

Platform candidates:

- Windows: `%APPDATA%/Simple CAT Tool/cat_v1.db`, with a fallback for the
  package-name directory `%APPDATA%/simple-cat-tool/cat_v1.db` if Electron
  resolves differently.
- macOS: `~/Library/Application Support/Simple CAT Tool/cat_v1.db`, with the
  package-name fallback `~/Library/Application Support/simple-cat-tool/cat_v1.db`.
- Linux: `$XDG_CONFIG_HOME/Simple CAT Tool/cat_v1.db` or
  `~/.config/Simple CAT Tool/cat_v1.db`, with package-name fallbacks under
  `simple-cat-tool`.

The implementation should keep the candidate list centralized so docs and
`momocat env` can report the same logic.

## CLI Surface

Add:

```bash
momocat env
momocat env --json
```

Default output is human-readable. JSON output is stable enough for agents.
The command reports:

- CLI version.
- Node version.
- Platform.
- Resolved database path, if any.
- Resolution source, such as `--db`, `MOMOCAT_DB`, desktop default, or source
  checkout fallback.
- Desktop user-data candidate paths.
- Whether the database exists.
- Whether sibling files such as `ai-runtime.json` and `proxy.env` exist.
- Short next-step guidance when no database is found.

Update existing commands:

- `inspect projects`: keep `--db` optional and use the resolver by default.
- `inspect localization`: make `--db` optional and use the resolver by default.
- `translate file`: make `--db` optional and use the resolver by default.
- All command help must mention the installed desktop default and the override
  order.

Keep `--db` and `--db-path` as explicit overrides for automation, tests, and
advanced users.

## Runtime Config and Proxy

Desktop production uses `userData/cat_v1.db`, `userData/ai-runtime.json`, and
`userData/proxy.env`. The installed CLI should use the same sibling files when
the resolved database lives in a desktop user-data directory.

For `inspect localization` and `translate file`, command construction should
pass an `AIRuntimeConfigService` initialized from the resolved user-data
directory when `ai-runtime.json` is present or expected. If the file is missing,
the existing default runtime config is acceptable, but `momocat env` should
make that visible.

Proxy behavior should stay explicit and conservative:

- CLI commands inherit the process environment.
- If `proxy.env` exists next to the resolved desktop database, CLI loads it
  using the same simple `KEY=value` format as desktop before provider requests.
- `momocat env` reports whether the file is present, but never prints secrets.

## Error Handling

Missing database:

- Do not bootstrap an empty database.
- Print the candidates checked.
- Suggest opening the desktop app once or passing `--db`.

Unsupported schema:

- Reuse the existing unsupported-schema error from `@cat/db`.
- Print the resolved database path.

Provider not configured:

- `inspect projects` should remain the safe readiness command.
- `translate file` may fail if the selected project has no usable provider.
  The error should point back to `momocat inspect projects`.

Concurrent desktop and CLI use:

- Reads are acceptable.
- Long-running CLI translation should be documented as best run when the
  desktop app is idle or closed, because both use the same SQLite database and
  side effects.

Secrets:

- CLI diagnostics may show whether an API key is present and the last four
  characters already exposed by existing inspect output.
- CLI diagnostics must not print full API keys or private prompt artifacts by
  default.

## Distribution

Short-term distribution remains two install steps:

1. Install the desktop app with the platform installer.
2. Install the CLI package with the documented package mechanism.

The CLI package must be cleaned up for external installation:

- Remove `private: true` when publishing is intended.
- Decide the package name for external users.
- Add `files` so the package includes only the executable bundle, type metadata
  if needed, README, license, and package metadata.
- Exclude source tests and `tsbuildinfo` from packed artifacts.
- Declare runtime dependencies needed by the bundle, or bundle them except for
  native modules that must remain external.
- Make `better-sqlite3` installation expectations explicit.

The v1 design does not require the desktop installer to modify `PATH` or ship a
Node runtime for the CLI.

## Documentation

Update `DOCS/40_CLI_OPERATION.md` and add a CLI package README. Required
sections:

- Installed desktop plus CLI workflow.
- Agent quick start.
- `momocat env` self-check.
- Default DB resolution and overrides.
- Project readiness check.
- Inspect-before-translate workflow.
- Resume workflow.
- Sidecar files and privacy notes.
- Known limitations, including concurrent desktop/CLI writes.
- Troubleshooting for missing DB, unsupported schema, missing provider, and
  missing native dependency.

Docs should keep real user paths as placeholders, but should name the platform
default patterns.

## Testing

Unit tests:

- Data resolver order and platform candidates.
- Missing database diagnostics do not create a DB.
- `MOMOCAT_DB` and `MOMOCAT_USER_DATA_DIR` overrides.
- `--db` still wins over environment defaults.
- `momocat env` text and JSON output.
- Existing command parsers accept omitted `--db` and receive the resolved DB.
- Help output includes installed default behavior.

Build and packaging checks:

- `npm run build:cli`.
- CLI command help smoke from `apps/cli/dist/index.mjs`.
- `npm pack --workspace=apps/cli --dry-run --json` shows the intended file
  list and no tests or source-only build info.

Manual smoke:

- Install or simulate a desktop user-data directory with `cat_v1.db`.
- Run `momocat env`.
- Run `momocat inspect projects`.
- Run `momocat inspect localization`.
- Run `momocat translate file` against a safe test workbook.

## Out of Scope

- Shipping CLI inside the desktop installer.
- Adding a desktop UI for CLI installation.
- Auto-updating the CLI with the desktop app.
- Migrating old databases.
- Designing a remote service/API around the same headless layer.
- Changing desktop project setup flows.

## Open Decisions

None for v1. The approved direction is:

- Keep desktop and CLI as separate deliverables for now.
- Make the installed CLI default to the installed desktop data directory.
- Keep explicit `--db` override support.
- Add `momocat env` as the first agent self-check command.
