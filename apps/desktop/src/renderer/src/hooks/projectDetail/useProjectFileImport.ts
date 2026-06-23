import { useState } from 'react';
import type {
  ClipboardContent,
  ImportOptions,
  PastedSourceFileInput,
  SpreadsheetPreviewData,
} from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';

interface UseProjectFileImportParams {
  projectId: number;
  loadData: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface UseProjectFileImportResult {
  isSelectorOpen: boolean;
  isAddFileMenuOpen: boolean;
  isPasteSourceOpen: boolean;
  previewData: SpreadsheetPreviewData;
  pasteClipboard: ClipboardContent;
  pasteCreating: boolean;
  toggleAddFileMenu: () => void;
  closeAddFileMenu: () => void;
  openFileImport: () => Promise<void>;
  openPasteSource: () => Promise<void>;
  closeSelector: () => void;
  closePasteSource: () => void;
  confirmImport: (options: ImportOptions) => Promise<void>;
  confirmPasteSource: (input: PastedSourceFileInput) => Promise<void>;
}

export function useProjectFileImport({
  projectId,
  loadData,
  runMutation,
}: UseProjectFileImportParams): UseProjectFileImportResult {
  const [isSelectorOpen, setIsSelectorOpen] = useState(false);
  const [isAddFileMenuOpen, setIsAddFileMenuOpen] = useState(false);
  const [isPasteSourceOpen, setIsPasteSourceOpen] = useState(false);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [previewData, setPreviewData] = useState<SpreadsheetPreviewData>([]);
  const [pasteClipboard, setPasteClipboard] = useState<ClipboardContent>({ text: '', html: '' });
  const [pasteCreating, setPasteCreating] = useState(false);

  const toggleAddFileMenu = () => {
    setIsAddFileMenuOpen((open) => !open);
  };

  const closeAddFileMenu = () => {
    setIsAddFileMenuOpen(false);
  };

  const openFileImport = async () => {
    setIsAddFileMenuOpen(false);
    const filePath = await apiClient.openFileDialog([
      { name: 'Spreadsheets', extensions: ['xlsx', 'csv'] },
    ]);
    if (!filePath) return;

    try {
      await runMutation(async () => {
        const preview = await apiClient.getFilePreview(filePath);
        setPreviewData(preview);
        setPendingFilePath(filePath);
        setIsSelectorOpen(true);
      });
    } catch (error) {
      feedbackService.error(
        `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const closeSelector = () => {
    setIsSelectorOpen(false);
  };

  const openPasteSource = async () => {
    setIsAddFileMenuOpen(false);
    try {
      const clipboard = await apiClient.readClipboard();
      setPasteClipboard(clipboard);
    } catch {
      setPasteClipboard({ text: '', html: '' });
    }
    setIsPasteSourceOpen(true);
  };

  const closePasteSource = () => {
    if (pasteCreating) return;
    setIsPasteSourceOpen(false);
  };

  const confirmImport = async (options: ImportOptions) => {
    if (!pendingFilePath) return;
    try {
      await runMutation(async () => {
        setIsSelectorOpen(false);
        await apiClient.addFileToProject(projectId, pendingFilePath, options);
        await loadData();
        setPendingFilePath(null);
      });
    } catch (error) {
      feedbackService.error(
        `Failed to add file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const confirmPasteSource = async (input: PastedSourceFileInput) => {
    setPasteCreating(true);
    try {
      await runMutation(async () => {
        await apiClient.createPastedSourceFile(projectId, input);
        await loadData();
      });
      feedbackService.success('File created from pasted source');
      setIsPasteSourceOpen(false);
    } catch (error) {
      feedbackService.error(
        `Failed to create file: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      setPasteCreating(false);
    }
  };

  return {
    isSelectorOpen,
    isAddFileMenuOpen,
    isPasteSourceOpen,
    previewData,
    pasteClipboard,
    pasteCreating,
    toggleAddFileMenu,
    closeAddFileMenu,
    openFileImport,
    openPasteSource,
    closeSelector,
    closePasteSource,
    confirmImport,
    confirmPasteSource,
  };
}
