# CLI App Extraction Design

## Purpose

Create `apps/cli` as a first-class app that sits beside the legacy desktop app
and exposes agent-friendly headless localization commands.

The design goal is clarity over compatibility. The CLI should be a real product
surface, not a collection of root-level scripts. The dependency chain must stay
simple and enforceable:

```text
apps/cli -> @cat/localization -> @cat/db -> @cat/core
```

The legacy desktop app remains a separate host:

```text
apps/desktop -> @cat/localization
```

Neither app should depend on the other.

## Approved Direction

Create a new workspace app:

```text
apps/cli
```

It owns CLI concerns only:

- command entrypoints
- command grammar
- argument parsing and help text
- stdout and stderr formatting
- exit codes
- CLI-level tests

It does not own headless localization behavior. All project inspection,
localization inspection, translation, provider readiness, TM/TB/MT orchestration,
checkpointing, events, artifacts, snapshots, prompt construction, and response
parsing stay in `@cat/localization` or lower packages.

## Command Surface

The product command is:

```text
momocat
```

First-version command grammar:

```bash
momocat inspect projects --db <path>
momocat inspect projects --db <path> --project-id <id>
momocat inspect projects --db <path> --json

momocat inspect localization --db <path> --project-id <id> --input <path> --output <path>
momocat inspect localization --db <path> --project-id <id> --input <path> --output <path> --json-output <path>

momocat translate file --db <path> --project-id <id> --input <path> --output <path>
momocat translate file --db <path> --project-id <id> --input <path> --output <path> --resume
```

Repository-local development can expose a short helper:

```bash
npm run cli -- inspect projects --db <path>
npm run cli -- inspect localization --db <path> --project-id <id> --input <path> --output <path>
npm run cli -- translate file --db <path> --project-id <id> --input <path> --output <path>
```

This helper is only a development convenience. The documented product shape is
`momocat ...`.

The old npm-script command names are not preserved as compatibility aliases:

```text
inspect:projects
inspect:localization
translate:file
```

Root `package.json` should stop being a hidden CLI surface. It may keep one
generic `cli` script, but product commands live in `apps/cli`.

## Dependency Boundary

The allowed app dependency graph is:

```text
apps/cli     -> @cat/localization -> @cat/db -> @cat/core
apps/desktop -> @cat/localization -> @cat/db -> @cat/core
```

The forbidden dependency graph is:

```text
apps/cli -> apps/desktop
apps/cli -> @cat/db
apps/cli -> @cat/core
apps/desktop -> apps/cli
@cat/localization -> apps/cli
```

`apps/cli/package.json` should declare `@cat/localization` as its only internal
workspace dependency. CLI types that need to cross the app boundary should be
exported by `@cat/localization`; `apps/cli` must not reach through to `@cat/db`,
`@cat/core`, or desktop source paths.

Architecture guardrails should enforce this boundary:

- `apps/cli/src` must not import `apps/desktop/src`.
- `apps/cli/src` must not import `@cat/db` or `packages/db/src`.
- `apps/cli/src` must not import `@cat/core` or `packages/core/src`.
- `apps/desktop/src` must not import `apps/cli/src`.
- `packages/localization/src` must not import `apps/cli/src`.

Existing localization-to-desktop guardrails remain in force.

## Package Responsibilities

### `apps/cli`

Owns:

- `momocat` bin entrypoint
- command dispatch
- command help text
- CLI argument parsing
- CLI option validation such as missing values, unknown flags, and positive
  integer checks
- stdout and stderr formatting
- JSON/text presentation
- process exit behavior
- CLI command tests

Does not own:

- SQLite queries
- provider catalog or runtime config behavior
- TM/TB/MT orchestration
- prompt composition
- response parsing
- checkpoint, event, snapshot, or artifact behavior
- desktop IPC or renderer behavior

Suggested structure:

```text
apps/cli/
  package.json
  tsconfig.json
  src/
    index.ts
    commands/
      inspectProjectsCommand.ts
      inspectLocalizationCommand.ts
      translateFileCommand.ts
    parse/
      args.ts
    output/
      formatProjects.ts
```

### `@cat/localization`

Owns the command behavior behind the CLI:

- `runInspectProjectsCommand`
- `runInspectLocalizationCommand`
- `runTranslateFileCommand`
- typed result shapes for CLI and future API consumers
- project readiness inspection
- mounted TM/TB resource inspection
- provider status inspection without leaking API keys
- file localization inspection
- resumable file translation

`runInspectLocalizationCommand` and `runTranslateFileCommand` already exist and
remain in `@cat/localization`. `inspect projects` should be moved out of the
root script and exposed through `@cat/localization` so the CLI does not read the
database directly.

### `scripts/`

Root `scripts/` no longer owns CLI product behavior.

The following CLI-related files should move out of root scripts:

```text
scripts/inspect-projects.mjs
scripts/inspect-projects.test.mjs
scripts/inspect-localization.mjs
scripts/inspect-localization-runner.mjs
scripts/inspect-localization.test.mjs
scripts/translate-file.mjs
scripts/translate-file-runner.mjs
scripts/translate-file.test.mjs
```

If any test helper is still useful, move it into `apps/cli` or colocate it near
the package code it verifies. Do not leave root-level CLI implementation behind.

## Data Flow

```text
momocat argv
  -> apps/cli command parser
  -> @cat/localization command API
  -> LocalizationEngine / LocalizationInspector / project inspection service
  -> @cat/db + @cat/core
  -> typed result
  -> apps/cli formatter
  -> stdout/stderr + exit code
```

The CLI formats outputs, but it does not compute localization behavior.

For `inspect projects`, text output belongs in `apps/cli` because it is
presentation. JSON output should serialize the typed result returned by
`@cat/localization`.

## Error Handling

Make command behavior predictable for agents:

- Parameter errors exit with code `1`, write one clear stderr line, and point to
  the relevant help command.
- Runtime errors exit with code `1` and write the error message to stderr.
- Stack traces are not printed by default. A later `--debug` option may enable
  them.
- JSON mode writes only JSON to stdout. Errors still go to stderr.
- API keys are never printed. Inspect output may include `apiKeySet` and
  `apiKeyLast4` only.
- `translate file --progress-stdout` keeps stdout reserved for NDJSON progress
  events. Any non-progress diagnostics should go to stderr.

## Testing

Add focused tests at the package boundary that owns the behavior.

`@cat/localization` tests:

- `runInspectProjectsCommand` returns project, language, file, TM, TB, and
  provider readiness data.
- `runInspectProjectsCommand` supports project filtering.
- API keys are not leaked in typed results.
- existing `runInspectLocalizationCommand` and `runTranslateFileCommand` tests
  continue to cover localization command behavior.

`apps/cli` tests:

- `momocat --help` and command-specific help work.
- unknown command and unknown option errors are clear.
- `inspect projects` maps args to `runInspectProjectsCommand`.
- `inspect localization` maps args to `runInspectLocalizationCommand`.
- `translate file` maps args to `runTranslateFileCommand`.
- JSON mode writes machine-readable JSON to stdout.
- text mode preserves the current human-readable information, adjusted only for
  the new `momocat` command grammar.

Validation commands:

```bash
npm run build --workspace=packages/localization
npm run build --workspace=apps/cli
npm test --workspace=apps/cli
npx vitest run packages/localization/src/cli
npm run gate:arch
```

If the implementation keeps CLI tests on Vitest, this matches the rest of the
repo. If the implementation uses Node's built-in test runner for CLI process
tests, keep that decision local to `apps/cli` and document the command in its
package scripts.

## Documentation Updates

Update:

- `DOCS/00_START_HERE.md`
- `DOCS/10_ARCHITECTURE.md`
- `DOCS/agent-first/CLI.md`
- `DOCS/40_STATUS_AND_ROADMAP.md` if current priorities or command references
  change

The docs should present `momocat ...` as the primary CLI shape and mention
`npm run cli -- ...` only as a repository-local development convenience.

## Non-Goals

This extraction does not:

- add new localization features
- redesign Window Mode
- migrate legacy desktop GUI AI workflows
- add desktop UI for the new CLI
- introduce a long-lived root script compatibility layer
- let `apps/cli` import desktop, `@cat/db`, or `@cat/core`

## Acceptance Criteria

- `apps/cli` exists as a workspace app.
- `apps/cli` exposes a `momocat` bin.
- The first command set is `inspect projects`, `inspect localization`, and
  `translate file`.
- Root CLI implementation files are removed or moved.
- Root `package.json` no longer exposes the old CLI product scripts.
- `apps/cli` depends on `@cat/localization` and not on `apps/desktop`,
  `@cat/db`, or `@cat/core`.
- Architecture guardrails enforce the CLI dependency boundary.
- The three migrated commands preserve existing behavior except for the command
  grammar changing to `momocat ...`.
- Tests cover the new package boundary and command surface.
