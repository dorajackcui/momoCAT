import { useCallback, useEffect, useRef, useState } from 'react';
import type { FileQaReport } from '@cat/core/project';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import type { ProjectAITranslateSubmit } from '../../components/project-detail/ProjectAITranslateModal';
import { buildFileQaFeedback } from '../../components/project-detail/fileQaFeedback';
import { useAIFileJobForFile, useAIJob } from '../aiFileJobs';
import type { AIFileJob, AIFileJobTracker } from '../aiFileJobs';

interface UseEditorBatchActionsParams {
  fileId: number;
  fileName: string | null;
  supportsBatchActions: boolean;
  getFilteredSegmentIds: () => string[] | null;
  flushPendingSegmentUpdates: () => Promise<void>;
  aiFileJobTracker: AIFileJobTracker;
  onQAComplete?: (report: FileQaReport) => void;
  onQAStart?: () => void;
}

export interface EditorBatchActionsController {
  isBatchAIModalOpen: boolean;
  batchAIFilteredCount: number | undefined;
  isBatchAITranslating: boolean;
  isBatchAIStopping: boolean;
  isBatchQARunning: boolean;
  activeBatchAIJob: AIFileJob | null;
  openBatchAIModal: () => void;
  closeBatchAIModal: () => void;
  handleBatchAITranslate: (options: ProjectAITranslateSubmit) => Promise<void>;
  cancelBatchAITranslate: () => Promise<void>;
  handleBatchQA: () => Promise<void>;
  handleExport: () => Promise<void>;
}

interface EditorFileExportApi {
  saveFileDialog: typeof apiClient.saveFileDialog;
  exportFile: typeof apiClient.exportFile;
}

interface EditorFileExportFeedback {
  success: typeof feedbackService.success;
  error: typeof feedbackService.error;
  confirm: typeof feedbackService.confirm;
}

interface PendingSegmentFlushFeedback {
  error: typeof feedbackService.error;
}

interface ExportEditorFileParams {
  fileId: number;
  fileName: string | null;
  flushPendingSegmentUpdates: () => Promise<void>;
  api?: EditorFileExportApi;
  feedback?: EditorFileExportFeedback;
}

export async function exportEditorFile({
  fileId,
  fileName,
  flushPendingSegmentUpdates,
  api = apiClient,
  feedback = feedbackService,
}: ExportEditorFileParams): Promise<void> {
  if (!fileName) return;

  const saved = await flushPendingSegmentUpdatesForAction({
    actionLabel: 'export',
    flushPendingSegmentUpdates,
    feedback,
  });
  if (!saved) return;

  const defaultPath = fileName.replace(/(\.xlsx|\.csv)$/i, '_translated$1');
  const outputPath = await api.saveFileDialog(defaultPath, [
    { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
  ]);

  if (!outputPath) return;

  try {
    await api.exportFile(fileId, outputPath);
    feedback.success('Export successful');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    feedback.error(`Export failed: ${errorMessage}`);
  }
}

export async function flushPendingSegmentUpdatesForAction({
  actionLabel,
  flushPendingSegmentUpdates,
  feedback = feedbackService,
}: {
  actionLabel: string;
  flushPendingSegmentUpdates: () => Promise<void>;
  feedback?: PendingSegmentFlushFeedback;
}): Promise<boolean> {
  try {
    await flushPendingSegmentUpdates();
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    feedback.error(`Failed to save pending segment edits before ${actionLabel}: ${message}`);
    return false;
  }
}

export function useEditorBatchActions({
  fileId,
  fileName,
  supportsBatchActions,
  getFilteredSegmentIds,
  flushPendingSegmentUpdates,
  aiFileJobTracker,
  onQAComplete,
  onQAStart,
}: UseEditorBatchActionsParams): EditorBatchActionsController {
  const [isBatchAIModalOpen, setIsBatchAIModalOpen] = useState(false);
  const [batchAISegmentIds, setBatchAISegmentIds] = useState<string[] | null>(null);
  const [trackedBatchAIJobId, setTrackedBatchAIJobId] = useState<string | null>(null);
  const [isBatchQARunning, setIsBatchQARunning] = useState(false);
  const qaRun = useRef(0);
  const qaBusy = useRef(false);
  const activeBatchAIJob = useAIFileJobForFile(aiFileJobTracker, fileId);
  const trackedBatchAIJob = useAIJob(aiFileJobTracker, trackedBatchAIJobId);
  const isBatchAITranslating = activeBatchAIJob?.status === 'running';
  const isBatchAIStopping = isBatchAITranslating && activeBatchAIJob?.cancelRequested === true;

  useEffect(() => {
    setIsBatchAIModalOpen(false);
    setBatchAISegmentIds(null);
    setTrackedBatchAIJobId(null);
    setIsBatchQARunning(false);
    qaBusy.current = false;
    qaRun.current += 1;
    return () => {
      qaRun.current += 1;
    };
  }, [fileId]);

  useEffect(() => {
    if (!trackedBatchAIJob) return;
    if (trackedBatchAIJob.status === 'running') return;

    setTrackedBatchAIJobId(null);

    if (trackedBatchAIJob.status === 'failed') {
      const errorMessage =
        trackedBatchAIJob.error?.message || trackedBatchAIJob.message || 'Unknown error';
      feedbackService.error(`AI batch translation failed: ${errorMessage}`);
      return;
    }

    if (trackedBatchAIJob.status === 'cancelled') {
      feedbackService.info(trackedBatchAIJob.message || 'AI batch translation cancelled.');
    }
  }, [trackedBatchAIJob]);

  const handleExport = useCallback(async () => {
    await exportEditorFile({
      fileId,
      fileName,
      flushPendingSegmentUpdates,
    });
  }, [fileId, fileName, flushPendingSegmentUpdates]);

  const handleBatchAITranslate = useCallback(
    async (options: ProjectAITranslateSubmit) => {
      if (!supportsBatchActions) return;

      const segmentIds = options.scope === 'file' ? null : batchAISegmentIds;
      if (segmentIds?.length === 0) {
        feedbackService.info('No segments match the current filters.');
        return;
      }

      setIsBatchAIModalOpen(false);
      const saved = await flushPendingSegmentUpdatesForAction({
        actionLabel: 'AI translation',
        flushPendingSegmentUpdates,
      });
      if (!saved) return;

      try {
        const jobId = await apiClient.aiTranslateFile(fileId, {
          targetBaseline: options.targetBaseline,
          ...(segmentIds ? { segmentIds: [...segmentIds] } : {}),
        });
        aiFileJobTracker.trackFileJobStart(fileId, jobId);
        setTrackedBatchAIJobId(jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTrackedBatchAIJobId(null);
        feedbackService.error(`Failed to start AI translation: ${message}`);
      }
    },
    [aiFileJobTracker, batchAISegmentIds, fileId, flushPendingSegmentUpdates, supportsBatchActions],
  );

  const cancelBatchAITranslate = useCallback(async () => {
    if (!activeBatchAIJob || activeBatchAIJob.status !== 'running') {
      return;
    }

    try {
      const cancelled = await apiClient.aiCancelFileJob(activeBatchAIJob.jobId);
      if (!cancelled) {
        feedbackService.info('AI translation is no longer running.');
      }
    } catch (error) {
      feedbackService.error(
        `Failed to stop AI translation: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }, [activeBatchAIJob]);

  const handleBatchQA = useCallback(async () => {
    if (!fileName || qaBusy.current) return;
    qaBusy.current = true;
    const run = ++qaRun.current;

    setIsBatchQARunning(true);
    try {
      const saved = await flushPendingSegmentUpdatesForAction({
        actionLabel: 'QA',
        flushPendingSegmentUpdates,
      });
      if (!saved || run !== qaRun.current) return;

      onQAStart?.();
      const report = await apiClient.runFileQA(fileId);
      if (run !== qaRun.current) return;
      onQAComplete?.(report);
      if (onQAComplete) return;
      const feedback = buildFileQaFeedback(fileName, report);
      if (feedback.level === 'success') {
        feedbackService.success(feedback.message);
      } else {
        feedbackService.info(feedback.message);
      }
    } catch (error) {
      if (run !== qaRun.current) return;
      feedbackService.error(
        `Run QA failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      if (run === qaRun.current) {
        qaBusy.current = false;
        setIsBatchQARunning(false);
      }
    }
  }, [fileId, fileName, flushPendingSegmentUpdates, onQAStart, onQAComplete]);

  const openBatchAIModal = useCallback(() => {
    const segmentIds = getFilteredSegmentIds();
    setBatchAISegmentIds(segmentIds ? [...segmentIds] : null);
    setIsBatchAIModalOpen(true);
  }, [getFilteredSegmentIds]);
  const closeBatchAIModal = useCallback(() => setIsBatchAIModalOpen(false), []);

  return {
    isBatchAIModalOpen,
    batchAIFilteredCount: batchAISegmentIds?.length,
    isBatchAITranslating,
    isBatchAIStopping,
    isBatchQARunning,
    activeBatchAIJob,
    openBatchAIModal,
    closeBatchAIModal,
    handleBatchAITranslate,
    cancelBatchAITranslate,
    handleBatchQA,
    handleExport,
  };
}
