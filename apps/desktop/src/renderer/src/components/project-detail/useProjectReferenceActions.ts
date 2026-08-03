import { useState } from 'react';
import type { AppProgressEvent, ProjectFileRecord } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { runFileReferenceExportAction } from './fileInspectAction';
import { runSourceTerminologyPrecheckAction } from './sourceTerminologyPrecheckAction';

export interface ReferenceOperationProgress {
  kind: 'export' | 'precheck';
  current: number;
  total: number;
}

type RunMutation = <T>(operation: () => Promise<T>) => Promise<T>;

export function useProjectReferenceActions(runMutation: RunMutation) {
  const [file, setFile] = useState<ProjectFileRecord | null>(null);
  const [progress, setProgress] = useState<ReferenceOperationProgress | null>(null);

  const runWithProgress = async (
    selectedFile: ProjectFileRecord,
    kind: ReferenceOperationProgress['kind'],
  ) => {
    const expectedType = kind === 'precheck' ? 'source-terminology-precheck' : 'reference-export';
    const expectedScope = `file:${selectedFile.id}`;
    const unsubscribe = apiClient.onProgress((event: AppProgressEvent) => {
      if (event.type === expectedType && event.scope === expectedScope) {
        setProgress({ kind, current: event.current, total: event.total });
      }
    });
    try {
      const common = {
        saveFileDialog: apiClient.saveFileDialog,
        runMutation,
        success: (message: string) => feedbackService.success(message),
        info: (message: string) => feedbackService.info(message),
        error: (message: string) => feedbackService.error(message),
      };
      if (kind === 'precheck') {
        await runSourceTerminologyPrecheckAction(selectedFile, {
          ...common,
          precheckSourceTerminology: apiClient.precheckSourceTerminology,
        });
      } else {
        await runFileReferenceExportAction(selectedFile, {
          ...common,
          exportReferencesForMt: apiClient.exportReferencesForMt,
        });
      }
    } finally {
      unsubscribe();
      setProgress(null);
    }
  };

  return {
    file,
    progress,
    open: setFile,
    close: () => setFile(null),
    precheckSourceTerms: (selectedFile: ProjectFileRecord) => {
      setFile(null);
      void runWithProgress(selectedFile, 'precheck');
    },
    exportReferences: (selectedFile: ProjectFileRecord) => {
      setFile(null);
      void runWithProgress(selectedFile, 'export');
    },
  };
}
