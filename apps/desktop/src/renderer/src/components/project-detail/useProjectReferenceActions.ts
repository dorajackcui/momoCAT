import { useRef, useState } from 'react';
import type { AppProgressEvent, ProjectFileRecord } from '../../../../shared/ipc';
import { apiClient } from '../../services/apiClient';
import { feedbackService } from '../../services/feedbackService';
import { runFileReferenceExportAction } from './fileInspectAction';
import { runSourceTerminologyPrecheckAction } from './sourceTerminologyPrecheckAction';

export interface ReferenceOperationProgress {
  kind: 'export' | 'precheck';
  fileId: number;
  current: number;
  total: number;
  cancelRequested?: boolean;
}

type RunMutation = <T>(operation: () => Promise<T>) => Promise<T>;

export function useProjectReferenceActions(runMutation: RunMutation) {
  const [file, setFile] = useState<ProjectFileRecord | null>(null);
  const [progress, setProgress] = useState<ReferenceOperationProgress | null>(null);
  const activeOperationRef = useRef<symbol | null>(null);

  const runWithProgress = async (
    selectedFile: ProjectFileRecord,
    kind: ReferenceOperationProgress['kind'],
  ) => {
    if (activeOperationRef.current) {
      feedbackService.info('Another reference operation is already running.');
      return;
    }
    const operationId = Symbol('reference-operation');
    activeOperationRef.current = operationId;
    const expectedType = kind === 'precheck' ? 'source-terminology-precheck' : 'reference-export';
    const expectedScope = `file:${selectedFile.id}`;
    let unsubscribe: () => void = () => undefined;
    try {
      unsubscribe = apiClient.onProgress((event: AppProgressEvent) => {
        if (
          activeOperationRef.current === operationId &&
          event.type === expectedType &&
          event.scope === expectedScope
        ) {
          setProgress((previous) => ({
            kind,
            fileId: selectedFile.id,
            current: event.current,
            total: event.total,
            cancelRequested:
              previous?.kind === kind && previous.fileId === selectedFile.id
                ? previous.cancelRequested
                : false,
          }));
        }
      });
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
      if (activeOperationRef.current === operationId) {
        activeOperationRef.current = null;
        setProgress(null);
      }
    }
  };

  const cancelPrecheck = async () => {
    const active = progress;
    if (!active || active.kind !== 'precheck' || active.cancelRequested) return;
    setProgress({ ...active, cancelRequested: true });
    const resetCancelRequested = () => {
      setProgress((current) =>
        current?.kind === 'precheck' && current.fileId === active.fileId
          ? { ...current, cancelRequested: false }
          : current,
      );
    };
    try {
      const accepted = await apiClient.cancelSourceTerminologyPrecheck(active.fileId);
      if (!accepted) resetCancelRequested();
    } catch (error) {
      resetCancelRequested();
      feedbackService.error(
        `Failed to stop source term precheck: ${error instanceof Error ? error.message : String(error)}`,
      );
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
    cancelPrecheck: () => void cancelPrecheck(),
  };
}
