# Localization Inspector Verification Report

Date: 2026-05-19

Branch: `agent-first-batch-ai-mvp`

## Focused Verification

Passed:

```bash
npx vitest run packages/core/src/project/index.test.ts packages/core/src/project/aiPromptTemplateCatalog.test.ts
npx vitest run apps/desktop/src/main/localization
node --test scripts/inspect-localization.test.mjs
node --test scripts/translate-file.test.mjs
npm run typecheck --workspace=apps/desktop
prettier --check <branch-changed files>
```

Results:

- Core prompt tests: 35 passed.
- Localization tests: 9 files passed, 2 skipped; 52 tests passed, 2 skipped.
- Inspect CLI Node tests: 5 passed.
- Translate file CLI Node tests: 1 passed.
- Desktop typecheck: passed.
- Branch-changed Prettier check: passed.

## Real No-Request Smoke

Input:

- DB: `C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db`
- Project: `3` / Nikki(zh-fr)
- File: `C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx`
- Output xlsx: `C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.inspect.xlsx`
- Output JSON: `C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.inspect.json`
- Unit limit: `14`

Command:

```bash
npm run inspect:localization -- --db "C:\Users\yizhi003\AppData\Roaming\simple-cat-tool\cat_v1.db" --project-id 3 --input "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.xlsx" --output "C:\Users\yizhi003\Downloads\memoQ上传\vibe\mt.inspect.xlsx" --unit-limit 14
```

Result:

```json
{
  "event": "localization_inspect_complete",
  "summary": {
    "total": 14,
    "ready": 14,
    "error": 0
  }
}
```

No translation/provider events were emitted during the smoke command.

## DB File List Check

Before and after the smoke, project 3 had the same file list:

- file 5: `mt.xlsx`, total `119`, target rows `119`, confirmed `0`, status `translated:119`
- file 4: `[fr]2.6diff3(new)_translator_todo - 副本.xlsx`, total `480`, target rows `478`, confirmed `90`, status `confirmed:90, draft:1, new:2, translated:387`
- file 3: `yizhi(new)-fre.xlsx`, total `423`, target rows `423`, confirmed `0`, status `draft:15, translated:408`

No project `files` or `segments` records were created by the inspect command.

## Output Inspection

Confirmed:

- `mt.inspect.xlsx` exists.
- `mt.inspect.json` exists.
- Workbook sheets: `Segments`, `MT_SystemPrompt`.
- `Segments` appended columns:
  - `_tm_for_mt`
  - `_tb_for_mt`
  - `_mt_user_prompt`
  - `_inspect_status`
  - `_inspect_json_ref`
- JSON sidecar contains 14 units, all with status `ready`.
