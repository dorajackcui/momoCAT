# MT Module

## Purpose

`MTModule` coordinates machine translation behavior inside the agent-first engine. It resolves provider configuration, calls the provider transport, validates translated tokens, and records prompt artifacts for inspect and diagnostics.

Pure prompt and response capability belongs in `@cat/core`. Window Mode contracts, builders, response parsers, and schema validation live under `@cat/core/project` initially or a future `@cat/core/mt` slice. `@cat/localization` consumes those pure helpers while owning request orchestration and recovery.

Current MT Window Mode design:

- `DOCS/superpowers/specs/2026-05-20-mt-window-mode-design.md`

Earlier next-direction record:

- `DOCS/superpowers/specs/2026-05-20-agent-first-cli-mt-next-direction-design.md`

Code:

- `packages/localization/src/modules/MTModule.ts`
- `packages/localization/src/modules/MTModule.test.ts`

## Boundary

`MTModule` owns:

- Provider configuration resolution.
- Prompt orchestration from structured inputs and core prompt builders.
- Provider request dispatch through the AI transport.
- Response trimming and tag validation.
- Prompt artifacts for inspect and opt-in diagnostics.

MT resolves `projects.aiModel` as a configured provider id, then resolves that
provider through its connection to obtain `baseUrl`, API key, model, and
chat-completions protocol.

`MTModule` does not own:

- Pure prompt template contracts.
- Pure batch prompt builders.
- Pure response JSON parsers or schema validators.
- File parsing or file writing.
- TM lookup.
- TB lookup.
- Checkpoint storage.
- Progress event persistence.
- Final XLSX snapshot timing.

## Inputs

The MT layer receives structured context from the engine:

- Project configuration.
- A transient `Segment`.
- Source and target language.
- `TMArtifact` from `TMModule`.
- `TBArtifact` from `TBModule`.
- MT options such as provider, model, reasoning effort, system prompt, and temperature.
- Resolved provider config when sending real requests.

The important rule is that MT consumes TM/TB artifacts. It should not query TM or TB itself.

For Window Mode, the MT layer receives a structured batch input instead of spreadsheet rows:

- 1 to 5 current units requiring translation.
- Up to 5 previous translated context units.
- Up to 5 next source context units.
- Per-current-unit TM artifacts.
- Per-current-unit TB artifacts.
- Stable `documentId + unitId` identifiers for response mapping.

Context units are prompt context only. They must not require provider output.

## Outputs

Prompt-only inspect:

```text
MTModule.composePrompt(...) -> PromptArtifact
```

Real translation:

```text
MTModule.translate(...) -> {
  targetTokens,
  prompt
}
```

Window Mode translation:

```text
MT batch orchestration -> {
  results: Array<{ documentId, unitId, targetTokens }>,
  prompt
}
```

The prompt artifact may include:

- Provider id, name, and base URL.
- Model and reasoning effort.
- Project prompt and project type.
- Source payload.
- TM prompt block.
- Concordance prompt block.
- TB prompt block.
- Full system prompt.
- Full user prompt.
- Prompt character counts.

The prompt artifact must not include API keys.

## Current Request Model

`momocat translate file` job mode now uses Window Mode by default. It plans an ordered file into batches of 1 to 5 current units, sends one provider request at a time for that file, parses a strict JSON response, and writes per-unit results through the existing job surfaces.

Current flow:

```text
one ordered file
  -> WindowModeTaskPlanner batches 1..5 current units
  -> one provider request at a time
  -> strict JSON response
  -> per-unit UnitResult/checkpoints/events/snapshots/final output
```

Same-file provider requests are not concurrent. Later batches wait for earlier batches to finish so previous translated context is real target output from completed or skipped units. Next source context comes from following source rows. Each current unit keeps its own TM, TB, Concordance, and surrounding context.

There are two retry layers today:

- Job retry: `TranslationJobRunner` retries failed tasks up to `maxAttempts`.
- MT validation retry: `MTModule` can retry internally when tag validation fails.

If request scheduling changes, keep these two ideas explicit: job-level recovery and MT-level response repair are different concerns.

## Window Mode Request Model

The Window Mode scheduler sends 1 to 5 current segments in one provider request, plus previous translated context and next source context. This does not change the file API or checkpoint format.

Request shape:

```text
Several JobUnits
  -> one TranslationTask
  -> one MT request batch
  -> several UnitResult records
  -> per-unit checkpoints
```

Requirements for grouped requests:

- Include up to 5 previous translated context units and up to 5 next source context units.
- Include TM/TB references for each current unit.
- Return one result per requested unit, identified by `documentId + unitId`.
- Allow results to arrive out of order.
- Keep checkpoint writes per unit.
- Keep progress events per unit plus optional task-level events later.
- Persist prompt artifacts only when artifact capture is enabled.
- Include batch metadata in artifacts only when useful for diagnostics.
- Keep same-file provider requests ordered and sequential. Reintroduce bounded request concurrency only after a later explicit design.

## Inspect Contract

Inspect flows are the main way to understand prompt changes without sending provider requests.

`momocat inspect localization` should remain able to show:

- `_tm_for_mt`
- `_tb_for_mt`
- `_mt_user_prompt`
- `MT_SystemPrompt`
- Full JSON sidecar artifacts

Normal translation should stay clean:

- No prompt artifact JSONL by default.
- Use `momocat translate file --artifacts <path>` only for diagnostic translation runs.

## Refactor Checklist

When changing prompt composition or request mode:

- Update or add `@cat/core` prompt/response tests for pure builders, parsers, and validators.
- Update `MTModule.test.ts`.
- Run `LocalizationInspector.test.ts` if prompt artifacts changed.
- Run `LocalizationEngine.test.ts` if task execution changed.
- Run `TranslationJobRunner.test.ts` if task/result semantics changed.
- Smoke with `momocat inspect localization` before real MT smoke.
- Use real `momocat translate file` smoke only when sending source text and TM/TB context to the configured provider is intended.

## Design Guardrails

- Do not make prompt composition depend on spreadsheet row shape.
- Do not make CLI scripts assemble TM/TB references, prompt policy, or provider response parsing.
- Do not put new agent-first MT batching behavior into the legacy desktop GUI workflow.
- Do not let provider request batching change the external file API.
- Do not write large prompt payloads to progress events.
- Do not use artifacts for resume decisions.
- Keep request scheduling replaceable behind the task/executor boundary.
