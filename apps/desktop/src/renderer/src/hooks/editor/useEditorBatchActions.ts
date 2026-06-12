import { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import type { ProjectAITranslateSubmit } from '../../components/project-detail/ProjectAITranslateModal';
import { buildFileQaFeedback } from '../../components/project-detail/fileQaFeedback';
import type { AIFileJob, AIFileJobTracker } from '../aiFileJobs';

interface UseEditorBatchActionsParams {
  fileId: number;
  fileName: string | null;
  supportsBatchActions: boolean;
  reloadEditorData: () => Promise<void>;
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

export function useEditorBatchActions({
  fileId,
  fileName,
  supportsBatchActions,
  reloadEditorData,
  aiFileJobTracker,
}: UseEditorBatchActionsParams): EditorBatchActionsController {
  const [isBatchAIModalOpen, setIsBatchAIModalOpen] = useState(false);
  const [trackedBatchAIJobId, setTrackedBatchAIJobId] = useState<string | null>(null);
  const [isBatchQARunning, setIsBatchQARunning] = useState(false);
  const activeBatchAIJob = aiFileJobTracker.getFileJob(fileId);
  const trackedBatchAIJob = trackedBatchAIJobId
    ? aiFileJobTracker.getJob(trackedBatchAIJobId)
    : null;
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

  const handleExport = async () => {
    if (!fileName) return;

    const defaultPath = fileName.replace(/(\.xlsx|\.csv)$/i, '_translated$1');
    const outputPath = await apiClient.saveFileDialog(defaultPath, [
      { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
    ]);

    if (!outputPath) return;

    try {
      await apiClient.exportFile(fileId, outputPath);
      feedbackService.success('Export successful');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (!errorMessage.includes('Export blocked by QA errors')) {
        feedbackService.error(`Export failed: ${errorMessage}`);
        return;
      }

      const forceExport = await feedbackService.confirm(
        `${errorMessage}\n\nDo you want to force export despite these errors?`,
      );

      if (!forceExport) return;

      try {
        await apiClient.exportFile(fileId, outputPath, undefined, true);
        feedbackService.success('Export successful (forced despite QA errors)');
      } catch (forceError) {
        feedbackService.error(
          `Export failed: ${forceError instanceof Error ? forceError.message : String(forceError)}`,
        );
      }
    }
  };

  const handleBatchAITranslate = async (options: ProjectAITranslateSubmit) => {
    if (!supportsBatchActions) return;

    setIsBatchAIModalOpen(false);
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
  };

  const handleBatchQA = async () => {
    if (!fileName) return;

    setIsBatchQARunning(true);
    try {
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
  };

  return {
    isBatchAIModalOpen,
    isBatchAITranslating,
    isBatchQARunning,
    activeBatchAIJob,
    openBatchAIModal: () => setIsBatchAIModalOpen(true),
    closeBatchAIModal: () => setIsBatchAIModalOpen(false),
    handleBatchAITranslate,
    handleBatchQA,
    handleExport,
  };
}
