import { useEffect, useRef, useState } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { ReferenceDataChangedEvent, TMMatch } from '../../../../shared/ipc';

export const REFERENCE_LOOKUP_DEBOUNCE_MS = 150;

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
  subscribeToReferenceDataChanged?: (
    callback: (event: ReferenceDataChangedEvent) => void,
  ) => () => void;
  // The scheduler captures fetchers on first render; callers overriding this
  // should pass a stable object.
  fetchers?: ReferenceLookupFetchers;
}

export function getReferenceLookupCacheKey(projectId: number, segment: Segment): string {
  return `${projectId}:${segment.srcHash}`;
}

let apiClientModulePromise: Promise<typeof import('../../services/apiClient')> | null = null;

async function getApiClient() {
  apiClientModulePromise ??= import('../../services/apiClient');
  return (await apiClientModulePromise).apiClient;
}

const defaultReferenceLookupFetchers: ReferenceLookupFetchers = {
  async getMatches(projectId, segment) {
    return (await getApiClient()).getMatches(projectId, segment);
  },
  async getTermMatches(projectId, segment) {
    return (await getApiClient()).getTermMatches(projectId, segment);
  },
};

function subscribeToDefaultReferenceDataChanged(
  callback: (event: ReferenceDataChangedEvent) => void,
): () => void {
  let disposed = false;
  let unsubscribe: (() => void) | null = null;
  void getApiClient().then((client) => {
    if (disposed) return;
    unsubscribe = client.onReferenceDataChanged(callback);
  });

  return () => {
    disposed = true;
    unsubscribe?.();
  };
}

export function createReferenceLookupControllerLoader(fetchers: ReferenceLookupFetchers) {
  const completed = new Map<string, ReferenceLookupResult>();
  const inFlight = new Map<string, Promise<ReferenceLookupResult>>();
  const projectVersions = new Map<number, number>();
  let globalVersion = 0;

  const deleteProjectEntries = <T>(map: Map<string, T>, projectId: number): void => {
    const prefix = `${projectId}:`;
    for (const key of map.keys()) {
      if (key.startsWith(prefix)) {
        map.delete(key);
      }
    }
  };

  const clear = (projectId?: number | null): void => {
    if (projectId === undefined || projectId === null) {
      globalVersion += 1;
      completed.clear();
      inFlight.clear();
      return;
    }

    projectVersions.set(projectId, (projectVersions.get(projectId) ?? 0) + 1);
    deleteProjectEntries(completed, projectId);
    deleteProjectEntries(inFlight, projectId);
  };

  return {
    clear,
    invalidateProject(projectId: number | null): void {
      clear(projectId);
    },
    getCached(projectId: number, segment: Segment): ReferenceLookupResult | undefined {
      return completed.get(getReferenceLookupCacheKey(projectId, segment));
    },
    load(params: { projectId: number; segment: Segment }): Promise<ReferenceLookupResult> {
      const key = getReferenceLookupCacheKey(params.projectId, params.segment);
      const cached = completed.get(key);
      if (cached) return Promise.resolve(cached);

      const running = inFlight.get(key);
      if (running) return running;

      const loadGlobalVersion = globalVersion;
      const loadProjectVersion = projectVersions.get(params.projectId) ?? 0;
      let promise!: Promise<ReferenceLookupResult>;
      promise = (async () => {
        const [matchesResult, termsResult] = await Promise.allSettled([
          fetchers.getMatches(params.projectId, params.segment),
          fetchers.getTermMatches(params.projectId, params.segment),
        ]);
        const result = {
          matches: matchesResult.status === 'fulfilled' ? matchesResult.value || [] : [],
          terms: termsResult.status === 'fulfilled' ? termsResult.value || [] : [],
        };
        const isCurrent =
          loadGlobalVersion === globalVersion &&
          loadProjectVersion === (projectVersions.get(params.projectId) ?? 0);
        if (isCurrent && matchesResult.status === 'fulfilled' && termsResult.status === 'fulfilled') {
          completed.set(key, result);
        }
        return result;
      })().finally(() => {
        if (inFlight.get(key) === promise) {
          inFlight.delete(key);
        }
      });

      inFlight.set(key, promise);
      return promise;
    },
  };
}

interface ReferenceLookupSchedulerState {
  enabled: boolean;
  projectId: number | null;
  segment: Segment | null;
}

interface ReferenceLookupSchedulerOptions {
  fetchers: ReferenceLookupFetchers;
  setResult: (result: ReferenceLookupResult, loading: boolean) => void;
  debounceMs?: number;
}

export function createReferenceLookupScheduler(options: ReferenceLookupSchedulerOptions) {
  const loader = createReferenceLookupControllerLoader(options.fetchers);
  const debounceMs = options.debounceMs ?? REFERENCE_LOOKUP_DEBOUNCE_MS;
  let currentKey: string | null = null;
  let runningKey: string | null = null;
  let queuedLatest: {
    projectId: number;
    segment: Segment;
    key: string;
    force: boolean;
    invalidationEpoch: number;
  } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let invalidationEpoch = 0;
  let latestState: ReferenceLookupSchedulerState = {
    enabled: false,
    projectId: null,
    segment: null,
  };

  const clearTimer = (): void => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const startLookup = async (
    projectId: number,
    segment: Segment,
    key: string,
    force = false,
    lookupInvalidationEpoch = invalidationEpoch,
  ): Promise<void> => {
    if (runningKey) {
      queuedLatest = {
        projectId,
        segment,
        key,
        force,
        invalidationEpoch: lookupInvalidationEpoch,
      };
      return;
    }

    runningKey = key;
    try {
      const result = await loader.load({ projectId, segment });
      if (
        currentKey === key &&
        latestState.enabled &&
        lookupInvalidationEpoch === invalidationEpoch
      ) {
        options.setResult(result, false);
      }
    } finally {
      runningKey = null;
      const next = queuedLatest;
      queuedLatest = null;
      if (
        next &&
        currentKey === next.key &&
        latestState.enabled &&
        (next.force || next.key !== key)
      ) {
        void startLookup(
          next.projectId,
          next.segment,
          next.key,
          next.force,
          next.invalidationEpoch,
        );
      }
    }
  };

  const schedule = (
    nextState: ReferenceLookupSchedulerState,
    optionsOverride?: { force?: boolean },
  ): void => {
    const { enabled, projectId, segment } = nextState;
    if (!enabled || projectId === null || !segment) {
      currentKey = null;
      clearTimer();
      queuedLatest = null;
      options.setResult({ matches: [], terms: [] }, false);
      return;
    }

    const key = getReferenceLookupCacheKey(projectId, segment);
    currentKey = key;

    const cached = loader.getCached(projectId, segment);
    if (cached) {
      clearTimer();
      queuedLatest = null;
      options.setResult(cached, false);
      return;
    }

    options.setResult({ matches: [], terms: [] }, true);

    const force = optionsOverride?.force ?? false;
    clearTimer();
    if (force && runningKey) {
      queuedLatest = {
        projectId,
        segment,
        key,
        force,
        invalidationEpoch,
      };
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      void startLookup(projectId, segment, key, force, invalidationEpoch);
    }, debounceMs);
  };

  return {
    update(nextState: ReferenceLookupSchedulerState): void {
      latestState = nextState;
      schedule(nextState);
    },
    prefetch(projectId: number, segments: readonly Segment[]): void {
      for (const segment of segments) {
        void loader.load({ projectId, segment });
      }
    },
    invalidate(projectId: number | null): void {
      loader.invalidateProject(projectId);
      const invalidatesCurrent =
        projectId === null ||
        (latestState.projectId !== null && projectId === latestState.projectId);
      if (!invalidatesCurrent) {
        return;
      }

      invalidationEpoch += 1;
      schedule(latestState, { force: true });
    },
    dispose(): void {
      clearTimer();
      queuedLatest = null;
      currentKey = null;
    },
  };
}

export function useReferenceLookupController({
  enabled,
  activeSegmentId,
  activeSegmentSourceHash,
  projectId,
  segments,
  subscribeToReferenceDataChanged = subscribeToDefaultReferenceDataChanged,
  fetchers = defaultReferenceLookupFetchers,
}: UseReferenceLookupControllerParams): {
  activeMatches: TMMatch[];
  activeTerms: TBMatch[];
  referenceLoading: boolean;
} {
  const [activeMatches, setActiveMatches] = useState<TMMatch[]>([]);
  const [activeTerms, setActiveTerms] = useState<TBMatch[]>([]);
  const [referenceLoading, setReferenceLoading] = useState(false);
  const segmentsRef = useRef(segments);
  const schedulerRef = useRef<ReturnType<typeof createReferenceLookupScheduler> | null>(null);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  if (!schedulerRef.current) {
    schedulerRef.current = createReferenceLookupScheduler({
      fetchers,
      setResult: (result, loading) => {
        setActiveMatches(result.matches);
        setActiveTerms(result.terms);
        setReferenceLoading(loading);
      },
      debounceMs: REFERENCE_LOOKUP_DEBOUNCE_MS,
    });
  }

  useEffect(() => {
    const activeSegment = activeSegmentId
      ? segmentsRef.current.find((item) => item.segmentId === activeSegmentId) ?? null
      : null;
    schedulerRef.current?.update({ enabled, projectId, segment: activeSegment });
  }, [enabled, projectId, activeSegmentId, activeSegmentSourceHash]);

  useEffect(() => {
    const unsubscribe = subscribeToReferenceDataChanged((event) => {
      schedulerRef.current?.invalidate(event.projectId);
    });
    return unsubscribe;
  }, [subscribeToReferenceDataChanged]);

  useEffect(() => {
    if (!enabled || projectId === null || !activeSegmentId) return;
    const segs = segmentsRef.current;
    const idx = segs.findIndex((s) => s.segmentId === activeSegmentId);
    if (idx === -1) return;
    const neighbors: Segment[] = [];
    if (idx > 0) neighbors.push(segs[idx - 1]);
    if (idx < segs.length - 1) neighbors.push(segs[idx + 1]);
    if (neighbors.length > 0) {
      schedulerRef.current?.prefetch(projectId, neighbors);
    }
  }, [activeMatches, activeTerms]);

  useEffect(() => () => schedulerRef.current?.dispose(), []);

  return { activeMatches, activeTerms, referenceLoading };
}
