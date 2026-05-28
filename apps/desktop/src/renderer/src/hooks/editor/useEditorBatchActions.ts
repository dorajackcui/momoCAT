import { useEffect, useState } from 'react';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import type { ProjectAITranslateSubmit } from '../../components/project-detail/ProjectAITranslateModal';
import { buildFileQaFeedback } from '../../components/project-detail/fileQaFeedback';

interface UseEditorBatchActionsParams {
  fileId: number;
  fileName: string | null;
  supportsBatchActions: boolean;
  reloadEditorData: () => Promise<void>;
}

export interface EditorBatchActionsController {
  isBatchAIModalOpen: boolean;
  isBatchAITranslating: boolean;
  isBatchQARunning: boolean;
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
}: UseEditorBatchActionsParams): EditorBatchActionsController {
  const [isBatchAIModalOpen, setIsBatchAIModalOpen] = useState(false);
  const [trackedBatchAIJobId, setTrackedBatchAIJobId] = useState<string | null>(null);
  const [isBatchAITranslating, setIsBatchAITranslating] = useState(false);
  const [isBatchQARunning, setIsBatchQARunning] = useState(false);

  useEffect(() => {
    setIsBatchAIModalOpen(false);
    setTrackedBatchAIJobId(null);
    setIsBatchAITranslating(false);
    setIsBatchQARunning(false);
  }, [fileId]);

  useEffect(() => {
    if (!trackedBatchAIJobId) return;

    const unsubscribe = apiClient.onJobProgress((progress) => {
      if (progress.jobId !== trackedBatchAIJobId) return;
      if (progress.status === 'running') return;

      setIsBatchAITranslating(false);
      setTrackedBatchAIJobId(null);

      if (progress.status === 'failed') {
        const errorMessage = progress.error?.message || progress.message || 'Unknown error';
        feedbackService.error(`AI batch translation failed: ${errorMessage}`);
        return;
      }

      if (progress.status === 'cancelled') {
        feedbackService.info(progress.message || 'AI batch translation cancelled.');
      }
    });

    return unsubscribe;
  }, [trackedBatchAIJobId]);

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
      setTrackedBatchAIJobId(jobId);
      setIsBatchAITranslating(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setTrackedBatchAIJobId(null);
      setIsBatchAITranslating(false);
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
    openBatchAIModal: () => setIsBatchAIModalOpen(true),
    closeBatchAIModal: () => setIsBatchAIModalOpen(false),
    handleBatchAITranslate,
    handleBatchQA,
    handleExport,
  };
}
