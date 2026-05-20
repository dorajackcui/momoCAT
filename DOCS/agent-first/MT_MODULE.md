# MT Module

## Purpose

`MTModule` owns machine translation behavior inside the agent-first engine. It is the right place to change prompt composition, provider request shape, response validation, and future request grouping.

Code:

- `packages/localization/src/modules/MTModule.ts`
- `packages/localization/src/modules/MTModule.test.ts`

## Boundary

`MTModule` owns:

- Provider configuration resolution.
- Prompt composition from structured inputs.
- Provider request dispatch through the AI transport.
- Response trimming, parsing, and tag validation.
- Prompt artifacts for inspect and opt-in diagnostics.

`MTModule` does not own:

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

The current MVP task executor accepts one unit per task. The job runner still uses task abstractions so this can evolve.

Today:

```text
One JobUnit
  -> one TranslationTask
  -> one LocalizationEngine task execution
  -> one MTModule.translate call
  -> one provider request sequence for that segment
```

There are two retry layers today:

- Job retry: `TranslationJobRunner` retries failed tasks up to `maxAttempts`.
- MT validation retry: `MTModule` can retry internally when tag validation fails.

If request scheduling changes, keep these two ideas explicit: job-level recovery and MT-level response repair are different concerns.

## Future Batch Request Model

A future MT scheduler may send five segments in one provider request. That should not require changing the file API or checkpoint format.

Target shape:

```text
Several JobUnits
  -> one TranslationTask
  -> one MT request batch
  -> several UnitResult records
  -> per-unit checkpoints
```

Requirements for grouped requests:

- Return one result per requested unit, identified by `documentId + unitId`.
- Allow results to arrive out of order.
- Keep checkpoint writes per unit.
- Keep progress events per unit plus optional task-level events later.
- Persist prompt artifacts only when artifact capture is enabled.
- Include batch metadata in artifacts only when useful for diagnostics.

The job runner already canonicalizes result identity from planned units. The remaining work is to replace the one-unit task executor path with a batch-capable planner and executor.

## Inspect Contract

Inspect flows are the main way to understand prompt changes without sending provider requests.

`inspect:localization` should remain able to show:

- `_tm_for_mt`
- `_tb_for_mt`
- `_mt_user_prompt`
- `MT_SystemPrompt`
- Full JSON sidecar artifacts

Normal translation should stay clean:

- No prompt artifact JSONL by default.
- Use `translate:file --artifacts <path>` only for diagnostic translation runs.

## Refactor Checklist

When changing prompt composition or request mode:

- Update `MTModule.test.ts`.
- Run `LocalizationInspector.test.ts` if prompt artifacts changed.
- Run `LocalizationEngine.test.ts` if task execution changed.
- Run `TranslationJobRunner.test.ts` if task/result semantics changed.
- Smoke with `inspect:localization` before real MT smoke.
- Use real `translate:file` smoke only when sending source text and TM/TB context to the configured provider is intended.

## Design Guardrails

- Do not make prompt composition depend on spreadsheet row shape.
- Do not let provider request batching change the external file API.
- Do not write large prompt payloads to progress events.
- Do not use artifacts for resume decisions.
- Keep request scheduling replaceable behind the task/executor boundary.
