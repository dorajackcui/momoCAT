import { useCallback, useEffect, useState } from 'react';
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
  reloadEditorData: () => Promise<void>;
  flushPendingSegmentUpdates: () => Promise<void>;
  aiFileJobTracker: AIFileJobTracker;
}

export interface EditorBatchActionsController {
  isBatchAIModalOpen: boolean;
  isBatchAITranslating: boolean;
  isBatchQARunning: boolean;
  activeBatchAIJob: AIFileJob | null;
  openBatchAIModal: () => void;
  closeBatchAIModal: () => void;
  handleBatchAITranslate: (options: ProjectAITranslateSubmit) => Promise<void>;
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

    if (!errorMessage.includes('Export blocked by QA errors')) {
      feedback.error(`Export failed: ${errorMessage}`);
      return;
    }

    const forceExport = await feedback.confirm(
      `${errorMessage}\n\nDo you want to force export despite these errors?`,
    );

    if (!forceExport) return;

    try {
      await api.exportFile(fileId, outputPath, undefined, true);
      feedback.success('Export successful (forced despite QA errors)');
    } catch (forceError) {
      feedback.error(
        `Export failed: ${forceError instanceof Error ? forceError.message : String(forceError)}`,
      );
    }
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
  reloadEditorData,
  flushPendingSegmentUpdates,
  aiFileJobTracker,
}: UseEditorBatchActionsParams): EditorBatchActionsController {
  const [isBatchAIModalOpen, setIsBatchAIModalOpen] = useState(false);
  const [trackedBatchAIJobId, setTrackedBatchAIJobId] = useState<string | null>(null);
  const [isBatchQARunning, setIsBatchQARunning] = useState(false);
  const activeBatchAIJob = useAIFileJobForFile(aiFileJobTracker, fileId);
  const trackedBatchAIJob = useAIJob(aiFileJobTracker, trackedBatchAIJobId);
  const isBatchAITranslating = activeBatchAIJob?.status === 'running';

  useEffect(() => {
    setIsBatchAIModalOpen(false);
    setTrackedBatchAIJobId(null);
    setIsBatchQARunning(false);
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

      setIsBatchAIModalOpen(false);
      const saved = await flushPendingSegmentUpdatesForAction({
        actionLabel: 'AI translation',
        flushPendingSegmentUpdates,
      });
      if (!saved) return;

      try {
        const jobId = await apiClient.aiTranslateFile(fileId, {
          targetBaseline: options.targetBaseline,
        });
        aiFileJobTracker.trackFileJobStart(fileId, jobId);
        setTrackedBatchAIJobId(jobId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setTrackedBatchAIJobId(null);
        feedbackService.error(`Failed to start AI translation: ${message}`);
      }
    },
    [aiFileJobTracker, fileId, flushPendingSegmentUpdates, supportsBatchActions],
  );

  const handleBatchQA = useCallback(async () => {
    if (!fileName) return;

    setIsBatchQARunning(true);
    try {
      const saved = await flushPendingSegmentUpdatesForAction({
        actionLabel: 'QA',
        flushPendingSegmentUpdates,
      });
      if (!saved) return;

      const report = await apiClient.runFileQA(fileId);
      await reloadEditorData();
      const feedback = buildFileQaFeedback(fileName, report);
      if (feedback.level === 'success') {
        feedbackService.success(feedback.message);
      } else {
        feedbackService.info(feedback.message);
      }
    } catch (error) {
      feedbackService.error(`Run QA failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsBatchQARunning(false);
    }
  }, [fileId, fileName, flushPendingSegmentUpdates, reloadEditorData]);

  const openBatchAIModal = useCallback(() => setIsBatchAIModalOpen(true), []);
  const closeBatchAIModal = useCallback(() => setIsBatchAIModalOpen(false), []);

  return {
    isBatchAIModalOpen,
    isBatchAITranslating,
    isBatchQARunning,
    activeBatchAIJob,
    openBatchAIModal,
    closeBatchAIModal,
    handleBatchAITranslate,
    handleBatchQA,
    handleExport,
  };
}
