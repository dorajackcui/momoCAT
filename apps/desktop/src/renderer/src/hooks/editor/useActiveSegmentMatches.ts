import { useEffect, useRef, useState } from 'react';
import type { Segment, TBMatch } from '@cat/core/models';
import type { TMMatch } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';

const MATCH_REQUEST_DEBOUNCE_MS = 150;

interface UseActiveSegmentMatchesParams {
  activeSegmentId: string | null;
  activeSegmentSourceHash: string | null;
  projectId: number | null;
  segments: Segment[];
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
  const termRequestSeqRef = useRef(0);
  const segmentsRef = useRef(segments);

  useEffect(() => {
    segmentsRef.current = segments;
  }, [segments]);

  useEffect(() => {
    if (!activeSegmentId || projectId === null) {
      matchRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMatches([]);
      return;
    }

    const segment = segmentsRef.current.find((item) => item.segmentId === activeSegmentId);
    if (!segment) {
      matchRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveMatches([]);
      return;
    }

    let cancelled = false;
    const requestSeq = ++matchRequestSeqRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const matches = await apiClient.getMatches(projectId, segment);
          if (cancelled || requestSeq !== matchRequestSeqRef.current) return;
          setActiveMatches(matches || []);
        } catch (error) {
          if (cancelled || requestSeq !== matchRequestSeqRef.current) return;
          console.error('[useEditor] Failed to load TM matches:', error);
          setActiveMatches([]);
        }
      })();
    }, MATCH_REQUEST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [activeSegmentId, activeSegmentSourceHash, projectId]);

  useEffect(() => {
    if (!activeSegmentId || projectId === null) {
      termRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTerms([]);
      return;
    }

    const segment = segmentsRef.current.find((item) => item.segmentId === activeSegmentId);
    if (!segment) {
      termRequestSeqRef.current += 1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveTerms([]);
      return;
    }

    let cancelled = false;
    const requestSeq = ++termRequestSeqRef.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const terms = await apiClient.getTermMatches(projectId, segment);
          if (cancelled || requestSeq !== termRequestSeqRef.current) return;
          setActiveTerms(terms || []);
        } catch (error) {
          if (cancelled || requestSeq !== termRequestSeqRef.current) return;
          console.error('[useEditor] Failed to load TB matches:', error);
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
