# Reference Lookup Worker Design

## Goal

Move editor TM/TB reference lookup out of the editor's critical interaction path and out of the Electron main process event loop.

After this change, switching the active segment, receiving AI translation updates, typing, saving, and navigating the editor must not wait on TM/TB lookup work. TM/TB results remain available to the CAT panel, but they are treated as low-priority reference data that can be delayed, cached, dropped when stale, or unavailable if the lookup worker fails.

## Background

The current lookup path is:

```text
active segment changes
-> renderer debounce
-> ipcRenderer.invoke(tm-get-matches / tb-get-matches)
-> Electron main process handler
-> ProjectService.findMatches / findTermMatches
-> better-sqlite3 synchronous queries and CPU similarity work
-> renderer state update
```

The main issue is not only the cost of a single lookup. The deeper design issue is that active editor state currently triggers reference lookup as an automatic side effect, and the heavy synchronous database work runs in the Electron main process.

TM lookup can perform exact hash lookup, fuzzy recall, concordance recall, candidate scoring, and sorting. Concordance recall can issue multiple synchronous FTS queries through `better-sqlite3`. TB lookup can also perform synchronous FTS/exact candidate retrieval followed by term matching. When a user changes active segments quickly, old lookup work can pile up even though only the latest segment matters.

## Chosen Scope

This design follows option B:

- Add a renderer-side reference lookup controller.
- Add a read-only worker for TM/TB reference lookup.
- Keep the existing invoke-style return shape.
- Defer progressive streaming, prefetch, worker pools, hard cancellation, and query algorithm tuning.

This scope addresses both root causes:

- The renderer stops issuing unnecessary or obsolete lookup requests.
- The Electron main process stops executing synchronous TM/TB database queries.

## Non-Goals

This change will not:

- Add progressive result streaming.
- Add adjacent-segment prefetch.
- Add a worker pool.
- Force-kill an active SQLite query.
- Tune FTS limits, recall budgets, or similarity algorithms.
- Change `TMPanel` UI.
- Change TM/TB result shapes returned to the renderer.
- Fall back to main-thread lookup when the worker fails.

## Architecture

The design has three layers with narrow responsibilities.

### Renderer: `useReferenceLookupController`

The renderer controller replaces the current `useActiveSegmentMatches` behavior.

Responsibilities:

- Decide whether lookup is enabled.
- Debounce active-segment changes.
- Cache completed lookup results by `projectId:srcHash`.
- Deduplicate in-flight requests by the same key.
- Enforce single-flight latest-only behavior.
- Drop stale results.
- Expose `activeMatches` and `activeTerms` in the same shape the editor already expects.

The controller does not know that a worker exists. It calls the existing API client methods:

- `apiClient.getMatches(projectId, segment)`
- `apiClient.getTermMatches(projectId, segment)`

Initial enablement rule:

```text
enabled =
  activeTab === 'tm'
  && projectId !== null
  && activeSegmentId !== null
  && active segment exists
```

Responsive sidebar visibility is not part of the first version. The current sidebar is hidden via CSS at smaller viewports, and adding viewport observation would widen the change. The first version uses the explicit CAT tab state as the user's lookup intent.

### Main: `ReferenceLookupWorkerManager`

The main process owns a worker manager. TM/TB IPC handlers delegate lookup work to the manager instead of calling `ProjectService.findMatches()` or `ProjectService.findTermMatches()` directly.

Responsibilities:

- Lazy-start a single persistent worker.
- Resolve the worker script path.
- Assign monotonically increasing request IDs.
- Track pending requests.
- Resolve or reject promises from worker responses.
- Reject all pending requests on worker crash.
- Clear the worker reference after crash or dispose.
- Restart lazily on the next request.

Public methods:

```ts
findTmMatches(projectId: number, segment: Segment): Promise<TMMatch[]>
findTbMatches(projectId: number, segment: Segment): Promise<TBMatch[]>
dispose(): Promise<void> | void
```

The existing IPC channel names remain unchanged:

- `tm-get-matches`
- `tb-get-matches`

### Worker: `referenceLookupWorker.ts`

The worker performs the actual reference lookup.

Startup:

- Receives `dbPath` in `workerData`.
- Opens `CATDatabase(dbPath, { readonly: true, fileMustExist: true })`.
- Recreates the required repository and service objects.

Request handling:

- Accepts messages with `{ requestId, kind, projectId, segment }`.
- For `kind: 'tm'`, calls the TM service.
- For `kind: 'tb'`, calls the TB service.
- Posts `{ requestId, ok: true, result }` on success.
- Posts `{ requestId, ok: false, error }` on failure.

The worker reuses existing TM/TB service logic. It does not alter matching behavior.

## Request State Machine

The renderer controller uses these conceptual states:

- `disabled`: lookup is not allowed.
- `idle`: lookup is allowed and no lookup is pending.
- `debouncing`: an active segment change is waiting for the debounce window.
- `loading`: one lookup is in flight.
- `ready`: the current key has lookup results.
- `error`: lookup failed for the current key.

These states do not require a complex reducer unless implementation benefits from one. The important part is the behavior rules.

## Renderer Race Rules

### Lookup Key

The lookup key is:

```text
${projectId}:${segment.srcHash}
```

This preserves the existing behavior where segments with the same source hash can share reference results.

### Completed Cache

If the current key has a completed cached result, the controller sets `activeMatches` and `activeTerms` immediately and does not call the fetchers.

The cache is cleared when `projectId` changes.

### In-Flight Deduplication

If the current key already has an in-flight promise, the controller reuses that promise instead of issuing another IPC call.

### Single-Flight Latest-Only

At most one lookup is actively started by the controller at a time.

If key A is in flight and the user moves through B, C, and D:

- A is allowed to finish.
- B and C are not requested.
- D is recorded as the queued latest key.
- After A finishes, the controller starts D if D is still current and enabled.

### Stale Result Guard

Every resolved promise is checked against the current key before it updates React state. If `resolvedKey !== currentKeyRef.current`, the result is dropped.

### Disabled Behavior

When lookup becomes disabled:

- Clear the debounce timer.
- Clear queued latest lookup.
- Prevent new lookups from starting.
- Ignore any in-flight result when it returns.
- Clear the active TM/TB arrays for the panel.

The renderer does not need to cancel a worker query to be correct.

## Main and Worker Race Rules

The worker manager uses request IDs as the source of truth.

- Every outgoing message gets a unique request ID.
- The pending request map is keyed by request ID.
- Worker responses resolve or reject only their matching request.
- Unknown request IDs are ignored.
- Worker crash rejects all pending requests and clears the map.
- The next request after a crash starts a fresh worker.

The first version does not terminate a worker just because the renderer moved to a newer active segment. Once lookup is in a worker, old work no longer blocks the Electron main process. Stale result correctness is handled by the renderer key guard.

## Failure Handling

Worker failure must not reintroduce main-thread synchronous lookup.

Failure behavior:

- Worker returns an error for a request: reject that request.
- Worker crashes: reject all pending requests.
- Renderer catches lookup errors and shows empty reference results or an error state.
- The editor remains interactive.
- A later lookup lazily restarts the worker.

Main-thread fallback is intentionally excluded. Falling back to the main thread would restore the original event-loop blocking path exactly when the system is already unhealthy.

## Database Consistency

The worker opens an independent read-only SQLite connection. The database already supports:

```ts
new CATDatabase(dbPath, { readonly: true, fileMustExist: true })
```

The app uses WAL mode for writable connections. Read-only reference lookup can tolerate eventual consistency. A newly mounted/imported TM/TB may not be reflected in an already cached renderer result until the cache is invalidated. The first version clears cache on project changes only.

More precise invalidation for TM/TB mount, unmount, import, or delete can be added later if user-visible staleness becomes a problem.

## File Plan

### Renderer

Create:

- `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts`
- `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts`

Modify:

- `apps/desktop/src/renderer/src/hooks/useEditor.ts`
- `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`
- `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.test.ts`

Preferred direction:

- Move the logic into `useReferenceLookupController`.
- Remove `useActiveSegmentMatches` or reduce it to a temporary compatibility wrapper.
- Avoid keeping two competing abstractions long term.

### Main

Create:

- `apps/desktop/src/main/services/referenceLookup/types.ts`
- `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.ts`
- `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts`
- `apps/desktop/src/main/referenceLookupWorker.ts`

Modify:

- `apps/desktop/src/main/ipc/tmHandlers.ts`
- `apps/desktop/src/main/ipc/tbHandlers.ts`
- `apps/desktop/src/main/ipc/types.ts`
- `apps/desktop/src/main/index.ts`

## Testing Strategy

### Renderer Controller Tests

Use mock fetchers and fake timers.

Required cases:

- Disabled state does not call fetchers and clears queued latest.
- Debounced active segment changes A -> B -> C issue only C.
- A in flight, then B -> C -> D, starts A and then D only.
- Completed cache returns synchronously and avoids a fetch.
- In-flight cache reuses the same promise and avoids duplicate fetches.
- Stale promise resolution does not update active matches or terms.
- Project ID changes clear completed and in-flight cache.

### Main Manager Tests

Use a mock Worker implementation.

Required cases:

- Sends request messages with unique request IDs.
- Resolves the matching pending promise on success.
- Rejects the matching pending promise on worker error response.
- Ignores unknown request IDs.
- Rejects all pending promises on worker crash.
- Clears worker reference on crash.
- Lazy restarts after crash on next request.
- `dispose()` terminates the worker and rejects pending requests.

### IPC Handler Tests

Required cases:

- `tm-get-matches` delegates to `ReferenceLookupWorkerManager.findTmMatches`.
- `tb-get-matches` delegates to `ReferenceLookupWorkerManager.findTbMatches`.
- The handlers do not call `projectService.findMatches` or `projectService.findTermMatches` for reference lookup.

### Worker Tests

The worker body should stay thin. The existing TM/TB service tests continue to cover matching behavior.

If implementation proves the worker path is stable under Vitest, add a small smoke test with a temporary file database. If worker path resolution is brittle in the test runner, skip the real-worker smoke test and rely on manager protocol tests plus desktop build/typecheck.

## Implementation Order

1. Add renderer controller tests.
2. Implement renderer controller.
3. Wire controller into `useEditor`.
4. Run renderer hook/editor tests.
5. Add worker manager tests with mock Worker.
6. Implement worker manager.
7. Add worker protocol types.
8. Implement `referenceLookupWorker.ts`.
9. Switch TM/TB IPC handlers to the manager.
10. Wire manager creation in `main/index.ts`.
11. Run targeted Vitest tests.
12. Run desktop typecheck.
13. Run build or package-path verification if worker path resolution changed.

## Acceptance Criteria

The implementation is complete when:

- Renderer only starts automatic TMTB lookup when the CAT tab is active and a valid segment exists.
- Rapid active-segment changes do not issue lookup requests for intermediate stale segments.
- Duplicate lookup requests for the same `projectId:srcHash` are deduplicated.
- Stale lookup results cannot update active reference state.
- `tm-get-matches` and `tb-get-matches` no longer run heavy TM/TB database queries in the Electron main process.
- A worker failure affects only reference lookup results, not editor interactivity.
- The TM/TB result shape consumed by `TMPanel` is unchanged.

## Future Work

Potential follow-up work:

- Progressive exact/fuzzy/concordance streaming.
- Adjacent segment prefetch during idle time.
- Fine-grained TM/TB cache invalidation by mount/import/delete revision.
- Worker termination or cooperative cancellation for obsolete long-running queries.
- Query-level FTS and concordance recall tuning.
- Main/worker timing diagnostics for slow lookup telemetry.
