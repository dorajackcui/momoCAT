import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import * as XLSX from 'xlsx';
import type {
  LocalizationUnit,
  TranslateFileInput,
  TranslateFileResult,
  TranslateUnitsResult,
} from './types';

type TranslateUnitsFn = (units: LocalizationUnit[]) => Promise<TranslateUnitsResult>;
type SheetCell = string | number | boolean | null | undefined;

interface ResolvedColumns {
  sourceCol: number;
  targetCol: number;
  contextCol?: number;
  hasHeader: boolean;
}

export async function translateSpreadsheetFile(
  input: TranslateFileInput,
  translateUnits: TranslateUnitsFn,
): Promise<TranslateFileResult> {
  const workbook = XLSX.read(await readFile(input.inputPath), { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error(`Workbook has no sheets: ${input.inputPath}`);
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,
    blankrows: true,
    defval: '',
  }) as SheetCell[][];

  const columns = resolveColumns(rows[0] ?? [], input.columns);
  const units = rowsToUnits(rows, columns);
  const rowIndexByUnitId = new Map(
    units.map((unit) => [unit.id, Number(unit.metadata?.rowIndex)]),
  );
  const translation = await translateUnits(units);

  for (const result of translation.results) {
    if (result.status === 'failed' || result.target === undefined) continue;

    const rowIndex = resolveResultRowIndex(result.metadata?.rowIndex, rowIndexByUnitId.get(result.id));
    if (rowIndex === undefined) continue;

    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: columns.targetCol });
    worksheet[cellAddress] = { t: 's', v: result.target };
    ensureWorksheetRefIncludesCell(worksheet, rowIndex, columns.targetCol);
  }

  const bookType = detectBookType(input.outputPath, input.format);
  const data = XLSX.write(workbook, { bookType, type: 'buffer' }) as
    | Buffer
    | Uint8Array
    | string;

  if (typeof data === 'string') {
    await writeFile(input.outputPath, data, 'utf8');
  } else {
    await writeFile(input.outputPath, Buffer.from(data));
  }

  return {
    ...translation,
    inputPath: input.inputPath,
    outputPath: input.outputPath,
  };
}

function resolveColumns(
  headerRow: SheetCell[],
  options: TranslateFileInput['columns'] = {},
): ResolvedColumns {
  const hasHeader = options.hasHeader !== false;
  const sourceCol =
    options.sourceCol ??
    (hasHeader ? findHeaderColumn(headerRow, options.sourceHeader ?? 'source') : undefined);
  const targetCol =
    options.targetCol ??
    (hasHeader ? findHeaderColumn(headerRow, options.targetHeader ?? 'target') : undefined);
  const contextCol =
    options.contextCol ??
    (hasHeader && options.contextHeader ? findHeaderColumn(headerRow, options.contextHeader) : undefined);

  if (sourceCol === undefined || targetCol === undefined) {
    throw new Error(
      'Could not detect source/target columns. Provide headers or numeric column indexes.',
    );
  }

  if (sourceCol === targetCol) {
    throw new Error('Source and target columns must be different.');
  }

  return { sourceCol, targetCol, contextCol, hasHeader };
}

function rowsToUnits(rows: SheetCell[][], columns: ResolvedColumns): LocalizationUnit[] {
  const startIndex = columns.hasHeader ? 1 : 0;
  const units: LocalizationUnit[] = [];

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const source = cellToText(row[columns.sourceCol]);
    if (!source.trim()) continue;

    units.push({
      id: `row-${rowIndex + 1}`,
      source,
      target: cellToText(row[columns.targetCol]),
      context:
        columns.contextCol === undefined ? undefined : cellToText(row[columns.contextCol]),
      metadata: { rowIndex },
    });
  }

  return units;
}

function findHeaderColumn(headerRow: SheetCell[], headerName: string): number | undefined {
  const normalized = headerName.trim().toLowerCase();
  const index = headerRow.findIndex(
    (cell) => cellToText(cell).trim().toLowerCase() === normalized,
  );
  return index >= 0 ? index : undefined;
}

function cellToText(value: SheetCell): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function resolveResultRowIndex(
  metadataRowIndex: unknown,
  unitRowIndex: number | undefined,
): number | undefined {
  const rowIndex = Number(metadataRowIndex ?? unitRowIndex);
  return Number.isInteger(rowIndex) ? rowIndex : undefined;
}

function ensureWorksheetRefIncludesCell(
  worksheet: XLSX.WorkSheet,
  rowIndex: number,
  columnIndex: number,
): void {
  const cellRange = {
    s: { r: rowIndex, c: columnIndex },
    e: { r: rowIndex, c: columnIndex },
  };

  if (!worksheet['!ref']) {
    worksheet['!ref'] = XLSX.utils.encode_range(cellRange);
    return;
  }

  const range = XLSX.utils.decode_range(worksheet['!ref']);
  range.s.r = Math.min(range.s.r, rowIndex);
  range.s.c = Math.min(range.s.c, columnIndex);
  range.e.r = Math.max(range.e.r, rowIndex);
  range.e.c = Math.max(range.e.c, columnIndex);
  worksheet['!ref'] = XLSX.utils.encode_range(range);
}

function detectBookType(
  outputPath: string,
  explicitFormat?: 'xlsx' | 'csv',
): XLSX.BookType {
  if (explicitFormat) return explicitFormat;

  const extension = extname(outputPath).toLowerCase();
  if (extension === '.csv') return 'csv';
  return 'xlsx';
}
