import type {
  DesktopApi,
  FileSourceTerminologyPrecheckResult,
  ProjectFileRecord,
} from '../../../../shared/ipc';
import { INSPECT_OUTPUT_FILTERS } from './fileInspectAction';

export function buildSourceTerminologyPrecheckDefaultPath(fileName: string): string {
  const baseName = fileName.replace(/\.[^/.\\]+$/u, '') || fileName;
  return `${baseName}_source_terms.xlsx`;
}

export interface RunSourceTerminologyPrecheckActionDeps {
  saveFileDialog: DesktopApi['saveFileDialog'];
  precheckSourceTerminology: DesktopApi['precheckSourceTerminology'];
  runMutation: <T>(fn: () => Promise<T>) => Promise<T>;
  success: (message: string) => void;
  info: (message: string) => void;
  error: (message: string) => void;
}

export async function runSourceTerminologyPrecheckAction(
  file: ProjectFileRecord,
  deps: RunSourceTerminologyPrecheckActionDeps,
): Promise<FileSourceTerminologyPrecheckResult | null> {
  try {
    const outputPath = await deps.saveFileDialog(
      buildSourceTerminologyPrecheckDefaultPath(file.name),
      INSPECT_OUTPUT_FILTERS,
    );
    if (!outputPath) return null;

    const result = await deps.runMutation(() =>
      deps.precheckSourceTerminology(file.id, outputPath),
    );
    const { ready, total, error, cancelled, uniqueTerms } = result.summary;
    if (cancelled > 0) {
      deps.info(
        `Source term precheck stopped with partial output preserved: ${ready}/${total} rows ready, ${cancelled} cancelled, ${error} failed, ${uniqueTerms} unique candidates.`,
      );
    } else if (error > 0) {
      deps.info(
        `Source term precheck exported with issues: ${ready}/${total} rows ready, ${error} failed, ${uniqueTerms} unique candidates.`,
      );
    } else {
      deps.success(
        `Source term precheck exported: ${ready}/${total} rows ready, ${uniqueTerms} unique candidates.`,
      );
    }
    return result;
  } catch (caught) {
    deps.error(
      `Source term precheck failed: ${caught instanceof Error ? caught.message : String(caught)}`,
    );
    return null;
  }
}
