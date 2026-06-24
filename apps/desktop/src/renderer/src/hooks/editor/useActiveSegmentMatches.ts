import { useEffect, useRef, useState } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

const MATCH_REQUEST_DEBOUNCE_MS = 350;

interface UseActiveSegmentMatchesParams {
  activeSegmentId: string | null;
  activeSegmentSourceHash: string | null;
  projectId: number | null;
  segments: Segment[];
}

interface ActiveSegmentMatchFetchers {
  getMatches: (projectId: number, segment: Segment) => Promise<TMMatch[]>;
  getTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;
}

interface ActiveSegmentMatchResult {
  matches: TMMatch[];
  terms: TBMatch[];
}

function getActiveSegmentMatchCacheKey(projectId: number, segment: Segment): string {
  return `${projectId}:${segment.srcHash}`;
}

export function createActiveSegmentMatchLoader(fetchers: ActiveSegmentMatchFetchers) {
  const cache = new Map<string, ActiveSegmentMatchResult>();

  return {
    clear() {
      cache.clear();
    },
    getCached(projectId: number, segment: Segment): ActiveSegmentMatchResult | undefined {
      return cache.get(getActiveSegmentMatchCacheKey(projectId, segment));
    },
    async load(params: {
      projectId: number;
      segment: Segment;
    }): Promise<ActiveSegmentMatchResult> {
      const key = getActiveSegmentMatchCacheKey(params.projectId, params.segment);
      const cached = cache.get(key);
      if (cached) return cached;

      const [matchesResult, termsResult] = await Promise.allSettled([
        fetchers.getMatches(params.projectId, params.segment),
        fetchers.getTermMatches(params.projectId, params.segment),
      ]);
      const result = {
        matches: matchesResult.status === 'fulfilled' ? matchesResult.value || [] : [],
        terms: termsResult.status === 'fulfilled' ? termsResult.value || [] : [],
      };
      if (matchesResult.status === 'fulfilled' && termsResult.status === 'fulfilled') {
        cache.set(key, result);
      }
      return result;
    },
  };
}

export function useActiveSegmentMatches({
  activeSegmentId,
  activeSegmentSourceHash,
  projectId,
  segments,
}: UseActiveSegmentMatchesParams): {
  activeMatches: TMMatch[];
  activeTerms: TBMatch[];
} {
  const [activeMatches, setActiveMatches] = useState<TMMatch[]>([]);
  const [activeTerms, setActiveTerms] = useState<TBMatch[]>([]);
  const matchRequestSeqRef = useRef(0);
  const matchLoaderRef = useRef(
    createActiveSegmentMatchLoader({
      getMatches: apiClient.getMatches,
      getTermMatches: apiClient.getTermMatches,
    }),
  );
  const segmentsRef = useRef(segments);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    matchLoaderRef.current.clear();
  }, [projectId]);

  useEffect(() => {
    if (!activeSegmentId || projectId === null) {
      matchRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMatches([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTerms([]);
      return;
    }

    const segment = segmentsRef.current.find((item) => item.segmentId === activeSegmentId);
    if (!segment) {
      matchRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMatches([]);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTerms([]);
      return;
    }

    const cached = matchLoaderRef.current.getCached(projectId, segment);
    if (cached) {
      matchRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMatches(cached.matches);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTerms(cached.terms);
      return;
    }

    let cancelled = false;
    const requestSeq = ++matchRequestSeqRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await matchLoaderRef.current.load({ projectId, segment });
          if (cancelled || requestSeq !== matchRequestSeqRef.current) return;
          setActiveMatches(result.matches);
          setActiveTerms(result.terms);
        } catch (error) {
          if (cancelled || requestSeq !== matchRequestSeqRef.current) return;
          console.error('[useEditor] Failed to load TM/TB matches:', error);
          setActiveMatches([]);
          setActiveTerms([]);
        }
      })();
    }, MATCH_REQUEST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSegmentId, activeSegmentSourceHash, projectId]);

  return {
    activeMatches,
    activeTerms,
  };
}
