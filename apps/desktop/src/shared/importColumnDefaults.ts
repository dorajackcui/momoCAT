import type { ProjectType } from '@cat/core/project';
import type { SpreadsheetPreviewData } from './ipc';

const DEFAULT_CONTEXT_HEADER = 'context';

interface ResolveDefaultContextColumnInput {
  hasHeader: boolean;
  previewData: SpreadsheetPreviewData;
  projectType: ProjectType;
  sourceCol: number;
}

export function resolveDefaultContextColumn({
  hasHeader,
  previewData,
  projectType,
  sourceCol,
}: ResolveDefaultContextColumnInput): number | undefined {
  const headerContextCol = hasHeader
    ? findHeaderColumn(previewData[0] ?? [], DEFAULT_CONTEXT_HEADER)
    : undefined;
  if (headerContextCol !== undefined) return headerContextCol;

  return projectType === 'review' ? sourceCol : undefined;
}

export function findHeaderColumn(
  headerRow: Array<string | number | boolean | null | undefined>,
  headerName: string,
): number | undefined {
  const normalizedHeaderName = headerName.trim().toLowerCase();
  const index = headerRow.findIndex(
    (cell) =>
      String(cell ?? '')
        .trim()
        .toLowerCase() === normalizedHeaderName,
  );
  return index >= 0 ? index : undefined;
}
