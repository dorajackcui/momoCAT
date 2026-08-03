import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import * as XLSX from 'xlsx';
import type { FileCellValue, FileParseRowArtifact } from '../artifacts';
import type { ParsedSpreadsheetFile, SheetCell } from './FileModule';

export function buildRowsWithAppendedColumns(
  parsed: ParsedSpreadsheetFile,
  outputColumns: readonly string[],
  buildOutputCells: (row: FileParseRowArtifact | undefined) => FileCellValue[],
): FileCellValue[][] {
  const rows: FileCellValue[][] = [];
  const parseRowByIndex = new Map(parsed.artifact.rows.map((row) => [row.rowIndex, row] as const));

  if (!parsed.columns.hasHeader) {
    const width = Math.max(...parsed.rawRows.map((row) => row.length), 0);
    rows.push([
      ...Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      ...outputColumns,
    ]);
  }

  for (let rowIndex = 0; rowIndex < parsed.rawRows.length; rowIndex += 1) {
    const originalCells = (parsed.rawRows[rowIndex] ?? []).map(toFileCellValue);
    if (parsed.columns.hasHeader && rowIndex === 0) {
      rows.push([...originalCells, ...outputColumns]);
      continue;
    }

    const outputCells = buildOutputCells(parseRowByIndex.get(rowIndex));
    if (outputCells.length !== outputColumns.length) {
      throw new Error(
        `Spreadsheet output row has ${outputCells.length} cells; expected ${outputColumns.length}.`,
      );
    }
    rows.push([...originalCells, ...outputCells]);
  }

  return rows;
}

export function toFileCellValue(value: SheetCell): FileCellValue {
  return value ?? null;
}

export async function writeSpreadsheetWorkbook(
  workbook: XLSX.WorkBook,
  outputPath: string,
  bookType: XLSX.BookType,
): Promise<void> {
  const data = XLSX.write(workbook, { bookType, type: 'buffer' }) as Buffer | Uint8Array | string;
  if (typeof data === 'string') {
    await writeFile(outputPath, data, 'utf8');
    return;
  }
  await writeFile(outputPath, Buffer.from(data));
}

export function assertDistinctSpreadsheetPaths(inputPath: string, outputPath: string): void {
  if (normalizePath(inputPath) === normalizePath(outputPath)) {
    throw new Error('Output path must be different from input path.');
  }
}

function normalizePath(path: string): string {
  const resolvedPath = resolve(path);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}
