import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
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
  subscribe: (listener: () => void) => () => void;
}

interface AIFileJobTrackerStore extends AIFileJobTracker {
  applyProgress: (progress: JobProgressEvent) => void;
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

/**
 * Job state lives outside React so the tracker keeps a stable identity and
 * high-frequency progress events only re-render subscribed consumers instead
 * of the whole component tree under App.
 */
export function createAIFileJobTracker(): AIFileJobTrackerStore {
  const jobs = new Map<string, AIFileJob>();
  const fileJobIndex = new Map<number, string>();
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      listener();
    }
  };

  return {
    applyProgress: (progress) => {
      const existing = jobs.get(progress.jobId);
      jobs.set(progress.jobId, upsertAIFileJobFromProgress(progress, existing));
      notify();
    },
    trackFileJobStart: (fileId, jobId) => {
      const existing = jobs.get(jobId);
      jobs.set(jobId, upsertAIFileJobOnStart(jobId, fileId, existing));
      fileJobIndex.set(fileId, jobId);
      notify();
    },
    getFileJob: (fileId) => {
      const jobId = fileJobIndex.get(fileId);
      if (!jobId) return null;
      return jobs.get(jobId) ?? null;
    },
    getJob: (jobId) => jobs.get(jobId) ?? null,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export function useAIFileJobTracker(): AIFileJobTracker {
  const [tracker] = useState(createAIFileJobTracker);

  useEffect(() => {
    const unsubscribe = window.api.onJobProgress((progress) => {
      tracker.applyProgress(progress);
    });
    return unsubscribe;
  }, [tracker]);

  return tracker;
}

export function useAIFileJobForFile(tracker: AIFileJobTracker, fileId: number): AIFileJob | null {
  const getSnapshot = useCallback(() => tracker.getFileJob(fileId), [fileId, tracker]);
  return useSyncExternalStore(tracker.subscribe, getSnapshot, getSnapshot);
}

export function useAIJob(tracker: AIFileJobTracker, jobId: string | null): AIFileJob | null {
  const getSnapshot = useCallback(() => (jobId ? tracker.getJob(jobId) : null), [jobId, tracker]);
  return useSyncExternalStore(tracker.subscribe, getSnapshot, getSnapshot);
}
