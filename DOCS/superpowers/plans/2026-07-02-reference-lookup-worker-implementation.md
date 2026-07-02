# Reference Lookup Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move editor TM/TB reference lookup and manual Concordance search off the Electron main process while preserving all TM/TB and AI prompt-reference business behavior.

**Architecture:** Add a renderer `useReferenceLookupController` that gates, deduplicates, caches, and latest-only schedules editor reference lookups. Add a main-process `ReferenceLookupWorkerManager` that forwards TM match, TB match, and Concordance requests to one persistent read-only worker. Add coarse reference-data invalidation events so renderer caches refresh after TM/TB mutations.

**Tech Stack:** React hooks, Vitest, Electron IPC/preload APIs, Node `worker_threads`, `better-sqlite3` via `CATDatabase`, existing desktop TM/TB services and repository adapters.

---

## Source Spec

Approved design: `DOCS/superpowers/specs/2026-07-02-reference-lookup-worker-design.md`

Hard boundary: this implementation is transport and lifecycle refactoring only. Do not change TM/TB matching semantics, repository query plans, FTS parameters, ranking, suppression, AI prompt-reference selection, or batch/file AI translate reference behavior.

## File Structure

### Renderer

- Create `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts`
  - Owns debounce, enabled gating, completed cache, in-flight dedupe, latest-only queue, stale-result guard, and reference-data invalidation handling.
- Create `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts`
  - Unit tests controller behavior with mock fetchers and fake timers.
- Modify `apps/desktop/src/renderer/src/hooks/useEditor.ts`
  - Replace `useActiveSegmentMatches` with `useReferenceLookupController`.
  - Pass `enabled: activeTab === 'tm'`.
- Modify `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`
  - Delete after `useEditor.ts` imports `useReferenceLookupController`.
- Modify `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.test.ts`
  - Delete after equivalent controller tests are in place.
- Modify `apps/desktop/src/shared/ipc.ts`
  - Add `ReferenceDataChangedEvent`.
  - Add `onReferenceDataChanged` to `DesktopApi`.
- Modify `apps/desktop/src/preload/api/eventApi.ts`
  - Expose `onReferenceDataChanged`.
- Modify `apps/desktop/src/preload/api/createDesktopApi.test.ts`
  - Verify the new event subscription is wired.

### Main

- Create `apps/desktop/src/main/services/referenceLookup/types.ts`
  - Defines worker request/response types and `ReferenceLookupService`.
- Create `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.ts`
  - Manages lazy worker startup, request IDs, pending promises, crash handling, and dispose.
- Create `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts`
  - Tests manager protocol with a mock Worker.
- Create `apps/desktop/src/main/referenceLookupWorker.ts`
  - Read-only worker that recreates existing adapters/services and executes TM, TB, and Concordance lookups.
- Modify `apps/desktop/src/main/ipc/types.ts`
  - Add `ReferenceBackedHandlerDeps`, `ReferenceDataChangedNotifier`, and `ReferenceLookupService` dependency types.
- Modify `apps/desktop/src/main/ipc/tmHandlers.ts`
  - Delegate `tm-get-matches` and `tm-concordance` to `referenceLookup`.
  - Emit reference-data invalidation after successful TM mutations and async import completion.
- Modify `apps/desktop/src/main/ipc/tbHandlers.ts`
  - Delegate `tb-get-matches` to `referenceLookup`.
  - Emit reference-data invalidation after successful TB mutations and async import completion.
- Modify `apps/desktop/src/shared/ipcChannels.ts`
  - Add `events.referenceDataChanged`.
- Modify `apps/desktop/src/main/index.ts`
  - Create `ReferenceLookupWorkerManager`.
  - Broadcast reference-data invalidation.
  - Pass manager/notifier into TM/TB handler registration.
  - Dispose manager from an `app.on('before-quit')` listener inside the `app.whenReady()` setup closure.

### Tests and Verification

- Renderer:
  - `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts`
  - `apps/desktop/src/renderer/src/hooks/useEditor.test.ts`
  - `apps/desktop/src/renderer/src/components/Editor.test.ts`
  - `apps/desktop/src/preload/api/createDesktopApi.test.ts`
- Main:
  - `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts`
  - `apps/desktop/src/main/ipc/handlerRegistration.test.ts`
  - `apps/desktop/src/main/ipc/importJobHandlers.test.ts`
- Business-logic regression guards:
  - `apps/desktop/src/main/services/TMService.test.ts`
  - `apps/desktop/src/main/services/TBService.test.ts`
  - `apps/desktop/src/main/services/modules/ai/promptReferences.test.ts`
  - Selected `AIModule.test.ts` prompt-reference cases if imports or call sites are touched.

---

## Task 1: Renderer Controller Core Tests

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts`
- Read: `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.test.ts`
- Read: `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`

- [ ] **Step 1: Add test helpers**

Add these helpers at the top of `useReferenceLookupController.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import {
  createReferenceLookupControllerLoader,
  createReferenceLookupScheduler,
} from './useReferenceLookupController';

function createSegment(segmentId: string, srcHash: string): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: `Source ${segmentId}` }],
    targetTokens: [],
    status: 'new',
    matchKey: `source-${segmentId}`,
    srcHash,
    tagsSignature: '',
    meta: { updatedAt: '2026-07-02T00:00:00.000Z' },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

```

- [ ] **Step 2: Write loader cache/dedupe tests**

Add tests for the pure loader factory:

```ts
describe('createReferenceLookupControllerLoader', () => {
  it('caches completed TM and TB matches by project and source hash', async () => {
    const tmMatches = [{ id: 'tm-1' }] as TMMatch[];
    const tbMatches = [{ id: 'tb-1' }] as TBMatch[];
    const getMatches = vi.fn(async () => tmMatches);
    const getTermMatches = vi.fn(async () => tbMatches);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    const first = await loader.load({ projectId: 7, segment: createSegment('seg-1', 'same') });
    const second = await loader.load({ projectId: 7, segment: createSegment('seg-2', 'same') });

    expect(first).toEqual({ matches: tmMatches, terms: tbMatches });
    expect(second).toBe(first);
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getTermMatches).toHaveBeenCalledTimes(1);
  });

  it('deduplicates in-flight loads for the same project and source hash', async () => {
    const tmDeferred = deferred<TMMatch[]>();
    const tbDeferred = deferred<TBMatch[]>();
    const getMatches = vi.fn(() => tmDeferred.promise);
    const getTermMatches = vi.fn(() => tbDeferred.promise);
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    const first = loader.load({ projectId: 7, segment: createSegment('seg-1', 'same') });
    const second = loader.load({ projectId: 7, segment: createSegment('seg-2', 'same') });
    expect(second).toBe(first);

    tmDeferred.resolve([{ id: 'tm-1' }] as TMMatch[]);
    tbDeferred.resolve([{ id: 'tb-1' }] as TBMatch[]);
    await expect(first).resolves.toEqual({
      matches: [{ id: 'tm-1' }],
      terms: [{ id: 'tb-1' }],
    });
    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getTermMatches).toHaveBeenCalledTimes(1);
  });

  it('keeps fulfilled TM matches when TB lookup fails and does not cache partial failures', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-1' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => {
      throw new Error('tb unavailable');
    });
    const loader = createReferenceLookupControllerLoader({ getMatches, getTermMatches });

    await expect(
      loader.load({ projectId: 7, segment: createSegment('seg-1', 'hash') }),
    ).resolves.toEqual({ matches: [{ id: 'tm-1' }], terms: [] });
    await loader.load({ projectId: 7, segment: createSegment('seg-2', 'hash') });

    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(getTermMatches).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 3: Write scheduler gating/latest-only tests**

Add scheduler tests. The scheduler is a pure controller that the React hook wraps, so no new React hook test dependency is required:

```ts
describe('createReferenceLookupScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('does not fetch when disabled and clears results', async () => {
    const getMatches = vi.fn(async () => [{ id: 'tm-1' }] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [{ id: 'tb-1' }] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({
      enabled: false,
      projectId: 7,
      segment: createSegment('seg-1', 'hash'),
    });
    await vi.runAllTimersAsync();

    expect(setResult).toHaveBeenCalledWith({ matches: [], terms: [] });
    expect(getMatches).not.toHaveBeenCalled();
    expect(getTermMatches).not.toHaveBeenCalled();
  });

  it('debounces rapid active changes and only fetches the latest segment', async () => {
    const getMatches = vi.fn(async (_projectId, segment: Segment) => [
      { id: `tm-${segment.segmentId}` },
    ] as TMMatch[]);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult: vi.fn(),
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('c', 'hash-c') });
    await vi.advanceTimersByTimeAsync(350);

    expect(getMatches).toHaveBeenCalledTimes(1);
    expect(getMatches.mock.calls[0][1].segmentId).toBe('c');
  });

  it('runs the current in-flight lookup and then only the queued latest lookup', async () => {
    const a = deferred<TMMatch[]>();
    const d = deferred<TMMatch[]>();
    const getMatches = vi
      .fn()
      .mockImplementationOnce(() => a.promise)
      .mockImplementationOnce(() => d.promise);
    const getTermMatches = vi.fn(async () => [] as TBMatch[]);
    const setResult = vi.fn();
    const scheduler = createReferenceLookupScheduler({
      fetchers: { getMatches, getTermMatches },
      setResult,
      debounceMs: 350,
    });

    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('a', 'hash-a') });
    await vi.advanceTimersByTimeAsync(350);
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('b', 'hash-b') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('c', 'hash-c') });
    scheduler.update({ enabled: true, projectId: 7, segment: createSegment('d', 'hash-d') });
    await vi.advanceTimersByTimeAsync(350);
    expect(getMatches).toHaveBeenCalledTimes(1);

    a.resolve([{ id: 'tm-a' }] as TMMatch[]);
    await Promise.resolve();
    expect(setResult).not.toHaveBeenCalledWith({ matches: [{ id: 'tm-a' }], terms: [] });
    expect(getMatches).toHaveBeenCalledTimes(2);
    expect(getMatches.mock.calls[1][1].segmentId).toBe('d');

    d.resolve([{ id: 'tm-d' }] as TMMatch[]);
    await Promise.resolve();
    expect(setResult).toHaveBeenLastCalledWith({ matches: [{ id: 'tm-d' }], terms: [] });
  });

});
```

- [ ] **Step 4: Run tests and confirm failure**

Run:

```bash
npx vitest run apps\desktop\src\renderer\src\hooks\editor\useReferenceLookupController.test.ts
```

Expected: FAIL because `useReferenceLookupController.ts` does not exist.

- [ ] **Step 5: Commit failing tests**

```bash
git add apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts
git commit -m "test: cover reference lookup controller"
```

---

## Task 2: Renderer Controller Implementation and Editor Wiring

**Files:**
- Create: `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/useEditor.ts`
- Delete: `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts`
- Delete: `apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.test.ts`

- [ ] **Step 1: Implement controller types and loader**

Create `useReferenceLookupController.ts` with these exported types and factory:

```ts
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

export const REFERENCE_LOOKUP_DEBOUNCE_MS = 350;

export interface ReferenceLookupFetchers {
  getMatches: (projectId: number, segment: Segment) => Promise<TMMatch[]>;
  getTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;
}

export interface ReferenceLookupResult {
  matches: TMMatch[];
  terms: TBMatch[];
}

export interface UseReferenceLookupControllerParams {
  enabled: boolean;
  activeSegmentId: string | null;
  activeSegmentSourceHash: string | null;
  projectId: number | null;
  segments: readonly Segment[];
  fetchers?: ReferenceLookupFetchers;
}

export function getReferenceLookupCacheKey(projectId: number, segment: Segment): string {
  return `${projectId}:${segment.srcHash}`;
}
```

Implement `createReferenceLookupControllerLoader(fetchers)` with:

- `completed = new Map<string, ReferenceLookupResult>()`
- `inFlight = new Map<string, Promise<ReferenceLookupResult>>()`
- `clear(projectId?: number | null)`
- `invalidateProject(projectId: number | null)`
- `getCached(projectId, segment)`
- `load({ projectId, segment })`

`load()` must use `Promise.allSettled` exactly like the old loader: fulfilled TM plus failed TB returns `{ matches: tmMatches, terms: [] }`. Cache only when both TM and TB fulfill. Always delete the in-flight entry in `finally`.

- [ ] **Step 2: Implement pure scheduler**

Add these scheduler types and factory:

```ts
interface ReferenceLookupSchedulerState {
  enabled: boolean;
  projectId: number | null;
  segment: Segment | null;
}

interface ReferenceLookupSchedulerOptions {
  fetchers: ReferenceLookupFetchers;
  setResult: (result: ReferenceLookupResult) => void;
  debounceMs?: number;
}

export function createReferenceLookupScheduler(options: ReferenceLookupSchedulerOptions) {
  const loader = createReferenceLookupControllerLoader(options.fetchers);
  let currentKey: string | null = null;
  let runningKey: string | null = null;
  let queuedLatest: { projectId: number; segment: Segment; key: string } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let latestState: ReferenceLookupSchedulerState = {
    enabled: false,
    projectId: null,
    segment: null,
  };

  return {
    update(nextState: ReferenceLookupSchedulerState): void {
      latestState = nextState;
      schedule(nextState);
    },
    invalidate(projectId: number | null): void {
      loader.invalidateProject(projectId);
      // Task 3 extends this to reschedule current lookup
    },
    dispose(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      queuedLatest = null;
      currentKey = null;
    },
  };
}
```

Behavior:

- If disabled, missing project, or missing segment:
  - set `currentKey = null`
  - clear debounce timer
  - clear queued latest
  - call `setResult({ matches: [], terms: [] })`
- If cached:
  - clear queued latest
  - call `setResult(cached)`
- Otherwise debounce `REFERENCE_LOOKUP_DEBOUNCE_MS`.
- `startLookup(projectId, segment, key)`:
  - if `runningKey` exists, set `queuedLatest = { projectId, segment, key }` and return.
  - set running key.
  - await `loader.load`.
  - only call `setResult(result)` if current key still matches and latest state is enabled.
  - clear running key.
  - if queued latest exists and still differs from the just-finished key, start it next.

This pure scheduler is the only place that owns debounce, latest-only queue, and stale-result checks.

- [ ] **Step 3: Implement React hook wrapper**

In `useReferenceLookupController`, use React only to:

- resolve `activeSegmentId` to a `Segment | null`;
- own `activeMatches` and `activeTerms` state;
- create the scheduler in a ref;
- call `scheduler.update({ enabled, projectId, segment })` from an effect;
- call `scheduler.dispose()` on unmount.

Core hook skeleton:

```ts
export function useReferenceLookupController({
  enabled,
  activeSegmentId,
  activeSegmentSourceHash,
  projectId,
  segments,
  fetchers = {
    getMatches: apiClient.getMatches,
    getTermMatches: apiClient.getTermMatches,
  },
}: UseReferenceLookupControllerParams): {
  activeMatches: TMMatch[];
  activeTerms: TBMatch[];
} {
  const [activeMatches, setActiveMatches] = useState<TMMatch[]>([]);
  const [activeTerms, setActiveTerms] = useState<TBMatch[]>([]);
  const segmentsRef = useRef(segments);
  const schedulerRef = useRef<ReturnType<typeof createReferenceLookupScheduler> | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  if (!schedulerRef.current) {
    schedulerRef.current = createReferenceLookupScheduler({
      fetchers,
      setResult: (result) => {
        setActiveMatches(result.matches);
        setActiveTerms(result.terms);
      },
      debounceMs: REFERENCE_LOOKUP_DEBOUNCE_MS,
    });
  }

  const activeSegment = activeSegmentId
    ? segmentsRef.current.find((item) => item.segmentId === activeSegmentId) ?? null
    : null;

  useEffect(() => {
    schedulerRef.current?.update({ enabled, projectId, segment: activeSegment });
  }, [enabled, projectId, activeSegmentId, activeSegmentSourceHash, activeSegment]);

  useEffect(() => () => schedulerRef.current?.dispose(), []);

  return { activeMatches, activeTerms };
}
```

If the `fetchers` object can change in tests, document that callers should pass a stable object. Production uses the default `apiClient` fetchers.

- [ ] **Step 4: Wire into `useEditor.ts`**

Replace:

```ts
const { activeMatches, activeTerms } = useActiveSegmentMatches({
  activeSegmentId,
  activeSegmentSourceHash,
  projectId,
  segments,
});
```

With:

```ts
const { activeMatches, activeTerms } = useReferenceLookupController({
  enabled: activeTab === 'tm',
  activeSegmentId,
  activeSegmentSourceHash,
  projectId,
  segments,
});
```

Update the import from `useActiveSegmentMatches` to `useReferenceLookupController`.

- [ ] **Step 5: Remove old hook test or migrate imports**

Delete `useActiveSegmentMatches.test.ts` if no code imports `createActiveSegmentMatchLoader`. If a temporary wrapper is kept, replace its test with an import compatibility test:

```ts
import { createReferenceLookupControllerLoader } from './useReferenceLookupController';

describe('useActiveSegmentMatches compatibility', () => {
  it('uses the reference lookup controller loader', () => {
    expect(createReferenceLookupControllerLoader).toBeTypeOf('function');
  });
});
```

Preferred outcome: no `useActiveSegmentMatches.ts` import remains.

- [ ] **Step 6: Run renderer tests**

Run:

```bash
npx vitest run apps\desktop\src\renderer\src\hooks\editor\useReferenceLookupController.test.ts apps\desktop\src\renderer\src\hooks\useEditor.test.ts apps\desktop\src\renderer\src\components\Editor.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit renderer controller**

```bash
git add apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts apps/desktop/src/renderer/src/hooks/useEditor.ts apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.ts apps/desktop/src/renderer/src/hooks/editor/useActiveSegmentMatches.test.ts
git commit -m "feat: add latest-only reference lookup controller"
```

If a deleted file is not present, `git add -A apps/desktop/src/renderer/src/hooks/editor apps/desktop/src/renderer/src/hooks/useEditor.ts` is acceptable.

---

## Task 3: Reference Data Invalidation Event

**Files:**
- Modify: `apps/desktop/src/shared/ipc.ts`
- Modify: `apps/desktop/src/shared/ipcChannels.ts`
- Modify: `apps/desktop/src/preload/api/eventApi.ts`
- Modify: `apps/desktop/src/preload/api/createDesktopApi.test.ts`
- Modify: `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts`
- Test: `apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts`

- [ ] **Step 1: Add shared channel**

In `ipcChannels.ts`, add:

```ts
events: {
  segmentsUpdated: 'segments-updated',
  segmentsUpdatedBatch: 'segments-updated-batch',
  appProgress: 'app-progress',
  jobProgress: 'job-progress',
  appUpdateStatus: 'app-update-status',
  referenceDataChanged: 'reference-data-changed',
}
```

- [ ] **Step 2: Add shared event type and API method**

In `ipc.ts`, add:

```ts
export interface ReferenceDataChangedEvent {
  projectId: number | null;
  kind: 'tm' | 'tb' | 'all';
  reason:
    | 'tm-created'
    | 'tm-deleted'
    | 'tm-mounted'
    | 'tm-unmounted'
    | 'tm-imported'
    | 'tm-committed'
    | 'tm-batch-matched'
    | 'tb-created'
    | 'tb-deleted'
    | 'tb-mounted'
    | 'tb-unmounted'
    | 'tb-imported';
}
```

Add to `DesktopApi`:

```ts
onReferenceDataChanged: (callback: (event: ReferenceDataChangedEvent) => void) => () => void;
```

- [ ] **Step 3: Add preload event subscription**

In `eventApi.ts`, extend `EventApiKeys` with `'onReferenceDataChanged'` and add:

```ts
onReferenceDataChanged: (callback) => {
  const listener = (_event: IpcRendererEvent, ...args: unknown[]) => {
    const [event] = args as [Parameters<typeof callback>[0]];
    callback(event);
  };
  ipcRenderer.on(IPC_CHANNELS.events.referenceDataChanged, listener);
  return () => ipcRenderer.removeListener(IPC_CHANNELS.events.referenceDataChanged, listener);
},
```

- [ ] **Step 4: Extend preload test**

In `createDesktopApi.test.ts`, add assertion similar to existing event listener tests:

```ts
const referenceDataListeners = listenerStore.get(IPC_CHANNELS.events.referenceDataChanged) ?? [];
expect(referenceDataListeners).toHaveLength(0);

const onReferenceDataChanged = vi.fn();
const unsubscribe = api.onReferenceDataChanged(onReferenceDataChanged);
const listeners = listenerStore.get(IPC_CHANNELS.events.referenceDataChanged) ?? [];
expect(listeners).toHaveLength(1);

listeners[0]({}, { projectId: 7, kind: 'tm', reason: 'tm-mounted' });
expect(onReferenceDataChanged).toHaveBeenCalledWith({
  projectId: 7,
  kind: 'tm',
  reason: 'tm-mounted',
});

unsubscribe();
expect(listenerStore.get(IPC_CHANNELS.events.referenceDataChanged) ?? []).toHaveLength(0);
```

- [ ] **Step 5: Add scheduler invalidation test**

Add this pure scheduler test to `useReferenceLookupController.test.ts` after shared types exist:

```ts
it('invalidates cached current results and refetches when reference data changes', async () => {
  const getMatches = vi
    .fn()
    .mockResolvedValueOnce([{ id: 'tm-first' }] as TMMatch[])
    .mockResolvedValueOnce([{ id: 'tm-second' }] as TMMatch[]);
  const getTermMatches = vi.fn(async () => [] as TBMatch[]);
  const setResult = vi.fn();
  const scheduler = createReferenceLookupScheduler({
    fetchers: { getMatches, getTermMatches },
    setResult,
    debounceMs: 350,
  });
  const segment = createSegment('seg-1', 'hash');

  scheduler.update({
    enabled: true,
    projectId: 7,
    segment,
  });
  await vi.advanceTimersByTimeAsync(350);
  expect(setResult).toHaveBeenLastCalledWith({
    matches: [{ id: 'tm-first' }],
    terms: [],
  });

  scheduler.invalidate(7);
  await vi.advanceTimersByTimeAsync(350);

  expect(getMatches).toHaveBeenCalledTimes(2);
  expect(setResult).toHaveBeenLastCalledWith({
    matches: [{ id: 'tm-second' }],
    terms: [],
  });
});
```

- [ ] **Step 6: Add controller invalidation implementation**

Extend `UseReferenceLookupControllerParams`:

```ts
subscribeToReferenceDataChanged?: (
  callback: (event: ReferenceDataChangedEvent) => void,
) => () => void;
```

Inside the hook:

```ts
const subscribe = params.subscribeToReferenceDataChanged ?? apiClient.onReferenceDataChanged;
```

If `subscribe` exists, subscribe in an effect. On event:

- If `event.projectId === null`, clear all loader caches.
- If `event.projectId === projectId`, clear cache for that project.
- If enabled and there is a current segment for the invalidated project, schedule a fresh lookup for current segment.

Do not use `as any`; the shared `DesktopApi` type now includes `onReferenceDataChanged`.

- [ ] **Step 7: Run invalidation tests**

Run:

```bash
npx vitest run apps\desktop\src\preload\api\createDesktopApi.test.ts apps\desktop\src\renderer\src\hooks\editor\useReferenceLookupController.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit invalidation event API**

```bash
git add apps/desktop/src/shared/ipc.ts apps/desktop/src/shared/ipcChannels.ts apps/desktop/src/preload/api/eventApi.ts apps/desktop/src/preload/api/createDesktopApi.test.ts apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.ts apps/desktop/src/renderer/src/hooks/editor/useReferenceLookupController.test.ts
git commit -m "feat: add reference data invalidation event"
```

---

## Task 4: Worker Protocol and Manager Tests

**Files:**
- Create: `apps/desktop/src/main/services/referenceLookup/types.ts`
- Create: `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts`
- Read: `apps/desktop/src/main/services/modules/tm/TMImportService.ts`

- [ ] **Step 1: Add protocol types**

Create `types.ts`:

```ts
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMConcordanceEntry, TMMatch } from '../../../shared/ipc';

export type ReferenceLookupRequestKind = 'tm' | 'tb' | 'concordance';

export type ReferenceLookupWorkerRequest =
  | { requestId: number; kind: 'tm'; projectId: number; segment: Segment }
  | { requestId: number; kind: 'tb'; projectId: number; segment: Segment }
  | { requestId: number; kind: 'concordance'; projectId: number; query: string };

export type ReferenceLookupWorkerResponse =
  | {
      requestId: number;
      ok: true;
      kind: 'tm';
      result: TMMatch[];
    }
  | {
      requestId: number;
      ok: true;
      kind: 'tb';
      result: TBMatch[];
    }
  | {
      requestId: number;
      ok: true;
      kind: 'concordance';
      result: TMConcordanceEntry[];
    }
  | {
      requestId: number;
      ok: false;
      kind: ReferenceLookupRequestKind;
      error: string;
    };

export interface ReferenceLookupService {
  findTmMatches(projectId: number, segment: Segment): Promise<TMMatch[]>;
  findTbMatches(projectId: number, segment: Segment): Promise<TBMatch[]>;
  searchConcordance(projectId: number, query: string): Promise<TMConcordanceEntry[]>;
}
```

- [ ] **Step 2: Write mock Worker and manager tests**

Create `ReferenceLookupWorkerManager.test.ts`:

```ts
import { EventEmitter } from 'events';
import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { ReferenceLookupWorkerManager } from './ReferenceLookupWorkerManager';
import type { ReferenceLookupWorkerResponse } from './types';

class MockWorker extends EventEmitter {
  public readonly postMessage = vi.fn();
  public readonly terminate = vi.fn(async () => 0);
}

function createSegment(segmentId = 'seg-1'): Segment {
  return {
    segmentId,
    fileId: 1,
    orderIndex: 0,
    sourceTokens: [{ type: 'text', content: 'Source' }],
    targetTokens: [],
    status: 'new',
    matchKey: 'source',
    srcHash: 'hash',
    tagsSignature: '',
    meta: { updatedAt: '2026-07-02T00:00:00.000Z' },
  };
}

function createManager() {
  const workers: MockWorker[] = [];
  const workerFactory = vi.fn(() => {
    const worker = new MockWorker();
    workers.push(worker);
    return worker;
  });
  const manager = new ReferenceLookupWorkerManager({
    dbPath: 'cat.db',
    workerFactory,
    workerPathCandidates: ['referenceLookupWorker.js'],
  });
  return { manager, workers, workerFactory };
}

describe('ReferenceLookupWorkerManager', () => {
  it('sends TM requests with unique ids and resolves matching responses', async () => {
    const { manager, workers } = createManager();
    const promise = manager.findTmMatches(7, createSegment());

    expect(workers).toHaveLength(1);
    expect(workers[0].postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 1, kind: 'tm', projectId: 7 }),
    );

    workers[0].emit('message', {
      requestId: 1,
      ok: true,
      kind: 'tm',
      result: [{ id: 'tm-1' }],
    } satisfies ReferenceLookupWorkerResponse);

    await expect(promise).resolves.toEqual([{ id: 'tm-1' }]);
  });

  it('supports TB and Concordance request kinds', async () => {
    const { manager, workers } = createManager();
    const tbPromise = manager.findTbMatches(7, createSegment('tb-seg'));
    const concordancePromise = manager.searchConcordance(7, 'query');

    expect(workers[0].postMessage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ requestId: 1, kind: 'tb' }),
    );
    expect(workers[0].postMessage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ requestId: 2, kind: 'concordance', query: 'query' }),
    );

    workers[0].emit('message', { requestId: 1, ok: true, kind: 'tb', result: [] });
    workers[0].emit('message', { requestId: 2, ok: true, kind: 'concordance', result: [] });

    await expect(tbPromise).resolves.toEqual([]);
    await expect(concordancePromise).resolves.toEqual([]);
  });

  it('rejects matching requests on worker error responses and ignores unknown ids', async () => {
    const { manager, workers } = createManager();
    const promise = manager.findTmMatches(7, createSegment());

    workers[0].emit('message', { requestId: 99, ok: true, kind: 'tm', result: [] });
    workers[0].emit('message', {
      requestId: 1,
      ok: false,
      kind: 'tm',
      error: 'lookup failed',
    });

    await expect(promise).rejects.toThrow('lookup failed');
  });

  it('rejects all pending requests on crash and lazy restarts next time', async () => {
    const { manager, workers, workerFactory } = createManager();
    const first = manager.findTmMatches(7, createSegment('a'));
    const second = manager.findTbMatches(7, createSegment('b'));

    workers[0].emit('error', new Error('worker died'));
    await expect(first).rejects.toThrow('worker died');
    await expect(second).rejects.toThrow('worker died');

    const next = manager.searchConcordance(7, 'query');
    expect(workerFactory).toHaveBeenCalledTimes(2);
    workers[1].emit('message', { requestId: 3, ok: true, kind: 'concordance', result: [] });
    await expect(next).resolves.toEqual([]);
  });

  it('terminates the worker and rejects pending requests on dispose', async () => {
    const { manager, workers } = createManager();
    const pending = manager.findTmMatches(7, createSegment());

    await manager.dispose();

    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    await expect(pending).rejects.toThrow('Reference lookup worker disposed');
  });
});
```

- [ ] **Step 3: Run tests and confirm failure**

Run:

```bash
npx vitest run apps\desktop\src\main\services\referenceLookup\ReferenceLookupWorkerManager.test.ts
```

Expected: FAIL because `ReferenceLookupWorkerManager.ts` does not exist.

- [ ] **Step 4: Commit protocol and failing manager tests**

```bash
git add apps/desktop/src/main/services/referenceLookup/types.ts apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts
git commit -m "test: cover reference lookup worker manager"
```

---

## Task 5: Worker Manager Implementation

**Files:**
- Create: `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.ts`
- Test: `apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts`

- [ ] **Step 1: Implement WorkerLike and constructor**

Add:

```ts
import { access } from 'fs/promises';
import { join } from 'path';
import { Worker } from 'worker_threads';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMConcordanceEntry, TMMatch } from '../../../shared/ipc';
import type {
  ReferenceLookupService,
  ReferenceLookupWorkerRequest,
  ReferenceLookupWorkerResponse,
} from './types';

interface WorkerLike {
  postMessage(message: ReferenceLookupWorkerRequest): void;
  on(event: 'message', listener: (message: ReferenceLookupWorkerResponse) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  on(event: 'exit', listener: (code: number) => void): unknown;
  terminate(): Promise<number> | number;
}

type WorkerFactory = (workerPath: string, options: { workerData: { dbPath: string } }) => WorkerLike;

interface PendingRequest<T> {
  kind: ReferenceLookupWorkerRequest['kind'];
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

interface ReferenceLookupWorkerManagerOptions {
  dbPath: string;
  workerFactory?: WorkerFactory;
  workerPathCandidates?: string[];
}
```

- [ ] **Step 2: Implement path resolution and request dispatch**

Implement class:

```ts
export class ReferenceLookupWorkerManager implements ReferenceLookupService {
  private worker: WorkerLike | null = null;
  private workerPath: string | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest<unknown>>();

  constructor(private readonly options: ReferenceLookupWorkerManagerOptions) {}

  public findTmMatches(projectId: number, segment: Segment): Promise<TMMatch[]> {
    return this.request<TMMatch[]>({ requestId: 0, kind: 'tm', projectId, segment });
  }

  public findTbMatches(projectId: number, segment: Segment): Promise<TBMatch[]> {
    return this.request<TBMatch[]>({ requestId: 0, kind: 'tb', projectId, segment });
  }

  public searchConcordance(projectId: number, query: string): Promise<TMConcordanceEntry[]> {
    return this.request<TMConcordanceEntry[]>({ requestId: 0, kind: 'concordance', projectId, query });
  }
}
```

`request()` must assign the real request ID before posting:

```ts
const requestId = this.nextRequestId;
this.nextRequestId += 1;
const message = { ...request, requestId } as ReferenceLookupWorkerRequest;
```

`ensureWorker()` must:

- resolve candidate paths once;
- create a Worker with `{ workerData: { dbPath } }`;
- attach `message`, `error`, and `exit` handlers.

Use default candidates:

```ts
[
  join(__dirname, 'referenceLookupWorker.js'),
  join(__dirname, '../referenceLookupWorker.js'),
  join(__dirname, '../../referenceLookupWorker.js'),
]
```

Use `access(candidate)` to find the first existing path.

- [ ] **Step 3: Implement message/crash/dispose handling**

Implement:

```ts
private handleMessage(message: ReferenceLookupWorkerResponse): void {
  const pending = this.pending.get(message.requestId);
  if (!pending) return;
  this.pending.delete(message.requestId);
  if (!message.ok) {
    pending.reject(new Error(message.error || 'Reference lookup worker failed'));
    return;
  }
  pending.resolve(message.result);
}
```

`failAll(error)` rejects and clears every pending request.

On `error`, call `failAll(error)` and set `worker = null`.

On non-zero `exit`, call `failAll(new Error(...))` and set `worker = null`. On zero `exit`, just clear `worker` after any explicit dispose.

`dispose()` must terminate the worker and reject pending with `Reference lookup worker disposed`.

- [ ] **Step 4: Run manager tests**

Run:

```bash
npx vitest run apps\desktop\src\main\services\referenceLookup\ReferenceLookupWorkerManager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit manager implementation**

```bash
git add apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.ts apps/desktop/src/main/services/referenceLookup/ReferenceLookupWorkerManager.test.ts
git commit -m "feat: add reference lookup worker manager"
```

---

## Task 6: Worker Body

**Files:**
- Create: `apps/desktop/src/main/referenceLookupWorker.ts`
- Read: `apps/desktop/src/main/tmImportWorker.ts`
- Read: `apps/desktop/src/main/services/ProjectService.ts`
- Read: `apps/desktop/src/main/services/modules/tm/TMQueryService.ts`

- [ ] **Step 1: Implement worker bootstrap**

Create `referenceLookupWorker.ts`:

```ts
import { parentPort, workerData } from 'worker_threads';
import { CATDatabase } from '@cat/db';
import { TMService } from './services/TMService';
import { TBService } from './services/TBService';
import { SqliteProjectRepository } from './services/adapters/SqliteProjectRepository';
import { SqliteTMRepository } from './services/adapters/SqliteTMRepository';
import { SqliteTBRepository } from './services/adapters/SqliteTBRepository';
import { TMQueryService } from './services/modules/tm/TMQueryService';
import type {
  ReferenceLookupWorkerRequest,
  ReferenceLookupWorkerResponse,
} from './services/referenceLookup/types';

interface ReferenceLookupWorkerInput {
  dbPath: string;
}

const port = parentPort;
if (!port) {
  throw new Error('Reference lookup worker requires parentPort');
}

const input = workerData as ReferenceLookupWorkerInput;
const db = new CATDatabase(input.dbPath, { readonly: true, fileMustExist: true });
const projectRepo = new SqliteProjectRepository(db);
const tmRepo = new SqliteTMRepository(db);
const tbRepo = new SqliteTBRepository(db);
const tmService = new TMService(projectRepo, tmRepo);
const tbService = new TBService(projectRepo, tbRepo);
const tmQueryService = new TMQueryService(tmRepo, tmService);
```

- [ ] **Step 2: Implement request handler without changing business logic**

Add:

```ts
async function handleRequest(
  message: ReferenceLookupWorkerRequest,
): Promise<ReferenceLookupWorkerResponse> {
  if (message.kind === 'tm') {
    return {
      requestId: message.requestId,
      kind: 'tm',
      ok: true,
      result: await tmService.findMatches(message.projectId, message.segment),
    };
  }

  if (message.kind === 'tb') {
    return {
      requestId: message.requestId,
      kind: 'tb',
      ok: true,
      result: await tbService.findMatches(message.projectId, message.segment),
    };
  }

  return {
    requestId: message.requestId,
    kind: 'concordance',
    ok: true,
    result: await tmQueryService.searchConcordance(message.projectId, message.query),
  };
}

port.on('message', (message: ReferenceLookupWorkerRequest) => {
  void handleRequest(message)
    .then((response) => port.postMessage(response))
    .catch((error) => {
      port.postMessage({
        requestId: message.requestId,
        kind: message.kind,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      } satisfies ReferenceLookupWorkerResponse);
    });
});
```

Do not modify `TMService`, `TBService`, `TMQueryService`, `TMRepo`, `TBRepo`, or AI prompt-reference code.

- [ ] **Step 3: Run typecheck for worker imports**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS. If it fails because of worker import paths or shared type paths, fix imports only.

- [ ] **Step 4: Commit worker body**

```bash
git add apps/desktop/src/main/referenceLookupWorker.ts
git commit -m "feat: add reference lookup worker"
```

---

## Task 7: IPC Handler Handoff and Invalidation Emission

**Files:**
- Modify: `apps/desktop/src/main/ipc/types.ts`
- Modify: `apps/desktop/src/main/ipc/tmHandlers.ts`
- Modify: `apps/desktop/src/main/ipc/tbHandlers.ts`
- Modify: `apps/desktop/src/main/ipc/handlerRegistration.test.ts`
- Modify: `apps/desktop/src/main/ipc/importJobHandlers.test.ts`
- Add or modify: `apps/desktop/src/main/ipc/referenceLookupHandlers.test.ts`

- [ ] **Step 1: Add IPC dependency types**

In `ipc/types.ts`, add:

```ts
import type { ReferenceDataChangedEvent } from '../../shared/ipc';
import type { ReferenceLookupService } from '../services/referenceLookup/types';

export type ReferenceDataChangedNotifier = (event: ReferenceDataChangedEvent) => void;

export interface ReferenceBackedHandlerDeps extends JobBackedHandlerDeps {
  referenceLookup: ReferenceLookupService;
  notifyReferenceDataChanged: ReferenceDataChangedNotifier;
}
```

Do not add these fields to `JobBackedHandlerDeps`; AI handlers use that type and do not need reference lookup.

- [ ] **Step 2: Write handler delegation tests**

Create `referenceLookupHandlers.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerTBHandlers } from './tbHandlers';
import { registerTMHandlers } from './tmHandlers';
import type { IpcMainListener } from './types';

function createHarness() {
  const handlers = new Map<string, IpcMainListener>();
  const ipcMain = {
    handle: (channel: string, listener: IpcMainListener) => handlers.set(channel, listener),
  };
  const projectService = {
    findMatches: vi.fn(),
    findTermMatches: vi.fn(),
    searchConcordance: vi.fn(),
  };
  const referenceLookup = {
    findTmMatches: vi.fn().mockResolvedValue([{ id: 'tm-1' }]),
    findTbMatches: vi.fn().mockResolvedValue([{ id: 'tb-1' }]),
    searchConcordance: vi.fn().mockResolvedValue([{ id: 'conc-1' }]),
  };
  const notifyReferenceDataChanged = vi.fn();
  const jobManager = { startJob: vi.fn(), updateProgress: vi.fn() };
  return { handlers, ipcMain, projectService, referenceLookup, notifyReferenceDataChanged, jobManager };
}

describe('reference lookup IPC handlers', () => {
  it('delegates TM, TB, and Concordance lookups to the worker manager', async () => {
    const deps = createHarness();
    registerTMHandlers(deps as never);
    registerTBHandlers(deps as never);

    await expect(deps.handlers.get(IPC_CHANNELS.tm.getMatches)?.({}, 7, { segmentId: 'seg' })).resolves.toEqual([{ id: 'tm-1' }]);
    await expect(deps.handlers.get(IPC_CHANNELS.tb.getMatches)?.({}, 7, { segmentId: 'seg' })).resolves.toEqual([{ id: 'tb-1' }]);
    await expect(deps.handlers.get(IPC_CHANNELS.tm.concordance)?.({}, 7, 'query')).resolves.toEqual([{ id: 'conc-1' }]);

    expect(deps.referenceLookup.findTmMatches).toHaveBeenCalledTimes(1);
    expect(deps.referenceLookup.findTbMatches).toHaveBeenCalledTimes(1);
    expect(deps.referenceLookup.searchConcordance).toHaveBeenCalledTimes(1);
    expect(deps.projectService.findMatches).not.toHaveBeenCalled();
    expect(deps.projectService.findTermMatches).not.toHaveBeenCalled();
    expect(deps.projectService.searchConcordance).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Modify TM handlers**

Change `registerTMHandlers` signature to accept `ReferenceBackedHandlerDeps`.

For lookup handlers:

```ts
return referenceLookup.findTmMatches(projectId, segment);
return referenceLookup.searchConcordance(projectId, query);
```

For mutation handlers, emit after successful result:

```ts
const tmId = await projectService.createTM(name, srcLang, tgtLang, type);
notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-created' });
return tmId;
```

Use specific project IDs where available:

```ts
await projectService.mountTMToProject(projectId, tmId, priority, permission);
notifyReferenceDataChanged({ projectId, kind: 'tm', reason: 'tm-mounted' });
```

For `importExecute`, emit inside the `.then()` success branch after the job is marked completed:

```ts
notifyReferenceDataChanged({ projectId: null, kind: 'tm', reason: 'tm-imported' });
```

For `commitFile` and `matchFile`, use `projectId: null` unless the handler can cheaply resolve project ID without new DB work. Keep it coarse.

- [ ] **Step 4: Modify TB handlers**

Change `registerTBHandlers` signature to accept `ReferenceBackedHandlerDeps`.

For lookup handler:

```ts
return referenceLookup.findTbMatches(projectId, segment);
```

For mutations:

```ts
notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-created' });
notifyReferenceDataChanged({ projectId: null, kind: 'tb', reason: 'tb-deleted' });
notifyReferenceDataChanged({ projectId, kind: 'tb', reason: 'tb-mounted' });
notifyReferenceDataChanged({ projectId, kind: 'tb', reason: 'tb-unmounted' });
```

For `importExecute`, emit `{ projectId: null, kind: 'tb', reason: 'tb-imported' }` in the success branch.

- [ ] **Step 5: Update existing handler tests**

Update `handlerRegistration.test.ts` and `importJobHandlers.test.ts` to pass:

```ts
const referenceLookup = {
  findTmMatches: vi.fn(),
  findTbMatches: vi.fn(),
  searchConcordance: vi.fn(),
};
const notifyReferenceDataChanged = vi.fn();
```

Then call:

```ts
registerTMHandlers({ ipcMain, projectService, jobManager, referenceLookup, notifyReferenceDataChanged });
registerTBHandlers({ ipcMain, projectService, jobManager, referenceLookup, notifyReferenceDataChanged });
```

- [ ] **Step 6: Run handler tests**

Run:

```bash
npx vitest run apps\desktop\src\main\ipc\referenceLookupHandlers.test.ts apps\desktop\src\main\ipc\handlerRegistration.test.ts apps\desktop\src\main\ipc\importJobHandlers.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit IPC handoff**

```bash
git add apps/desktop/src/main/ipc/types.ts apps/desktop/src/main/ipc/tmHandlers.ts apps/desktop/src/main/ipc/tbHandlers.ts apps/desktop/src/main/ipc/referenceLookupHandlers.test.ts apps/desktop/src/main/ipc/handlerRegistration.test.ts apps/desktop/src/main/ipc/importJobHandlers.test.ts
git commit -m "feat: route reference lookup ipc through worker"
```

---

## Task 8: Main App Wiring

**Files:**
- Modify: `apps/desktop/src/main/index.ts`
- Test: `apps/desktop/src/main/ipc/handlerRegistration.test.ts`

- [ ] **Step 1: Instantiate manager**

In `main/index.ts`, after `jobManager` creation:

```ts
const referenceLookupWorkerManager = new ReferenceLookupWorkerManager({ dbPath });
```

Add import:

```ts
import { ReferenceLookupWorkerManager } from './services/referenceLookup/ReferenceLookupWorkerManager';
```

- [ ] **Step 2: Add broadcaster**

Add helper near other broadcast helpers:

```ts
const broadcastReferenceDataChanged = (event: ReferenceDataChangedEvent) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send(IPC_CHANNELS.events.referenceDataChanged, event);
  });
};
```

Import `ReferenceDataChangedEvent` as a type from `../shared/ipc`.

- [ ] **Step 3: Pass dependencies into TM/TB handlers**

Replace:

```ts
registerTMHandlers({ ipcMain, projectService, jobManager });
registerTBHandlers({ ipcMain, projectService, jobManager });
```

With:

```ts
registerTMHandlers({
  ipcMain,
  projectService,
  jobManager,
  referenceLookup: referenceLookupWorkerManager,
  notifyReferenceDataChanged: broadcastReferenceDataChanged,
});
registerTBHandlers({
  ipcMain,
  projectService,
  jobManager,
  referenceLookup: referenceLookupWorkerManager,
  notifyReferenceDataChanged: broadcastReferenceDataChanged,
});
```

- [ ] **Step 4: Dispose on app shutdown**

Inside the existing `app.whenReady().then(async () => { ... })` setup closure, after `referenceLookupWorkerManager` is created, add:

```ts
app.on('before-quit', () => {
  void referenceLookupWorkerManager.dispose();
});
```

- [ ] **Step 5: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 6: Commit main wiring**

```bash
git add apps/desktop/src/main/index.ts
git commit -m "feat: wire reference lookup worker into main process"
```

---

## Task 9: Business Logic Regression Guard

**Files:**
- Do not modify business logic files unless type imports require it:
  - `packages/localization/src/services/TMService.ts`
  - `packages/localization/src/services/TBService.ts`
  - `packages/db/src/repos/TMRepo.ts`
  - `packages/db/src/repos/TBRepo.ts`
  - `apps/desktop/src/main/services/modules/ai/promptReferences.ts`
  - AI translate workflows.

- [ ] **Step 1: Confirm no prohibited business files changed**

Run:

```bash
git diff --name-only HEAD
```

Expected: no changed files under `packages/localization/src/services`, `packages/db/src/repos`, or AI prompt-reference/workflow files unless they are purely import/type changes approved by the user.

- [ ] **Step 2: Run TM/TB service regression tests**

Run:

```bash
npx vitest run apps\desktop\src\main\services\TMService.test.ts apps\desktop\src\main\services\TBService.test.ts
```

Expected: PASS. If failures show changed matching output, stop and investigate as a regression.

- [ ] **Step 3: Run AI prompt-reference regression tests**

Run:

```bash
npx vitest run apps\desktop\src\main\services\modules\ai\promptReferences.test.ts
```

Expected: PASS. If failures show changed prompt-reference ordering/formatting/fallback, stop and investigate as a regression.

- [ ] **Step 4: Run selected AIModule prompt-reference tests**

Run:

```bash
npx vitest run apps\desktop\src\main\services\modules\AIModule.test.ts -t "injects concordance matches separately from TM references|skips prompt references|continues when prompt reference lookup fails"
```

Expected: PASS. If the test-name filter does not match current test names, run:

```bash
npx vitest run apps\desktop\src\main\services\modules\AIModule.test.ts -t "reference"
```

Expected: PASS for matching reference tests.

- [ ] **Step 5: Commit regression guard only if test files changed**

If no files changed in this task, do not commit. If this task added or changed a regression test file, run `git status --short`, stage the exact file path shown by Git, and commit with:

```bash
git commit -m "test: guard reference lookup business behavior"
```

---

## Task 10: Final Verification

**Files:**
- All files changed by previous tasks.

- [ ] **Step 1: Run targeted full set**

Run:

```bash
npx vitest run apps\desktop\src\renderer\src\hooks\editor\useReferenceLookupController.test.ts apps\desktop\src\renderer\src\hooks\useEditor.test.ts apps\desktop\src\renderer\src\components\Editor.test.ts apps\desktop\src\preload\api\createDesktopApi.test.ts apps\desktop\src\main\services\referenceLookup\ReferenceLookupWorkerManager.test.ts apps\desktop\src\main\ipc\referenceLookupHandlers.test.ts apps\desktop\src\main\ipc\handlerRegistration.test.ts apps\desktop\src\main\ipc\importJobHandlers.test.ts apps\desktop\src\main\services\modules\ai\promptReferences.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
npm run typecheck --workspace=apps/desktop
```

Expected: PASS.

- [ ] **Step 3: Run build or worker path verification**

Run:

```bash
npm run build:app
```

Expected: PASS and generated output includes `referenceLookupWorker.js` in a path covered by `ReferenceLookupWorkerManager` candidates.

If build is too slow for the current iteration, run typecheck plus inspect emitted build config before claiming completion. Do not claim worker packaging is verified unless a build or equivalent output check ran.

- [ ] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [ ] **Step 5: Inspect final diff for business-boundary violations**

Run:

```bash
git diff --name-only
```

Expected changed files are limited to renderer controller/hook, IPC/preload/shared types, main worker/manager/handler wiring, and tests for those areas. No TM/TB matching or AI prompt-reference business logic files should be modified.

- [ ] **Step 6: Commit verification fixes when verification changed files**

If verification required small fixes, run `git status --short`, stage the exact fixed file paths shown by Git, and commit with:

```bash
git commit -m "fix: stabilize reference lookup worker integration"
```

If there are no changes after verification, do not create an empty commit.

## Self-Review Checklist for Implementer

Before marking implementation complete, answer yes to each:

- [ ] Automatic editor lookup is gated by CAT tab and valid active segment.
- [ ] Rapid active-segment changes do not issue lookups for intermediate stale segments.
- [ ] Duplicate `projectId:srcHash` lookups are deduplicated.
- [ ] Stale results cannot update `activeMatches` or `activeTerms`.
- [ ] `tm-get-matches`, `tb-get-matches`, and `tm-concordance` do not call ProjectService lookup/search methods directly.
- [ ] Worker failure never falls back to main-thread lookup.
- [ ] Reference cache invalidation fires after successful TM/TB reference-data mutations.
- [ ] Batch/file AI translate prompt-reference logic is not rerouted through the worker.
- [ ] Existing TM/TB, Concordance, and AI prompt-reference tests still pass without expected-output changes.
