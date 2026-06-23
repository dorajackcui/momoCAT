import React from 'react';
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

const EMPTY_CLIPBOARD: ClipboardContent = {
  text: '',
  html: '',
};

export async function readClipboardContentForPaste(
  readClipboard: () => Promise<ClipboardContent>,
): Promise<ClipboardContent> {
  try {
    return await readClipboard();
  } catch {
    return EMPTY_CLIPBOARD;
  }
}

export function useProjectFileImport({
  projectId,
  loadData,
  runMutation,
}: UseProjectFileImportParams): UseProjectFileImportResult {
  const [isSelectorOpen, setIsSelectorOpen] = React.useState(false);
  const [isAddFileMenuOpen, setIsAddFileMenuOpen] = React.useState(false);
  const [isPasteSourceOpen, setIsPasteSourceOpen] = React.useState(false);
  const [pendingFilePath, setPendingFilePath] = React.useState<string | null>(null);
  const [previewData, setPreviewData] = React.useState<SpreadsheetPreviewData>([]);
  const [pasteClipboard, setPasteClipboard] = React.useState<ClipboardContent>({
    text: '',
    html: '',
  });
  const [pasteCreating, setPasteCreating] = React.useState(false);
  const pasteCreatingRef = React.useRef(false);

  const toggleAddFileMenu = () => {
    setIsAddFileMenuOpen((open) => !open);
  };

  const closeAddFileMenu = React.useCallback(() => {
    setIsAddFileMenuOpen(false);
  }, []);

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
    setPasteClipboard(await readClipboardContentForPaste(() => apiClient.readClipboard()));
    setIsPasteSourceOpen(true);
  };

  const closePasteSource = () => {
    if (pasteCreatingRef.current || pasteCreating) return;
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
    if (pasteCreatingRef.current) return;
    pasteCreatingRef.current = true;
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
      pasteCreatingRef.current = false;
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
