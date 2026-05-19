# Resumable Translation Job Verification Report

Date: 2026-05-19

Branch: `agent-first-batch-ai-mvp`

Status: `DONE_WITH_CONCERNS`

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

Notes:

- Initial sandboxed `npx`, `node`, and `npm` commands failed because Volta could not write `C:\Users\yizhi003\AppData\Local\Volta`; reruns with escalation passed.

## Simulated Interruption And Resume Coverage

Existing automated coverage in `apps/desktop/src/main/localization/job/TranslationJobRunner.test.ts` and `apps/desktop/src/main/localization/job/stores.test.ts` covers the requested behavior:

- `reuses matching translated checkpoints and does not call the executor for them`: completed units are not re-requested when `resume: true` and the source hash matches.
- `re-executes a unit when the checkpoint hash does not match`: changed/missing work is retried instead of reused.
- `passes reused and newly completed results to the final callback`: final output receives both checkpoint-reused and newly translated results.
- `treats failed checkpoint records as pending`: failed units are not considered reusable checkpoints.
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

Translate command prepared but not run:

```bash
npm run translate:file -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\tmp\task8-resumable-mt.translated.xlsx" --checkpoint "C:\tmp\task8-resumable-mt.translated.checkpoint.jsonl" --events "C:\tmp\task8-resumable-mt.translated.events.jsonl" --artifacts "C:\tmp\task8-resumable-mt.translated.artifacts.jsonl" --snapshot "C:\tmp\task8-resumable-mt.translated.snapshot.xlsx" --snapshot-every-units 2
```

Concern/blocker:

- The translate smoke was not executed because the escalation reviewer rejected it as a private-data export risk: the source workbook has 9 blank target rows, so the command would likely send spreadsheet content and DB-derived TM/TB/prompt context to the configured MT provider.
- No translated XLSX/checkpoint/events/artifacts/snapshot files were produced.
- The source input was not overwritten.

Expected output paths for a future approved real translate smoke:

- `C:\tmp\task8-resumable-mt.translated.xlsx`
- `C:\tmp\task8-resumable-mt.translated.checkpoint.jsonl`
- `C:\tmp\task8-resumable-mt.translated.events.jsonl`
- `C:\tmp\task8-resumable-mt.translated.artifacts.jsonl`
- `C:\tmp\task8-resumable-mt.translated.snapshot.xlsx`

