import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JobProgressEvent } from '../../../shared/ipc';

const UNKNOWN_FILE_ID = -1;
const TERMINAL_AI_FILE_JOB_STATUSES: AIFileJob['status'][] = ['completed', 'failed', 'cancelled'];

export interface AIFileJob extends JobProgressEvent {
  kind: 'ai-translate-file';
  fileId: number;
}

export interface AIFileJobTracker {
  trackFileJobStart: (fileId: number, jobId: string) => void;
  getFileJob: (fileId: number) => AIFileJob | null;
  getJob: (jobId: string) => AIFileJob | null;
}

export function isTerminalAIFileJobStatus(status: AIFileJob['status']): boolean {
  return TERMINAL_AI_FILE_JOB_STATUSES.includes(status);
}

export function upsertAIFileJobFromProgress(
  progress: JobProgressEvent,
  existing?: AIFileJob,
): AIFileJob {
  const base: AIFileJob = existing ?? {
    kind: 'ai-translate-file',
    jobId: progress.jobId,
    fileId: UNKNOWN_FILE_ID,
    progress: 0,
    status: 'running',
    message: undefined,
  };

  return {
    ...base,
    ...progress,
    kind: 'ai-translate-file',
    fileId: base.fileId,
  };
}

export function upsertAIFileJobOnStart(
  jobId: string,
  fileId: number,
  existing?: AIFileJob,
): AIFileJob {
  if (!existing) {
    return {
      kind: 'ai-translate-file',
      jobId,
      fileId,
      progress: 0,
      status: 'running',
      message: 'Queued',
    };
  }

  if (isTerminalAIFileJobStatus(existing.status)) {
    return {
      ...existing,
      kind: 'ai-translate-file',
      fileId,
    };
  }

  return {
    ...existing,
    kind: 'ai-translate-file',
    fileId,
    status: existing.status || 'running',
    progress: typeof existing.progress === 'number' ? existing.progress : 0,
    message: existing.message ?? 'Queued',
  };
}

export function useAIFileJobTracker(): AIFileJobTracker {
  const [aiJobs, setAiJobs] = useState<Record<string, AIFileJob>>({});
  const [fileJobIndex, setFileJobIndex] = useState<Record<number, string>>({});

  useEffect(() => {
    const unsubscribe = window.api.onJobProgress((progress) => {
      setAiJobs((prev) => {
        const existing = prev[progress.jobId];
        const nextJob = upsertAIFileJobFromProgress(progress, existing);
        return {
          ...prev,
          [progress.jobId]: nextJob,
        };
      });
    });
    return unsubscribe;
  }, []);

  const trackFileJobStart = useCallback((fileId: number, jobId: string) => {
    setAiJobs((prev) => {
      const existing = prev[jobId];
      return {
        ...prev,
        [jobId]: upsertAIFileJobOnStart(jobId, fileId, existing),
      };
    });
    setFileJobIndex((prev) => ({ ...prev, [fileId]: jobId }));
  }, []);

  const getFileJob = useCallback(
    (fileId: number): AIFileJob | null => {
      const jobId = fileJobIndex[fileId];
      if (!jobId) return null;
      return aiJobs[jobId] ?? null;
    },
    [aiJobs, fileJobIndex],
  );

  const getJob = useCallback(
    (jobId: string): AIFileJob | null => aiJobs[jobId] ?? null,
    [aiJobs],
  );

  return useMemo(
    () => ({
      trackFileJobStart,
      getFileJob,
      getJob,
    }),
    [getFileJob, getJob, trackFileJobStart],
  );
}
