import type {
  DesktopApi,
  DialogFileFilter,
  FileInspectResult,
  ProjectFileRecord,
} from '../../../../shared/ipc';

export const INSPECT_OUTPUT_FILTERS: DialogFileFilter[] = [
  { name: 'Excel Workbook', extensions: ['xlsx'] },
];

export function buildInspectDefaultPath(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.\\]+$/u, '') || fileName;
  return `${baseName}_inspect.xlsx`;
}

export interface RunFileInspectActionDeps {
  saveFileDialog: DesktopApi['saveFileDialog'];
  inspectFile: DesktopApi['inspectFile'];
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

export async function runFileInspectAction(
  file: ProjectFileRecord,
  deps: RunFileInspectActionDeps,
): Promise<FileInspectResult | null> {
  try {
    const outputPath = await deps.saveFileDialog(
      buildInspectDefaultPath(file.name),
      INSPECT_OUTPUT_FILTERS,
    );
    if (!outputPath) return null;

    const result = await deps.runMutation(() => deps.inspectFile(file.id, outputPath));
    const { ready, total } = result.summary;
    const errorCount = result.summary.error;
    if (errorCount > 0) {
      deps.info(
        `Inspect exported with issues: ${ready}/${total} source rows ready, ${errorCount} failed.`,
      );
    } else {
      deps.success(`Inspect exported: ${ready}/${total} source rows ready.`);
    }
    return result;
  } catch (caught) {
    deps.error(`Inspect failed: ${caught instanceof Error ? caught.message : String(caught)}`);
    return null;
  }
}
