# Recent 24h Commit Review - 2026-07-05

## Scope

Review date: 2026-07-05, Asia/Shanghai.

Reviewed commits from the prior 24 hours:

| Commit | Time | Subject |
| --- | --- | --- |
| `2bd5c5f` | 2026-07-05 14:12:35 +0800 | feat: implement TM synchronization with Excel, including configuration management and job handling |
| `58e6a0a` | 2026-07-05 09:51:27 +0800 | feat: implement project saved prompts management with CRUD operations and UI integration |
| `8f3802e` | 2026-07-04 17:05:31 +0800 | test: add cache eviction logic for English recognizer in TBService |

Base parent used for aggregate inspection: `d8af02c`.

The review used three parallel subagents for independent surfaces:

- TB recognizer cache and TBRepo changes.
- Saved prompts DB, IPC, hook, and UI changes.
- TM Excel sync DB, worker, pipeline, IPC, and UI changes.

## Summary

No P0/P1 issues were found. The main risks are P2 data-loss or silent destructive
behavior in TM sync and project saved prompt mutation scoping. P3 issues are
mostly state, UX, ordering, or performance-churn problems.

## Findings

### P2: TM sync accepts invalid or same-column mappings

Files:

- `apps/desktop/src/renderer/src/components/TMImportWizard.tsx`
- `apps/desktop/src/main/services/modules/tm/TMSyncService.ts`
- `apps/desktop/src/main/services/modules/tm/tmSyncPipeline.ts`

Evidence:

- `TMImportWizard.tsx:355-358` calls `onConfirm({ hasHeader, sourceCol, targetCol, overwrite })`
  without validating that source and target columns differ.
- `TMSyncService.ts:40-51` persists `filePath`, `columns`, and `deletePolicy`
  directly from the input or existing config.
- `tmSyncPipeline.ts:95-105` reads both `cells[columns.sourceCol]` and
  `cells[columns.targetCol]` and then computes the TM entry from those values.

Impact:

If the user accidentally selects the same column for source and target, sync can
bulk-rewrite target tokens to source text. Invalid or out-of-range columns can
also lead to an empty successful sync and move the sync baseline.

Recommendation:

Validate in both UI and main process: nonnegative integer columns, available in
preview where possible, and `sourceCol !== targetCol`. Add same-column and
out-of-range regression tests.

### P2: `prune-all` can delete local TM edits without warning

Files:

- `packages/db/src/repos/TMRepo.ts`
- `apps/desktop/src/main/services/modules/tm/tmSyncPipeline.ts`

Evidence:

- `TMRepo.ts:1619-1629` computes `overwrittenLocalEdits` only by joining staged
  rows to existing entries, so entries missing from the spreadsheet are excluded.
- `tmSyncPipeline.ts:264-278` deletes missing TM entries when `deletePolicy` is
  `prune-all`.
- `tmSyncPipeline.ts:206-208` reports `overwrittenLocalEdits` from the diff
  summary before delete application, so prune deletes are not represented in the
  warning count.

Impact:

Entries added or edited locally after the previous full sync can be deleted by a
later prune run while the report still says `overwrittenLocalEdits = 0`.

Recommendation:

Track deleted local edits separately, or include them in the overwrite warning.
Consider requiring explicit confirmation before prune deletes entries with
`updatedAt > lastSyncedAt`.

### P2: Relinking a TM sync source preserves old prune policy and history

Files:

- `apps/desktop/src/renderer/src/components/tm-manager/tmSyncActions.ts`
- `apps/desktop/src/main/services/modules/tm/TMSyncService.ts`

Evidence:

- `tmSyncActions.ts:72-79` saves a relink config with `filePath` and `columns`
  only; it does not pass `deletePolicy`.
- `TMSyncService.ts:44-50` creates `next` by spreading the existing config and
  using `input.deletePolicy ?? existing?.deletePolicy ?? 'never'`.
- The same spread also preserves historical fields such as `lastSyncedAt` and
  `lastSyncStatus`.

Impact:

If the previous linked file used `prune-all`, relinking to a different file can
continue destructive pruning with no UI signal. Old sync history also appears to
belong to the new source file.

Recommendation:

When `filePath` or column mapping changes and no policy is explicitly passed,
reset `deletePolicy` to `never` and clear old `lastSync*` fields, or expose the
policy in the relink UI with a destructive confirmation.

### P2: Saved prompt mutations are not project-scoped and edit save is non-atomic

Files:

- `packages/db/src/repos/ProjectRepo.ts`
- `apps/desktop/src/main/ipc/projectHandlers.ts`
- `apps/desktop/src/renderer/src/hooks/projectDetail/ai/useProjectSavedPrompts.ts`

Evidence:

- `ProjectRepo.ts:171-196` updates content, renames, and deletes prompts by
  global `promptId`.
- `projectHandlers.ts:73-98` exposes mutation handlers that take `promptId`
  without `projectId`.
- `useProjectSavedPrompts.ts:115-120` saves an edit as two calls: rename first,
  then content update.

Impact:

Main/DB cannot enforce that the prompt belongs to the current project. A stale or
cross-project prompt id can mutate the wrong project. If rename succeeds but the
content update fails, the prompt is left partially updated.

Recommendation:

Use `projectId + promptId` for update/delete APIs and execute rename/content
changes in a single transaction. Throw when `changes === 0`.

### P3: Saved prompt changes do not update parent project recency

File:

- `packages/db/src/repos/ProjectRepo.ts`

Evidence:

- `ProjectRepo.ts:104-107` lists projects ordered by `projects.updatedAt DESC`.
- `ProjectRepo.ts:150-196` modifies `project_prompts` but never touches the
  parent `projects.updatedAt`.

Impact:

Project-level prompt work does not affect project recency ordering, even though
users changed project configuration.

Recommendation:

Touch the parent project in the same transaction as prompt create/update/delete.

### P3: Saved prompt list failures look like empty data

Files:

- `apps/desktop/src/renderer/src/hooks/projectDetail/ai/useProjectSavedPrompts.ts`
- `apps/desktop/src/renderer/src/components/project-detail/ProjectPromptManagerModal.tsx`

Evidence:

- `useProjectSavedPrompts.ts:37-47` catches list failures and sets the loaded
  prompt list to `[]`.
- `ProjectPromptManagerModal.tsx:78-81` renders that as "No saved prompts yet."

Impact:

A transient IPC or DB error can look like lost saved prompts and can encourage
duplicate prompt creation.

Recommendation:

Keep the last known list on load failure and expose an error/loading state to the
UI.

### P3: Applying a saved prompt overwrites unsaved draft without confirmation

Files:

- `apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.tsx`
- `apps/desktop/src/renderer/src/components/project-detail/ProjectPromptManagerModal.tsx`
- `apps/desktop/src/renderer/src/hooks/projectDetail/ai/useProjectSavedPrompts.ts`

Evidence:

- `ProjectAIPane.tsx:104-110` applies the selected prompt directly from the
  select change handler.
- `ProjectPromptManagerModal.tsx:134-138` applies a prompt and closes the modal.
- `useProjectSavedPrompts.ts:67-72` implements apply by calling
  `setPromptDraft(prompt.content)`.

Impact:

An accidental select or Apply click can discard unsaved prompt draft text.

Recommendation:

If `hasUnsavedPromptChanges` is true, confirm before applying or provide an undo
path.

### P3: TB English recognizer rebuild does not refresh LRU recency

Files:

- `packages/localization/src/services/TBService.ts`
- `apps/desktop/src/main/services/TBService.ts`

Evidence:

- `TBService.ts:152-158` refreshes recency only when the cached key matches.
- `TBService.ts:160-177` rebuilds and calls `Map.set(projectId, cacheEntry)`
  directly when the key changes.
- JavaScript `Map.set` on an existing key does not move that key to the end.
- `TBService.ts:193-198` evicts the oldest map key when over the cache limit.
- `apps/desktop/src/main/services/TBService.ts` inherits the shared service, so
  desktop has the same behavior.

Impact:

After a TB data-version bump, a just-rebuilt large recognizer can still be the
oldest cache entry and get evicted on the next project access. This can cause
avoidable recognizer rebuild CPU and memory churn.

Recommendation:

Before setting a rebuilt cache entry for an existing project, delete the key or
reuse the recency refresh helper. Add a data-version-bump LRU regression test.

## Verification Evidence

Targeted tests:

```text
npx vitest run \
  apps/desktop/src/main/services/TBService.test.ts \
  packages/db/src/repos/TMRepo.sync.test.ts \
  apps/desktop/src/main/services/modules/tm/TMSyncService.test.ts \
  apps/desktop/src/main/services/modules/tm/tmSyncPipeline.test.ts \
  apps/desktop/src/main/services/modules/TMModule.test.ts \
  apps/desktop/src/renderer/src/components/tm-manager/tmSyncActions.test.ts \
  apps/desktop/src/renderer/src/components/project-detail/ProjectPromptManagerModal.test.ts \
  apps/desktop/src/renderer/src/components/project-detail/ProjectAIPane.test.ts \
  packages/db/src/currentSchema.test.ts \
  packages/db/src/index.test.ts
```

Result:

```text
Test Files  10 passed (10)
Tests       135 passed (135)
```

Typecheck:

```text
npm run build --workspace=packages/localization
npm run typecheck --workspace=apps/desktop
```

Result:

```text
tsc --noEmit completed successfully after rebuilding package declarations.
```

Note: before rebuilding generated package declarations, desktop typecheck read
stale untracked `dist` declarations and reported missing newly added exports.
After rebuilding, the source typecheck passed.

## Review Commands

Representative commands used:

```text
git log --since='24 hours ago' --date=iso --pretty=format:'%H%x09%ad%x09%an%x09%s'
git show --stat --oneline --decorate --find-renames 8f3802e27656e53748ebc67d13fbd27d075e7fd3
git show --stat --oneline --decorate --find-renames 58e6a0a510791ac6fd3546358ccb13204f01f149
git show --stat --oneline --decorate --find-renames 2bd5c5fffe995db4dbc7834bc6eb52afd10c31d7
git diff --name-status d8af02cc999622da60c61d8e1d7c5f29ee3c7272..HEAD
rg "listProjectSavedPrompts|createProjectSavedPrompt|project_prompts" .
rg "invalidateCachedIndexes|referenceDataChanged|notifyReferenceDataChanged" apps/desktop/src/main -n
```

