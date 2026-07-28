import * as XLSX from 'xlsx';
import { readFile } from 'fs/promises';

export type SheetCellValue = string | number | boolean | null | undefined;

export interface SheetRow {
  rowIndex: number;
  cells: SheetCellValue[];
}

interface ExtractSheetRowsOptions {
  columnIndexes?: number[];
  maxRows?: number;
}

/**
 * Read ONLY the first sheet of a spreadsheet, parsed for row extraction as
 * cheaply as xlsx allows: dense rows (no per-cell 'A1' object keys), no
 * formatted-text/HTML side products, and no parsing of any other sheet.
 * On wide or multi-sheet workbooks this is several times faster than a
 * default XLSX.read of the whole file.
 */
export async function readFirstSheet(filePath: string): Promise<XLSX.WorkSheet> {
  const workbook = XLSX.read(await readFile(filePath), {
    type: 'buffer',
    dense: true,
    sheets: 0,
    cellText: false,
    cellHTML: false,
  });
  return workbook.Sheets[workbook.SheetNames[0]];
}

function normalizeCellValue(cell: XLSX.CellObject | undefined): SheetCellValue {
  if (!cell) return undefined;
  const rawValue = cell.v;
  if (rawValue === null || rawValue === undefined) return undefined;
  if (typeof rawValue === 'string') {
    return rawValue;
  }
  if (typeof rawValue === 'number' || typeof rawValue === 'boolean') {
    return rawValue;
  }
  return String(rawValue);
}

function shouldKeepCell(value: SheetCellValue): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function extractSheetRows(
  worksheet: XLSX.WorkSheet,
  options: ExtractSheetRowsOptions = {},
): SheetRow[] {
  const columnSet = options.columnIndexes
    ? new Set(options.columnIndexes.filter((col) => Number.isInteger(col) && col >= 0))
    : null;

  // Dense worksheets (XLSX.read with dense: true) are arrays of cell rows.
  // Reading dense skips building one 'A1'-keyed object entry per cell, which
  // is dramatically cheaper on wide/tall sheets.
  if (Array.isArray(worksheet)) {
    const result: SheetRow[] = [];
    const denseRows = worksheet as unknown as Array<Array<XLSX.CellObject | undefined> | undefined>;
    for (let rowIndex = 0; rowIndex < denseRows.length; rowIndex++) {
      if (options.maxRows && options.maxRows > 0 && result.length >= options.maxRows) break;
      const denseRow = denseRows[rowIndex];
      if (!denseRow) continue;

      let rowArray: SheetCellValue[] | null = null;
      for (let colIndex = 0; colIndex < denseRow.length; colIndex++) {
        if (columnSet && !columnSet.has(colIndex)) continue;
        const value = normalizeCellValue(denseRow[colIndex]);
        if (!shouldKeepCell(value)) continue;
        rowArray ??= [];
        rowArray[colIndex] = value;
      }
      if (rowArray) {
        result.push({ rowIndex, cells: rowArray });
      }
    }
    return result;
  }

  const rowMap = new Map<number, Map<number, SheetCellValue>>();

  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith('!')) continue;

    const decoded = XLSX.utils.decode_cell(address);
    if (columnSet && !columnSet.has(decoded.c)) continue;

    const value = normalizeCellValue(cell as XLSX.CellObject);
    if (!shouldKeepCell(value)) continue;

    let row = rowMap.get(decoded.r);
    if (!row) {
      row = new Map<number, SheetCellValue>();
      rowMap.set(decoded.r, row);
    }
    row.set(decoded.c, value);
  }

  const sortedRowIndexes = Array.from(rowMap.keys()).sort((a, b) => a - b);
  const limitedIndexes =
    options.maxRows && options.maxRows > 0
      ? sortedRowIndexes.slice(0, options.maxRows)
      : sortedRowIndexes;

  return limitedIndexes.map((rowIndex) => {
    const cells = rowMap.get(rowIndex);
    if (!cells) return { rowIndex, cells: [] };

    const rowArray: SheetCellValue[] = [];
    for (const [colIndex, value] of cells.entries()) {
      rowArray[colIndex] = value;
    }
    return {
      rowIndex,
      cells: rowArray,
    };
  });
}
