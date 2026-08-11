import type { DesktopApi, MountedTM } from '../../../../shared/ipc';
import type { FeedbackService } from '../../services/feedbackService';

export const WORKING_TM_EXPORT_FILTERS = [{ name: 'Excel Workbooks', extensions: ['xlsx'] }];

interface ExportWorkingTMDeps {
  projectId: number;
  projectName: string;
  tmId: string;
  saveFileDialog: DesktopApi['saveFileDialog'];
  exportWorkingTM: DesktopApi['exportWorkingTM'];
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface ResetWorkingTMDeps {
  projectId: number;
  tmId: string;
  tmName: string;
  entryCount: number;
  confirm: FeedbackService['confirm'];
  resetWorkingTM: DesktopApi['resetWorkingTM'];
  reload: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

interface ProjectWorkingTMActionsDeps {
  projectId: number;
  projectName: string;
  api: Pick<DesktopApi, 'saveFileDialog' | 'exportWorkingTM' | 'resetWorkingTM'>;
  feedback: Pick<FeedbackService, 'confirm' | 'success' | 'error'>;
  reload: () => Promise<void>;
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
}

export function buildWorkingTMExportDefaultPath(projectName: string): string {
  const printableName = Array.from(projectName.trim(), (character) =>
    character.charCodeAt(0) < 32 ? '_' : character,
  ).join('');
  const safeName = printableName.replace(/[<>:"/\\|?*]+/g, '_').replace(/[. ]+$/g, '');
  return `${safeName || 'project'}_working_tm.xlsx`;
}

export async function exportWorkingTMAction({
  projectId,
  projectName,
  tmId,
  saveFileDialog,
  exportWorkingTM,
  runMutation,
}: ExportWorkingTMDeps): Promise<number | null> {
  const outputPath = await saveFileDialog(
    buildWorkingTMExportDefaultPath(projectName),
    WORKING_TM_EXPORT_FILTERS,
  );
  if (!outputPath) return null;

  return runMutation(() => exportWorkingTM(projectId, tmId, outputPath));
}

export async function resetWorkingTMAction({
  projectId,
  tmId,
  tmName,
  entryCount,
  confirm,
  resetWorkingTM,
  reload,
  runMutation,
}: ResetWorkingTMDeps): Promise<number | null> {
  const confirmed = await confirm({
    title: 'Reset Working TM?',
    message: `This will remove all ${entryCount} entries from "${tmName}". Project files and translations will not be changed.`,
    confirmLabel: 'Reset',
    confirmVariant: 'danger',
  });
  if (!confirmed) return null;

  return runMutation(async () => {
    let removed: number;
    try {
      removed = await resetWorkingTM(projectId, tmId);
    } catch (error) {
      // Bounded reset transactions may have committed before a later failure.
      // Refresh the count while preserving the original operation error.
      try {
        await reload();
      } catch {
        // loadTMData surfaces refresh failures in the pane; the reset error is
        // still the most useful failure to report from this action.
      }
      throw error;
    }
    await reload();
    return removed;
  });
}

export function createProjectWorkingTMActions({
  projectId,
  projectName,
  api,
  feedback,
  reload,
  runMutation,
}: ProjectWorkingTMActionsDeps) {
  return {
    export: async (tm: MountedTM) => {
      try {
        const exported = await exportWorkingTMAction({
          projectId,
          projectName,
          tmId: tm.id,
          saveFileDialog: api.saveFileDialog,
          exportWorkingTM: api.exportWorkingTM,
          runMutation,
        });
        if (exported !== null) feedback.success(`Exported ${exported} Working TM entries.`);
      } catch (error) {
        feedback.error(
          `Working TM export failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
    reset: async (tm: MountedTM) => {
      try {
        const removed = await resetWorkingTMAction({
          projectId,
          tmId: tm.id,
          tmName: tm.name,
          entryCount: tm.entryCount || 0,
          confirm: feedback.confirm,
          resetWorkingTM: api.resetWorkingTM,
          reload,
          runMutation,
        });
        if (removed !== null) feedback.success(`Working TM reset. Removed ${removed} entries.`);
      } catch (error) {
        feedback.error(
          `Working TM reset failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
