# Development

## Prerequisites and setup

The repository pins Node.js `20.19.0` and npm `10.8.2` through Volta. Use those versions unless a runtime upgrade changes `package.json` and is validated across desktop, CLI, native modules, and packaging.

```bash
npm ci
```

`postinstall` rebuilds `better-sqlite3` for Electron. Development data is written under `.cat_data/` and must remain untracked.

Start the desktop app:

```bash
npm run dev
```

Build the shared localization package and CLI:

```bash
npm run build:cli
npm --silent run cli -- --help
```

## Command map

The root `package.json` is the command source of truth.

| Command                         | Purpose                                                                   |
| ------------------------------- | ------------------------------------------------------------------------- |
| `npm run dev`                   | Rebuild Electron native modules and start Electron/Vite development.      |
| `npm test`                      | Rebuild native modules for host Node and run all Vitest suites once.      |
| `npm run test:watch`            | Run Vitest in watch mode.                                                 |
| `npm run test:db-schema`        | Rebuild for host Node and run focused DB schema/facade tests.             |
| `npm run typecheck`             | Type-check the desktop workspace.                                         |
| `npm run lint`                  | Run workspace lint scripts.                                               |
| `npm run docs:check`            | Validate document structure, links, scripts, release, and schema markers. |
| `npm run test:scripts`          | Run every Node test under `scripts/`.                                     |
| `npm run ai-prompts:generate`   | Regenerate the TypeScript catalog from prompt Markdown sources.           |
| `npm run ai-prompts:check`      | Fail when the generated prompt catalog is stale.                          |
| `npm run gate:arch`             | Enforce package/service architecture guardrails.                          |
| `npm run gate:style`            | Enforce renderer style-class rules.                                       |
| `npm run gate:file-size`        | Enforce large-file thresholds.                                            |
| `npm run gate:check`            | Run the repository quality gate.                                          |
| `npm run build`                 | Rebuild native modules and build the desktop app.                         |
| `npm run build:cli`             | Build `@cat/localization` and the CLI bundle.                             |
| `npm run rebuild:electron`      | Bind native modules to Electron.                                          |
| `npm run rebuild:test`          | Bind native modules to host Node for Vitest/scripts.                      |
| `npm run pack:win` / `pack:mac` | Build and package on the matching native platform.                        |

Focused diagnostics:

| Command                              | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `npm run test:tm-flow`               | Focused TM match-flow regression.                          |
| `npm run trace:tm-flow -- …`         | Inspect mounted TMs, recall, scoring, and final selection. |
| `npm run trace:tb-flow -- …`         | Inspect TB matching.                                       |
| `npm run trace:ai-file -- …`         | Inspect desktop AI file-flow behavior.                     |
| `npm run smoke:momocat -- --dry-run` | Preview standard CLI smoke commands.                       |

## Diagnostic playbooks

Use a trace after a focused test or reproducible project case shows which boundary is failing. Traces are evidence collectors, not substitutes for regression tests. Their output can contain source/target text, project and resource names, prompt references, and provider results; do not paste it into issues, docs, or commits without redaction.

TM and TB traces open the selected SQLite database and run the real desktop matching service without calling an AI provider. They are intended to inspect matching, not to update translations, but `CATDatabase` is not a forensic read-only connection. Prefer a copied database for irreplaceable or production-derived data. The AI file trace and non-dry-run CLI smoke are mutating workflows and may call a configured provider.

### TM match trace

Use this when an active segment has a missing, extra, or incorrectly ranked TM/concordance suggestion. Use `--segment-id` first for a real failure because it preserves stored tokens and `srcHash`; use `--source` to isolate normalization and recall with synthetic text.

```bash
npm run trace:tm-flow -- --project-id <id> --segment-id <segment-id>
npm run trace:tm-flow -- --project-id <id> --source "<source text>"
```

The default database is `.cat_data/cat_v1.db`; select another with `--db <path>`. For synthetic text, `--src-hash <hash>` exercises exact-hash lookup. `--focus-src-hash <hash[,hash]>` adds focused summary buckets without changing matching. Recall debug events are included by default and can be suppressed with `--no-recall-debug`.

Read the JSON in order:

| Field                    | Boundary proved                                                                  |
| ------------------------ | -------------------------------------------------------------------------------- |
| `step0MountedTMs`        | Expected TMs are mounted, enabled, prioritized, and permissioned.                |
| `step1SourceText`        | Token display text and normalization match the failing segment.                  |
| `step2ExactHash`         | Exact `srcHash` lookup returns the expected entries.                             |
| `step3FuzzyRecall`       | Repository fuzzy recall produces candidates.                                    |
| `step4ConcordanceRecall` | Concordance recall produces phrase/token candidates.                            |
| `step5CandidateScoring`  | Evidence gates, similarity, and ranking accept or reject each candidate.         |
| `step6FinalMatches`      | The public `TMService.findMatches` result contains the expected ordered matches. |
| `recallDebugEvents`      | Lower-level recall decisions explain why candidate generation widened or pruned. |

If the resource is missing at step 0, debug project mounting or language/resource state. If it disappears in steps 2–4, debug hashing, normalization, or repository recall. If it is recalled but absent at step 6, debug evidence/scoring/dedup. If step 6 is correct but the UI or prompt is wrong, move downstream to IPC, renderer state, or prompt selection instead of widening recall.

### TB match trace

Use this when a mounted term is missing, overmatching, or appearing with the wrong target. As with TM, prefer `--segment-id` for the real stored-token case and `--source` for a minimal synthetic reproduction.

```bash
npm run trace:tb-flow -- --project-id <id> --segment-id <segment-id>
npm run trace:tb-flow -- --project-id <id> --source "<source text>"
```

`--focus-src-term <term[,term]>` and `--focus-tgt-term <term[,term]>` add focused views; they do not restrict or alter matching. Read the output as: project and mounted TB state (`step0Project`, `step0MountedTBs`), real source/tokens (`step1SourceText`), FTS/exact search plan (`step2SearchPlan`), repository candidates (`step3RepoCandidateRecall`), bounded fallback decision (`step4FallbackScan`), candidate-level recognizer decisions (`step5CandidateFinalMatching`), then the public result (`step6FinalMatches`). The first step where the term disappears owns the investigation.

### AI file-flow trace

Use this only after isolated TM/TB matching is correct but desktop AI translation still receives the wrong references, uses the wrong file/project/provider configuration, or fails between preview and persistence.

```bash
npm run trace:ai-file -- --project-id <id> --file-id <id>
```

This command runs the real legacy desktop AI translation path against the configured provider and writes translation results. `--file <path>` additionally imports that spreadsheet into the project before translation. Use a disposable project/database copy, start with the default `blank-only` target scope, and use `overwrite-non-confirmed` only when overwriting existing non-confirmed targets is intentional. `--project-name` requires an exact unique name; explicit IDs are safer for automation.

Each JSON line is an event. Verify `ai_file_flow_start`, mounted resources, leading-segment `ai_file_flow_reference_preview` events, progress, and `ai_file_flow_complete` in order. An `ai_file_flow_imported_file` event appears only with `--file`. If references are already wrong in the preview, return to the TM/TB trace; if previews are correct, investigate request planning, provider response handling, or persistence.

### CLI smoke

Use `npm run smoke:momocat -- --dry-run` to validate configuration and preview exact CLI commands without executing them. Use `--inspect-only` for no-request readiness/inspection. A normal run builds the CLI, performs inspect plus translation, may call a provider, and writes output/checkpoint/event/artifact files. Keep machine paths and provider metadata only in the gitignored `.momocat-smoke.local.json`, created from `.momocat-smoke.example.json`.

## Validation strategy

Run the narrowest relevant check while developing. For broad or cross-boundary work, run the full audit before editing when practical and again before handoff so baseline failures can be distinguished from regressions.

| Changed area                   | Minimum focused validation                                          |
| ------------------------------ | ------------------------------------------------------------------- |
| Documentation only             | `npm run docs:check`                                                |
| Root automation in `scripts/`  | `npm run test:scripts` plus the affected command's dry run/check    |
| Prompt Markdown/catalog        | `npm run ai-prompts:generate`, then `npm run ai-prompts:check`      |
| `@cat/core` algorithm/contract | Adjacent Vitest file, then `npm test` when the contract is shared   |
| DB schema/bootstrap            | `npm run test:db-schema`                                            |
| DB repository                  | Its adjacent repository tests plus affected service tests           |
| `@cat/localization` or CLI     | Affected tests and `npm run build:cli`                              |
| Desktop IPC/preload            | Handler tests, preload API tests, and `npm run typecheck`           |
| Renderer/editor behavior       | Component/hook tests and desktop smoke e2e when interaction changed |
| Packaging/update behavior      | `npm run build`, then the platform-native pack command              |

The full repository audit is:

```bash
npm run gate:check
```

Its maintained order is:

1. `docs:check`
2. `test:scripts`
3. `ai-prompts:check`
4. desktop `typecheck`
5. `gate:arch`
6. `gate:style`
7. `gate:file-size`
8. workspace `lint`
9. large-file TM smoke test

Interpret the audit honestly:

- If it is green before work, any new failure is a regression until proven otherwise.
- If it is not green before work, record the failing stage and concise error before editing. Afterward, show that focused checks pass and that unrelated baseline failures did not expand.
- Never report `gate:check` as passed when it stopped early or when its stages were run selectively.
- Do not broaden a scoped task merely to repair unrelated baseline debt.

`gate:check` does not replace `npm test` or desktop e2e. Choose them based on behavioral risk.

There is currently no tracked `.github/workflows` directory. Do not assume a remote CI gate has run; record and run the required local validation until CI is added.

## Test organization

- Keep unit, behavior, and integration tests adjacent to the implementation.
- Use `*.test.ts` / `*.test.tsx`; keep Playwright suites under `apps/desktop/e2e`.
- Test public behavior and boundary contracts, not only private helpers.
- When splitting a large facade, preserve the external contract and add tests around the extracted workflow.
- Schema work must cover empty bootstrap, current-v15 reopen, additive maintenance, and non-current rejection.

## Native module ABI

Electron and host Node use different ABIs for `better-sqlite3`.

- Before desktop dev/build/pack: `npm run rebuild:electron`.
- Before Node-based tests and DB scripts: `npm run rebuild:test`.
- The root `dev`, `build`, and `test` commands already choose the appropriate rebuild.

If a native module suddenly fails to load after switching between desktop and tests, rebuild for the command you are about to run instead of reinstalling blindly.

## Desktop e2e and packaging

```bash
npm run test:e2e:smoke --workspace=apps/desktop
npm run test:e2e --workspace=apps/desktop
```

Use smoke first for editor/renderer regressions. Full e2e is appropriate for broader cross-window or project workflows.

Packaging must run on its target platform:

```bash
# Windows only
npm run pack:win

# macOS only
npm run pack:mac
```

`npm run pack` packages only for the current host. It is not cross-platform release signoff.

Desktop icon source and generated assets are tracked under `apps/desktop/build`. Change `icon-source.png`, then regenerate `icon.png`, `icon.icns`, and `icon.ico` on macOS with `python3 scripts/generate_app_icon.py`; the generator requires `sips`. Run `node --test scripts/app-icon-assets.test.mjs` after regeneration.

For a release, keep the root and desktop package versions aligned, update the visible app version marker and its test, then validate the native installer. Windows publishing uses `npm run release:win` with `GH_TOKEN` in the environment.

## Schema and contract changes

Before changing persistence, read [Data model](DATA_MODEL.md). Before changing request modes, prompts, tags, or matching, read [Localization](LOCALIZATION.md).

Changes to `ProjectService`, IPC, preload, `CATDatabase`, or shared public types require same-change contract tests. Keep renderer, preload, IPC, and service signatures synchronized.

## Worktrees

To reuse an existing dependency tree in a worktree:

```bash
npm run worktree:deps:link
```

If the worktree already has `node_modules`, use `npm run worktree:deps:link:force`. On Windows the script can fall back from a directory symlink to a junction. The source checkout must already have installed dependencies.

## Script ownership and maintenance

Keep `scripts/` small and executable through stable root commands. An operator-facing script must have an npm entrypoint and documentation here; a helper must be imported by an entrypoint or test. Add a `*.test.mjs` contract for argument parsing, dry-run behavior, generated assets, or guardrail logic where applicable; `npm run test:scripts` discovers all such tests. Do not keep platform-specific duplicates after a cross-platform replacement exists.

| Responsibility       | Maintained files                                                                                                                                                                                | Stable entrypoint                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Documentation/quality gates | `check-docs.mjs`, `gate-architecture-check.mjs`, `gate-style-classes.mjs`, `gate-file-size.mjs`, and adjacent Node tests                                                                 | `docs:check`, `gate:*`, `test:scripts`              |
| Focused diagnostics  | `tm-match-flow-trace.mjs`, `tb-match-flow-trace.mjs`, `ai-file-flow-trace.mjs`, `momocat-standard-smoke.mjs`                                                                                    | `trace:*`, `smoke:momocat`                          |
| Prompt generation    | `generate-ai-prompt-templates.mjs`, helper `ai-prompt-template-generator.mjs`                                                                                                                   | `ai-prompts:generate`, `ai-prompts:check`           |
| App icon generation  | `generate_app_icon.py`, `app-icon-assets.test.mjs`                                                                                                                                              | macOS generator command above, then `test:scripts`  |
| Native build/release | `rebuild-electron.mjs`, `pack-platform.mjs`, `pack-platform.test.mjs`                                                                                                                           | `rebuild:electron`, `pack:win`, `pack:mac`          |
| Worktree dependency reuse | `worktree-link-deps.mjs`                                                                                                                                                                   | `worktree:deps:link`                                |

Prompt Markdown under `packages/core/src/project/prompts` is the editable source; `aiPromptTemplateCatalog.generated.ts` is generated output. Never edit the generated catalog directly. Regenerate it in the same change and let `ai-prompts:check` prove it is current.

Before deleting a script, confirm that it has no package command, import, test, documentation link, or external release role and identify the maintained replacement. Retire the script, command, tests, and owning documentation together. Before adding one, prefer extending an existing entrypoint and document when an agent should invoke it.

## Documentation workflow

Update the owning topic document when behavior, public contracts, commands, schema, or boundaries change. Do not add permanent specs, plans, status reports, or dated review files. Temporary planning stays with the task/PR and is deleted once durable facts are absorbed.

Run:

```bash
npm run docs:check
```

See [Documentation](README.md) for ownership and content rules.

## Failure triage

- Type errors: fix the public contract first, then its callers.
- `gate:arch`: compare the import/delegation with the guardrail file; change the guard only for an intentional new boundary.
- `gate:file-size`: split by responsibility behind a stable facade; avoid allowlist growth.
- DB startup: confirm the schema marker and required shape before treating it as data corruption.
- TM/TB mismatch: use the trace scripts to separate resource mounting, recall, scoring, and final selection.
- CLI provider failure: run `momocat env` and inspect before sending real requests.
- Pack failure: first confirm normal build/tests and native ABI, then debug the platform pack step.
