import type {
  DesktopApi,
  DialogFileFilter,
  FileReferenceExportResult,
  ProjectFileRecord,
} from '../../../../shared/ipc';

export const INSPECT_OUTPUT_FILTERS: DialogFileFilter[] = [
  { name: 'Excel Workbook', extensions: ['xlsx'] },
];

export function buildReferenceExportDefaultPath(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.\\]+$/u, '') || fileName;
  return `${baseName}_tm_tb_refs.xlsx`;
}

export interface RunFileReferenceExportActionDeps {
  saveFileDialog: DesktopApi['saveFileDialog'];
  exportReferencesForMt: DesktopApi['exportReferencesForMt'];
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

export async function runFileReferenceExportAction(
  file: ProjectFileRecord,
  deps: RunFileReferenceExportActionDeps,
): Promise<FileReferenceExportResult | null> {
  try {
    const outputPath = await deps.saveFileDialog(
      buildReferenceExportDefaultPath(file.name),
      INSPECT_OUTPUT_FILTERS,
    );
    if (!outputPath) return null;

    const result = await deps.runMutation(() => deps.exportReferencesForMt(file.id, outputPath));
    const { ready, total } = result.summary;
    const errorCount = result.summary.error;
    if (errorCount > 0) {
      deps.info(
        `TM/TB refs exported with issues: ${ready}/${total} source rows ready, ${errorCount} failed.`,
      );
    } else {
      deps.success(`TM/TB refs exported: ${ready}/${total} source rows ready.`);
    }
    return result;
  } catch (caught) {
    deps.error(
      `TM/TB refs export failed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return null;
  }
}
