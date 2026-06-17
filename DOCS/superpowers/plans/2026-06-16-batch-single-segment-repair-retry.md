# Batch Single-Segment Repair Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the first Window / Window Partial request as a batch, but when tag or placeholder validation fails for individual batch results, retry only those failed segments through the existing legacy single-segment request path. Preserve successful batch results and avoid changing CJK profile, TM/TB lookup, concordance, or custom/tag-policy-none behavior.

**Architecture:** `MTModule.translateBatch()` remains the batch entrypoint and becomes responsible for per-result validation and repair routing. Failed results are repaired by calling `MTModule.translate()` with the original unit data, the invalid batch target as current translation, and segment-specific validation feedback. Request-mode strategies consume optional per-result prompt artifacts so repaired units record the actual single-segment repair prompt while untouched batch units keep the batch prompt.

**Tech Stack:** TypeScript, Vitest, `packages/localization`, existing AI prompt template plumbing from `packages/core`.

---

## Current Behavioral Contract

- Window Mode and Window Partial Mode still send one normal batch request for the window.
- A successful batch result is kept as-is and is not resent.
- Only batch results that fail `TagValidator.validate(sourceTokens, targetTokens)` are resent individually.
- The repair retry uses `MTModule.translate()`, so it inherits the legacy single-segment retry behavior and its existing maximum attempts.
- The repair request includes the invalid target as `currentTranslationPayload`, plus validation feedback and a repair instruction.
- The repair request does not include other segments, other targets, whole-batch JSON, or whole-batch validation details.
- JSON parse errors, missing response ids, and unknown response ids still fail the batch and flow to the outer task retry.
- `custom` projects and `tagPolicy: 'none'` keep current behavior with no tag validation or repair.
- CJK profile behavior is not changed: this plan touches retry routing after model output parsing, not TM/TB retrieval or text profile tokenization.

## Task 1: Thread Repair Prompt Fields Through Single-Segment Prompt Composition

- [ ] Add a failing test in `packages/localization/src/modules/MTModule.test.ts` proving `MTModule.composePrompt()` can emit current-translation repair context.
  - Use an existing `module.composePrompt(...)` test pattern.
  - Pass:
    - `currentTranslationPayload: 'Broken translation'`
    - `refinementInstruction: 'Repair only the placeholder mismatch.'`
    - `validationFeedback: 'Missing marker: {1}'`
  - Assert the returned `userPrompt` contains:
    - `Current Translation:`
    - `Broken translation`
    - `Refinement Instruction:`
    - `Repair only the placeholder mismatch.`
    - `Validation feedback from previous attempt:`
    - `Missing marker: {1}`
  - Expected red signal before implementation: TypeScript rejects the new fields on `ComposePromptInput` or the prompt does not include them.

- [ ] Extend single-segment prompt types in `packages/localization/src/modules/MTModuleTypes.ts`.
  - Add optional fields to `ComposePromptInput`:
    - `currentTranslationPayload?: string`
    - `refinementInstruction?: string`
  - Add the same optional fields to `TranslatePreparedPromptInput`.
  - Keep the fields optional so all existing call sites remain source-compatible.

- [ ] Pass the fields through `MTModule.buildPromptParams()` in `packages/localization/src/modules/MTModule.ts`.
  - Include `currentTranslationPayload: input.currentTranslationPayload`.
  - Include `refinementInstruction: input.refinementInstruction`.
  - Do not alter TM/TB, concordance, source/target language, or project-profile selection logic.

- [ ] Run the focused test for this task:
  ```powershell
  npx vitest run packages/localization/src/modules/MTModule.test.ts
  ```
  - Expected green signal after implementation: the new prompt-threading test passes.

## Task 2: Replace Whole-Batch Validation Retry With Single-Segment Repair

- [ ] Replace the existing batch tag-validation retry test in `packages/localization/src/modules/MTModule.test.ts`.
  - Target the current test named like `returns the successful Window Mode retry prompt after batch tag validation feedback`.
  - New scenario:
    - Two units in one batch.
    - Unit 1 source contains a required placeholder or tag marker, for example `Save {1}`.
    - Unit 2 source is ordinary text, for example `Close`.
    - First transport response is a valid batch JSON response:
      - `r1` target misses the marker, for example `Enregistrer`.
      - `r2` target is valid, for example `Fermer`.
    - Second transport response is a single-segment repair response for unit 1 only:
      - `Enregistrer {1}`.
  - Assert:
    - `transport.createResponse` is called exactly twice.
    - Request 1 is the batch prompt.
    - Request 2 is a single-segment prompt.
    - Request 2 contains `Current Translation:` and the invalid target `Enregistrer`.
    - Request 2 contains `Refinement Instruction:`.
    - Request 2 contains validation feedback.
    - Request 2 does not contain the second unit id or second target.
    - Final result order remains unit 1 then unit 2.
    - Unit 1 target is repaired.
    - Unit 2 target is preserved from the batch.
    - Unit 1 result has `prompt` equal to the single repair prompt.
    - Unit 2 result has no per-result `prompt`.
    - The batch-level `prompt` remains the first batch prompt.
  - Expected red signal before implementation: current code sends a second batch request and records the batch retry prompt.

- [ ] Add one focused failure-path test in `packages/localization/src/modules/MTModule.test.ts`.
  - Scenario:
    - First batch response has one invalid result.
    - The single repair path returns invalid output for all of its existing single-segment attempts.
  - Assert:
    - `translateBatch()` rejects with the existing single-segment validation failure shape.
    - Only the invalid unit is retried.
    - The successful batch unit is not resent.
  - Expected red signal before implementation: whole-batch retry resends every unit.

- [ ] Add optional prompt support to `MTBatchUnitResult` in `packages/localization/src/modules/MTModuleTypes.ts`.
  - Add `prompt?: PromptArtifact`.
  - This field means "this unit used a prompt different from the batch prompt," currently only for repaired batch units.

- [ ] Refactor validation in `MTModule.translateBatch()` in `packages/localization/src/modules/MTModule.ts`.
  - Keep existing batch request construction and response parsing.
  - Keep response id normalization and `responseIdMap` behavior intact.
  - After parsing valid batch JSON, validate each mapped result once.
  - If `input.project.type === 'custom'` or effective `tagPolicy === 'none'`, skip validation and return the parsed batch results exactly as today.
  - Build a list of invalid results with:
    - original unit input
    - parsed batch result
    - validation messages
  - If the invalid list is empty, return the batch result as today.
  - If the invalid list is non-empty, repair only those units with `this.translate(...)`.

- [ ] Implement a private helper in `MTModule.ts` for repairing invalid batch units.
  - Suggested shape:
    ```ts
    private async repairInvalidBatchResult(
      input: TranslateBatchInput,
      unit: MTBatchCurrentUnitInput,
      parsedResult: MTBatchUnitResult,
      validationFeedback: string,
      tagPolicy: TagPolicy
    ): Promise<MTBatchUnitResult>
    ```
  - The helper calls `this.translate()` with:
    - `project: input.project`
    - `segment: unit.segment`
    - `tm: unit.tm`
    - `tb: unit.tb`
    - `provider: input.provider`
    - `model: input.model`
    - `tagPolicy`
    - `srcLang: input.srcLang`
    - `tgtLang: input.tgtLang`
    - `translationStyle: input.translationStyle`
    - `unitId: unit.unitId`
    - `validationFeedback`
    - `currentTranslationPayload: serializeTokensToDisplayText(parsedResult.targetTokens)`
    - `refinementInstruction: 'Repair this translation only. Preserve the existing translation where possible, but fix the validation issues below.'`
  - Convert the single result back to an `MTBatchUnitResult`:
    - `responseId: parsedResult.responseId`
    - `unitId: unit.unitId`
    - `targetTokens: repaired.targetTokens`
    - `prompt: repaired.prompt`
  - Preserve the original response id so Window Mode mapping stays stable.

- [ ] Remove whole-batch retry-on-validation from `translateBatch()`.
  - Batch-level retry should not be used for per-result tag/placeholder validation failures.
  - Keep thrown errors for malformed batch responses, missing ids, and unknown ids.
  - Let failed single repairs throw through to the existing outer task retry.

- [ ] Run the focused module test:
  ```powershell
  npx vitest run packages/localization/src/modules/MTModule.test.ts
  ```
  - Expected green signal: single repair tests pass, existing single-segment retry tests still pass, and tag-policy-none behavior remains unchanged.

## Task 3: Record the Actual Prompt Per Artifact in Window Strategies

- [ ] Add a failing artifact-prompt test in `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`.
  - Mock `mtModule.translateBatch()` to return:
    - batch-level `prompt: batchPrompt`
    - result 1 with `prompt: repairPrompt`
    - result 2 without a per-result prompt
  - Assert:
    - artifact for result 1 uses `repairPrompt`
    - artifact for result 2 uses `batchPrompt`
  - Expected red signal before implementation: both artifacts use `batchPrompt`.

- [ ] Add the same artifact-prompt test in `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`.
  - Use the local test helpers already present in that file.
  - Expected red signal before implementation: repaired partial-window units still record the batch prompt.

- [ ] Update artifact construction in `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts`.
  - Change prompt selection from batch-level-only to:
    ```ts
    prompt: batchResult.prompt ?? batch.prompt
    ```
  - Keep result ordering, skipped-unit handling, and response id mapping unchanged.

- [ ] Update artifact construction in `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts`.
  - Use the same fallback:
    ```ts
    prompt: batchResult.prompt ?? batch.prompt
    ```
  - Do not change partial-window selection or batching behavior.

- [ ] Run focused strategy tests:
  ```powershell
  npx vitest run packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts
  ```
  - Expected green signal: repaired units record repair prompts; unrepaired units keep batch prompts.

## Task 4: Regression Guardrails for Existing Behavior

- [ ] Confirm the existing `tagPolicy: 'none'` batch test still expects one request and no repair.
  - File: `packages/localization/src/modules/MTModule.test.ts`.
  - If necessary, update only the assertion names to reflect the new repair behavior.

- [ ] Confirm the existing custom-project batch behavior still bypasses tag validation.
  - Search in `packages/localization/src/modules/MTModule.test.ts` for custom project or tag policy coverage.
  - If no test exists, add a small test:
    - custom project
    - invalid marker output
    - one batch response
    - no repair request
  - Expected green signal: custom project remains outside placeholder validation.

- [ ] Confirm prompt id shortening remains untouched.
  - Existing tests around `r1`, `r2`, and `responseIdMap` in:
    - `packages/localization/src/modules/MTModule.test.ts`
    - `packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts`
    - `packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts`
  - Do not rename or widen response ids.

## Task 5: Verification

- [ ] Run the targeted retry and strategy test set:
  ```powershell
  npx vitest run packages/localization/src/modules/MTModule.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts
  ```
  - Expected output: all tests in those files pass.

- [ ] Run the broader localization regression set:
  ```powershell
  npx vitest run packages/localization/src/LocalizationEngine.test.ts packages/localization/src/LocalizationInspector.test.ts packages/localization/src/requestModes/shared/results.test.ts
  ```
  - Expected output: all tests in those files pass.

- [ ] Build the localization package:
  ```powershell
  npm run build --workspace=packages/localization
  ```
  - Expected output: build completes successfully.

- [ ] Inspect the final diff:
  ```powershell
  git diff -- packages/localization/src/modules/MTModule.ts packages/localization/src/modules/MTModuleTypes.ts packages/localization/src/modules/MTModule.test.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.ts packages/localization/src/requestModes/windowSequentialBatch/WindowModeSequentialBatchStrategy.test.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.ts packages/localization/src/requestModes/windowPartialSequentialBatch/WindowPartialSequentialBatchStrategy.test.ts
  ```
  - Confirm the diff is limited to retry routing, prompt field threading, and artifact prompt selection.
  - Confirm no CJK profile, TM/TB lookup, concordance, tokenizer, or DB code changed.

## Task 6: Self-Review Checklist

- [ ] The first Window / Window Partial model call is still one batch request.
- [ ] A single invalid batch unit causes exactly one single-segment repair flow for that unit.
- [ ] Successful batch units are not resent during repair.
- [ ] Repair prompt includes invalid target, repair instruction, and validation feedback.
- [ ] Repair prompt excludes unrelated batch units and unrelated batch targets.
- [ ] Repaired artifacts show the single repair prompt.
- [ ] Unrepaired artifacts show the original batch prompt.
- [ ] `tagPolicy: 'none'` and custom projects do not trigger repair.
- [ ] Malformed batch JSON and response-id mapping errors still fail rather than being silently repaired.
- [ ] No CJK profile, TM/TB, concordance, tokenizer, or database behavior changed.
