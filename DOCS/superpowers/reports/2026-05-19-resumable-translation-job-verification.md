# Resumable Translation Job Verification Report

Date: 2026-05-19

Updated: 2026-05-20

Branch: `agent-first-batch-ai-mvp`

Status: `DONE`

## Docs Updated

- `DOCS/00_START_HERE.md` now documents `translate:file --resume`.
- The same section documents the generated checkpoint, events, artifacts, and snapshot sidecars.

## Focused Verification

Passed:

```bash
npx vitest run apps/desktop/src/main/localization/job
npx vitest run apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts
npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts
node --test scripts/translate-file.test.mjs
npm run typecheck --workspace=apps/desktop
```

Results:

- Job tests: 4 files passed, 29 tests passed.
- File translation adapter tests: 1 file passed, 6 tests passed.
- LocalizationEngine tests: 2 files passed, 16 tests passed, 1 skipped.
- Translate file CLI Node tests: 5 tests passed.
- Desktop typecheck: passed.
- After the real resume smoke exposed that reused checkpoint results were summarized as skipped, focused verification passed again:
  - `npx vitest run apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts apps/desktop/src/main/localization/LocalizationEngine.cli.test.ts`: 2 files passed, 9 tests passed, 1 skipped.
  - `npm run typecheck --workspace=apps/desktop`: passed.
- After final review found that resume identity could reuse stale checkpoints across project or translation-policy changes, the hardened identity fix passed:
  - `npx vitest run apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts apps/desktop/src/main/localization/job/sourceHash.test.ts apps/desktop/src/main/localization/job/stores.test.ts`: 24 tests passed.
  - `npm run typecheck --workspace=apps/desktop`: passed.
- After quality review found that the fingerprint also needed engine-resolved defaults and project/provider state, the resolved fingerprint fix passed:
  - `npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts apps/desktop/src/main/localization/job/sourceHash.test.ts apps/desktop/src/main/localization/job/stores.test.ts`: 4 files passed, 39 tests passed.
  - `npm run typecheck --workspace=apps/desktop`: passed.
- After quality review found that mounted TM entry updates could keep resource `updatedAt` and entry count unchanged, entry-level resource fingerprinting passed:
  - `npx vitest run apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts apps/desktop/src/main/localization/job/sourceHash.test.ts apps/desktop/src/main/localization/job/stores.test.ts packages/db/src/index.test.ts packages/db/src/currentSchema.test.ts`: 6 files passed, 88 tests passed.
  - `npm run typecheck --workspace=apps/desktop`: passed.
- After final review found that reusable skipped checkpoints could overwrite target-only edits in `blank-only` mode, skipped checkpoint reuse was disabled and passed:
  - `npx vitest run apps/desktop/src/main/localization/fileTranslationJobAdapter.test.ts apps/desktop/src/main/localization/job/stores.test.ts apps/desktop/src/main/localization/LocalizationEngine.test.ts apps/desktop/src/main/localization/job/TranslationJobRunner.test.ts`: 4 files passed, 46 tests passed.
  - `npm run typecheck --workspace=apps/desktop`: passed.

Notes:

- Initial sandboxed `npx`, `node`, and `npm` commands failed because Volta could not write `C:\Users\yizhi003\AppData\Local\Volta`; reruns with escalation passed.

## Simulated Interruption And Resume Coverage

Existing automated coverage in `apps/desktop/src/main/localization/job/TranslationJobRunner.test.ts` and `apps/desktop/src/main/localization/job/stores.test.ts` covers the requested behavior:

- `reuses matching translated checkpoints and does not call the executor for them`: completed units are not re-requested when `resume: true` and the source hash matches.
- `re-executes a unit when the checkpoint hash does not match`: changed/missing work is retried instead of reused.
- `passes reused and newly completed results to the final callback`: final output receives both checkpoint-reused and newly translated results.
- `treats failed checkpoint records as pending`: failed units are not considered reusable checkpoints.
- `treats skipped checkpoint records as pending`: skipped units are re-evaluated so current non-empty targets in `blank-only` mode cannot be overwritten by stale checkpoint targets.
- `retries thrown tasks and writes failed checkpoints and events after max attempts`: retry and failure checkpoint/event behavior is recorded.
- Adapter coverage verifies final XLSX writing does not overwrite failed units and snapshot XLSX writing works before final output.

No extra mock-transport test was added because the existing runner/store suites already exercise the resume contract at the job boundary without making provider requests.

## Real Smoke

Input:

- DB: `C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db`
- Project: `3` Nikki(zh-fr)
- Source workbook: `C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx`

Inspect command:

```bash
npm run inspect:localization -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-inspect.xlsx" --json-output "C:\tmp\task8-resumable-inspect.json"
```

Inspect result:

- Passed.
- Output XLSX: `C:\tmp\task8-resumable-inspect.xlsx`
- Output JSON: `C:\tmp\task8-resumable-inspect.json`
- Summary event: `localization_inspect_complete`, total `9`, ready `9`, error `0`.
- Verified output workbook sheets: `Segments`, `MT_SystemPrompt`.
- Verified JSON sidecar contains `9` units.

Local source workbook count:

```json
{
  "sheet": "Sheet2",
  "rows": 565920,
  "source": 9,
  "target": 0,
  "blankTarget": 9,
  "sourceIdx": 0,
  "targetIdx": 1
}
```

Translate command:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-mt.translated.xlsx" --checkpoint "C:\tmp\task8-resumable-mt.translated.checkpoint.jsonl" --events "C:\tmp\task8-resumable-mt.translated.events.jsonl" --artifacts "C:\tmp\task8-resumable-mt.translated.artifacts.jsonl" --snapshot "C:\tmp\task8-resumable-mt.translated.snapshot.xlsx" --snapshot-every-units 2
```

Translate result:

- Passed after explicit user approval to send the 9 source segments plus DB-derived TM/TB/prompt context to the configured MT provider.
- Summary event: `localization_file_complete`, total `9`, translated `9`, skipped `0`, failed `0`.
- Output XLSX: `C:\tmp\task8-resumable-mt.translated.xlsx`
- Checkpoint JSONL: `C:\tmp\task8-resumable-mt.translated.checkpoint.jsonl`
- Events JSONL: `C:\tmp\task8-resumable-mt.translated.events.jsonl`
- Artifacts JSONL: `C:\tmp\task8-resumable-mt.translated.artifacts.jsonl`
- Snapshot XLSX: `C:\tmp\task8-resumable-mt.translated.snapshot.xlsx`
- Source input was not overwritten.

Output verification:

```json
{
  "workbook": {
    "sheets": ["Sheet2"],
    "ref": "A1:B10",
    "rows": 10,
    "source": 9,
    "target": 9,
    "blankTarget": 0,
    "sourceIdx": 0,
    "targetIdx": 1
  },
  "checkpoint": {
    "lines": 9,
    "status": { "translated": 9 },
    "attempts": { "1": 9 }
  },
  "events": {
    "lines": 15,
    "event": {
      "job_start": 1,
      "unit_done": 9,
      "snapshot": 4,
      "job_done": 1
    }
  },
  "artifacts": {
    "lines": 9,
    "status": { "translated": 9 }
  }
}
```

Same-job resume command:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-mt.translated.xlsx" --checkpoint "C:\tmp\task8-resumable-mt.translated.checkpoint.jsonl" --events "C:\tmp\task8-resumable-mt.same-job-resume-after-fix.events.jsonl" --artifacts "C:\tmp\task8-resumable-mt.same-job-resume-after-fix.artifacts.jsonl" --snapshot "C:\tmp\task8-resumable-mt.same-job-resume-after-fix.snapshot.xlsx" --resume --progress-stdout
```

Same-job resume result:

- Passed.
- Progress events emitted `9` unit completions with status `reused`.
- Final summary: total `9`, translated `0`, skipped `0`, failed `0`, reused `9`.
- The dynamic test body completed in `65ms`, consistent with checkpoint reuse rather than provider retranslation.

Hardened resume identity:

- Default file job identity now includes the input filename, output basename, project id, and a translation-policy fingerprint.
- Unit checkpoint hashes include the same fingerprint, so an explicit job id cannot silently reuse records when project or translation policy changes.
- For LocalizationEngine/CLI runs, the fingerprint includes engine-resolved target scope, mode, provider id/base URL/protocol, model, reasoning effort, temperature, effective project/system prompt, mounted TM/TB resource metadata, and mounted TM/TB entry count plus max entry update timestamp without including API keys.

Post-resource-hardening real translate smoke:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-mt.hardened-resource.translated.xlsx" --checkpoint "C:\tmp\task8-resumable-mt.hardened-resource.checkpoint.jsonl" --events "C:\tmp\task8-resumable-mt.hardened-resource.events.jsonl" --artifacts "C:\tmp\task8-resumable-mt.hardened-resource.artifacts.jsonl" --snapshot "C:\tmp\task8-resumable-mt.hardened-resource.snapshot.xlsx" --snapshot-every-units 2 --progress-stdout
```

Post-resource-hardening result:

- Passed.
- Summary event: total `9`, translated `9`, skipped `0`, failed `0`.
- Job id included resolved policy/resource fingerprint: `file:mt.xlsx:task8-resumable-mt.hardened-resource.translated:0861c61e8b713ff7273f0893736d98640fdfcf77c3b8b0ece51ec3539891666a`.
- Output workbook: `Sheet2`, `A1:B10`, source `9`, target `9`, blank target `0`.
- Checkpoint JSONL: `9` lines, status translated `9`, attempts `1`.
- Events JSONL: `15` lines, `job_start: 1`, `unit_done: 9`, `snapshot: 4`, `job_done: 1`.
- Artifacts JSONL: `9` lines, status translated `9`.

Post-resource-hardening same-job resume:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-mt.hardened-resource.translated.xlsx" --checkpoint "C:\tmp\task8-resumable-mt.hardened-resource.checkpoint.jsonl" --events "C:\tmp\task8-resumable-mt.hardened-resource.resume.events.jsonl" --artifacts "C:\tmp\task8-resumable-mt.hardened-resource.resume.artifacts.jsonl" --snapshot "C:\tmp\task8-resumable-mt.hardened-resource.resume.snapshot.xlsx" --resume --progress-stdout
```

Post-resource-hardening same-job resume result:

- Passed.
- Resume events: `11` lines, `job_start: 1`, `unit_done: 9`, `job_done: 1`.
- Progress events emitted `9` unit completions with status `reused`.
- Final summary: total `9`, translated `0`, skipped `0`, failed `0`, reused `9`.
- The dynamic test body completed in `845ms`, consistent with checkpoint reuse rather than provider retranslation.
