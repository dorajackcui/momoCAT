import { readFile, writeFile } from 'fs/promises';
import { extname, resolve } from 'path';
import * as XLSX from 'xlsx';
import type {
  FileCellValue,
  FileParseArtifact,
  FileParseColumnsArtifact,
  FileParseRowArtifact,
  InspectArtifact,
} from '../artifacts';
import type { LocalizationUnit, TranslateFileInput, TranslateUnitsResult } from '../types';

export type SheetCell = string | number | boolean | null | undefined;

export interface ParsedSpreadsheetFile {
  inputPath: string;
  workbook: XLSX.WorkBook;
  sheetName: string;
  worksheet: XLSX.WorkSheet;
  columns: FileParseColumnsArtifact;
  rawRows: SheetCell[][];
  artifact: FileParseArtifact;
}

interface WorksheetCellEntry {
  rowIndex: number;
  columnIndex: number;
  value: SheetCell;
}

type WorksheetCellRows = Map<number, Map<number, SheetCell>>;

const INSPECT_COLUMNS = [
  '_tm_for_mt',
  '_tb_for_mt',
  '_mt_user_prompt',
  '_inspect_status',
  '_inspect_json_ref',
] as const;
const REFERENCE_EXPORT_COLUMNS = ['_tm_for_mt', '_tb_for_mt'] as const;
const DEFAULT_CONTEXT_HEADER = 'context';

export async function parseExternalSpreadsheet(
  input: TranslateFileInput,
): Promise<ParsedSpreadsheetFile> {
  const workbook = XLSX.read(await readFile(input.inputPath), { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error(`Workbook has no sheets: ${input.inputPath}`);
  }

  const worksheet = workbook.Sheets[sheetName];
  const worksheetCells = collectWorksheetCells(worksheet);
  const worksheetRows = groupWorksheetCellsByRow(worksheetCells);
  const columns = resolveColumns(buildRowFromCellRows(worksheetRows, 0), input.columns);
  const rawRows = buildRawRowsThroughLastSource(worksheetCells, worksheetRows, columns);
  const artifact: FileParseArtifact = {
    inputPath: input.inputPath,
    sheetName,
    columns,
    rows: rowsToArtifacts(rawRows, columns),
  };

  return {
    inputPath: input.inputPath,
    workbook,
    sheetName,
    worksheet,
    columns,
    rawRows,
    artifact,
  };
}

export function fileRowsToLocalizationUnits(rows: FileParseRowArtifact[]): LocalizationUnit[] {
  return rows
    .filter((row) => row.source.trim())
    .map((row) => ({
      id: row.unitId,
      source: row.source,
      target: row.target,
      context: row.context,
      rowNumber: row.rowNumber,
      metadata: {
        rowIndex: row.rowIndex,
        rowNumber: row.rowNumber,
      },
    }));
}

export async function writeTranslatedSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  translation: TranslateUnitsResult,
  outputPath: string,
  explicitFormat?: TranslateFileInput['format'],
): Promise<void> {
  assertNotInputPath(parsed.inputPath, outputPath);

  const rowIndexByUnitId = new Map(
    parsed.artifact.rows.map((row) => [row.unitId, row.rowIndex] as const),
  );

  for (const result of translation.results) {
    if (result.status === 'failed' || result.target === undefined) continue;

    const rowIndex = resolveResultRowIndex(
      result.metadata?.rowIndex,
      rowIndexByUnitId.get(result.id),
    );
    if (rowIndex === undefined) continue;

    const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: parsed.columns.targetCol });
    parsed.worksheet[cellAddress] = { t: 's', v: result.target };
    ensureWorksheetRefIncludesCell(parsed.worksheet, rowIndex, parsed.columns.targetCol);
  }

  compactWorksheetRefToParsedRows(parsed);
  await writeWorkbook(parsed.workbook, outputPath, detectBookType(outputPath, explicitFormat));
}

export async function writeInspectSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  artifact: InspectArtifact,
  outputPath: string,
): Promise<void> {
  assertNotInputPath(parsed.inputPath, outputPath);

  const workbook = XLSX.utils.book_new();
  const inspectUnitById = new Map(
    artifact.units.map((unit, index) => [unit.unit.unitId, { unit, index }] as const),
  );
  const parseRowByIndex = new Map(parsed.artifact.rows.map((row) => [row.rowIndex, row] as const));

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildSegmentRows(parsed, parseRowByIndex, inspectUnitById)),
    'Segments',
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildSystemPromptRows(artifact)),
    'MT_SystemPrompt',
  );

  await writeWorkbook(workbook, outputPath, 'xlsx');
}

export interface ReferenceExportSpreadsheetRow {
  unitId: string;
  tmForMt: string;
  tbForMt: string;
}

export async function writeReferencesForMtSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  rows: ReferenceExportSpreadsheetRow[],
  outputPath: string,
): Promise<void> {
  assertNotInputPath(parsed.inputPath, outputPath);

  const workbook = XLSX.utils.book_new();
  const rowByUnitId = new Map(rows.map((row) => [row.unitId, row] as const));

  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildReferenceExportRows(parsed, rowByUnitId)),
    parsed.sheetName,
  );

  await writeWorkbook(workbook, outputPath, 'xlsx');
}

function resolveColumns(
  headerRow: SheetCell[],
  options: TranslateFileInput['columns'] = {},
): FileParseColumnsArtifact {
  const hasHeader = options.hasHeader !== false;
  const sourceCol =
    options.sourceCol ??
    (hasHeader ? findHeaderColumn(headerRow, options.sourceHeader ?? 'source') : undefined);
  const targetCol =
    options.targetCol ??
    (hasHeader ? findHeaderColumn(headerRow, options.targetHeader ?? 'target') : undefined);
  const contextCol =
    options.contextCol ??
    (hasHeader
      ? findHeaderColumn(headerRow, options.contextHeader ?? DEFAULT_CONTEXT_HEADER)
      : undefined);

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

function collectWorksheetCells(worksheet: XLSX.WorkSheet): WorksheetCellEntry[] {
  const cells: WorksheetCellEntry[] = [];

  for (const [address, cell] of Object.entries(worksheet)) {
    if (address.startsWith('!')) continue;

    const decoded = XLSX.utils.decode_cell(address);
    const value = readCellValue(cell as XLSX.CellObject);
    if (value === undefined) continue;

    cells.push({
      rowIndex: decoded.r,
      columnIndex: decoded.c,
      value,
    });
  }

  return cells;
}

function groupWorksheetCellsByRow(cells: WorksheetCellEntry[]): WorksheetCellRows {
  const rows: WorksheetCellRows = new Map();

  for (const cell of cells) {
    let row = rows.get(cell.rowIndex);
    if (!row) {
      row = new Map();
      rows.set(cell.rowIndex, row);
    }
    row.set(cell.columnIndex, cell.value);
  }

  return rows;
}

function readCellValue(cell: XLSX.CellObject): SheetCell {
  if (!Object.prototype.hasOwnProperty.call(cell, 'v')) return undefined;

  const value = cell.v;
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function buildRawRowsThroughLastSource(
  cells: WorksheetCellEntry[],
  rows: WorksheetCellRows,
  columns: FileParseColumnsArtifact,
): SheetCell[][] {
  const startIndex = columns.hasHeader ? 1 : 0;
  const lastSourceRowIndex = findLastSourceRowIndex(cells, columns.sourceCol, startIndex);
  if (lastSourceRowIndex === undefined) {
    return columns.hasHeader ? [buildRowFromCellRows(rows, 0)] : [];
  }

  const endRowIndex = findLastContiguousContentRowIndex(rows, lastSourceRowIndex);
  const maxColumnIndex = findMaxColumnIndex(cells, endRowIndex, columns);
  const rawRows: SheetCell[][] = [];

  for (let rowIndex = 0; rowIndex <= endRowIndex; rowIndex += 1) {
    rawRows.push(buildRowFromCellRows(rows, rowIndex, maxColumnIndex));
  }

  return rawRows;
}

function findLastSourceRowIndex(
  cells: WorksheetCellEntry[],
  sourceColumnIndex: number,
  startIndex: number,
): number | undefined {
  let lastSourceRowIndex: number | undefined;

  for (const cell of cells) {
    if (cell.columnIndex !== sourceColumnIndex || cell.rowIndex < startIndex) continue;
    if (!cellToText(cell.value).trim()) continue;

    lastSourceRowIndex =
      lastSourceRowIndex === undefined
        ? cell.rowIndex
        : Math.max(lastSourceRowIndex, cell.rowIndex);
  }

  return lastSourceRowIndex;
}

function findLastContiguousContentRowIndex(
  rows: WorksheetCellRows,
  lastSourceRowIndex: number,
): number {
  let rowIndex = lastSourceRowIndex + 1;
  let endRowIndex = lastSourceRowIndex;

  let scanning = true;
  while (scanning) {
    const cells = rows.get(rowIndex);
    if (!cells) {
      scanning = false;
      continue;
    }

    const hasContent = Array.from(cells.values()).some((value) => cellToText(value).trim());
    if (!hasContent) {
      scanning = false;
      continue;
    }

    endRowIndex = rowIndex;
    rowIndex += 1;
  }

  return endRowIndex;
}

function findMaxColumnIndex(
  cells: WorksheetCellEntry[],
  endRowIndex: number,
  columns: FileParseColumnsArtifact,
): number {
  let maxColumnIndex = Math.max(columns.sourceCol, columns.targetCol, columns.contextCol ?? 0, 0);

  for (const cell of cells) {
    if (cell.rowIndex > endRowIndex) continue;
    maxColumnIndex = Math.max(maxColumnIndex, cell.columnIndex);
  }

  return maxColumnIndex;
}

function buildRowFromCellRows(
  rows: WorksheetCellRows,
  rowIndex: number,
  maxColumnIndex?: number,
): SheetCell[] {
  const cells = rows.get(rowIndex);
  if (!cells) {
    return maxColumnIndex === undefined ? [] : Array.from({ length: maxColumnIndex + 1 }, () => '');
  }

  const rowMaxColumnIndex =
    maxColumnIndex ??
    Array.from(cells.keys()).reduce((maxIndex, columnIndex) => Math.max(maxIndex, columnIndex), -1);

  if (rowMaxColumnIndex < 0) return [];

  const row: SheetCell[] = Array.from({ length: rowMaxColumnIndex + 1 }, () => '');
  for (const [columnIndex, value] of cells.entries()) {
    if (columnIndex <= rowMaxColumnIndex) {
      row[columnIndex] = value ?? '';
    }
  }
  return row;
}

function rowsToArtifacts(
  rows: SheetCell[][],
  columns: FileParseColumnsArtifact,
): FileParseRowArtifact[] {
  const startIndex = columns.hasHeader ? 1 : 0;
  const artifacts: FileParseRowArtifact[] = [];

  for (let rowIndex = startIndex; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex] ?? [];
    const rowNumber = rowIndex + 1;
    artifacts.push({
      rowIndex,
      rowNumber,
      unitId: `row-${rowNumber}`,
      source: cellToText(row[columns.sourceCol]),
      target: cellToText(row[columns.targetCol]),
      context: columns.contextCol === undefined ? undefined : cellToText(row[columns.contextCol]),
      originalCells: row.map(cellToSerializableValue),
    });
  }

  return artifacts;
}

function buildSegmentRows(
  parsed: ParsedSpreadsheetFile,
  parseRowByIndex: Map<number, FileParseRowArtifact>,
  inspectUnitById: Map<string, { unit: InspectArtifact['units'][number]; index: number }>,
): FileCellValue[][] {
  const rows: FileCellValue[][] = [];

  if (!parsed.columns.hasHeader) {
    const width = Math.max(...parsed.rawRows.map((row) => row.length), 0);
    rows.push([
      ...Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      ...INSPECT_COLUMNS,
    ]);
  }

  for (let rowIndex = 0; rowIndex < parsed.rawRows.length; rowIndex += 1) {
    const originalCells = (parsed.rawRows[rowIndex] ?? []).map(cellToSerializableValue);
    if (parsed.columns.hasHeader && rowIndex === 0) {
      rows.push([...originalCells, ...INSPECT_COLUMNS]);
      continue;
    }

    const parseRow = parseRowByIndex.get(rowIndex);
    if (!parseRow) {
      rows.push([...originalCells, '', '', '', '', '']);
      continue;
    }

    if (!parseRow.source.trim()) {
      rows.push([...originalCells, '', '', '', 'skipped-empty-source', '']);
      continue;
    }

    const inspectedEntry = inspectUnitById.get(parseRow.unitId);
    if (!inspectedEntry) {
      rows.push([...originalCells, '', '', '', 'not-inspected', '']);
      continue;
    }
    const inspected = inspectedEntry.unit;

    rows.push([
      ...originalCells,
      inspected.xlsx.tmForMt,
      inspected.xlsx.tbForMt,
      inspected.xlsx.mtUserPrompt,
      inspected.status,
      `#/units/${inspectedEntry.index}`,
    ]);
  }

  return rows;
}

function buildReferenceExportRows(
  parsed: ParsedSpreadsheetFile,
  referenceRowByUnitId: Map<string, ReferenceExportSpreadsheetRow>,
): FileCellValue[][] {
  const rows: FileCellValue[][] = [];
  const parseRowByIndex = new Map(parsed.artifact.rows.map((row) => [row.rowIndex, row] as const));

  if (!parsed.columns.hasHeader) {
    const width = Math.max(...parsed.rawRows.map((row) => row.length), 0);
    rows.push([
      ...Array.from({ length: width }, (_, index) => `Column ${index + 1}`),
      ...REFERENCE_EXPORT_COLUMNS,
    ]);
  }

  for (let rowIndex = 0; rowIndex < parsed.rawRows.length; rowIndex += 1) {
    const originalCells = (parsed.rawRows[rowIndex] ?? []).map(cellToSerializableValue);
    if (parsed.columns.hasHeader && rowIndex === 0) {
      rows.push([...originalCells, ...REFERENCE_EXPORT_COLUMNS]);
      continue;
    }

    const parseRow = parseRowByIndex.get(rowIndex);
    if (!parseRow || !parseRow.source.trim()) {
      rows.push([...originalCells, '', '']);
      continue;
    }

    const referenceRow = referenceRowByUnitId.get(parseRow.unitId);
    rows.push([
      ...originalCells,
      referenceRow?.tmForMt ?? '',
      referenceRow?.tbForMt ?? '',
    ]);
  }

  return rows;
}

function buildSystemPromptRows(artifact: InspectArtifact): FileCellValue[][] {
  const promptUnit = artifact.units.find((unit) => unit.status === 'ready');

  return [
    ['key', 'value'],
    ['project_id', artifact.project.id],
    ['project_name', artifact.project.name],
    ['provider_id', promptUnit?.mt.provider.id ?? ''],
    ['provider_name', promptUnit?.mt.provider.name ?? ''],
    ['model', promptUnit?.mt.model ?? ''],
    ['reasoning_effort', promptUnit?.mt.reasoningEffort ?? ''],
    ['systemPrompt', artifact.systemPrompt.xlsxValue],
    ['promptChars', artifact.systemPrompt.promptChars],
    ['truncated', artifact.systemPrompt.truncated],
  ];
}

function findHeaderColumn(headerRow: SheetCell[], headerName: string): number | undefined {
  const normalized = headerName.trim().toLowerCase();
  const index = headerRow.findIndex((cell) => cellToText(cell).trim().toLowerCase() === normalized);
  return index >= 0 ? index : undefined;
}

function cellToText(value: SheetCell): string {
  if (value === null || value === undefined) return '';
  return String(value);
}

function cellToSerializableValue(value: SheetCell): FileCellValue {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
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

function compactWorksheetRefToParsedRows(parsed: ParsedSpreadsheetFile): void {
  if (parsed.rawRows.length === 0) {
    delete parsed.worksheet['!ref'];
    return;
  }

  const maxRowIndex = parsed.rawRows.length - 1;
  const maxColumnIndex = Math.max(
    parsed.columns.sourceCol,
    parsed.columns.targetCol,
    parsed.columns.contextCol ?? 0,
    ...parsed.rawRows.map((row) => Math.max(row.length - 1, 0)),
  );

  parsed.worksheet['!ref'] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRowIndex, c: maxColumnIndex },
  });
}

async function writeWorkbook(
  workbook: XLSX.WorkBook,
  outputPath: string,
  bookType: XLSX.BookType,
): Promise<void> {
  const data = XLSX.write(workbook, { bookType, type: 'buffer' }) as Buffer | Uint8Array | string;

  if (typeof data === 'string') {
    await writeFile(outputPath, data, 'utf8');
  } else {
    await writeFile(outputPath, Buffer.from(data));
  }
}

function assertNotInputPath(inputPath: string, outputPath: string): void {
  if (normalizePath(inputPath) === normalizePath(outputPath)) {
    throw new Error('Output path must be different from input path.');
  }
}

function normalizePath(path: string): string {
  const resolvedPath = resolve(path);
  return process.platform === 'win32' ? resolvedPath.toLowerCase() : resolvedPath;
}

function detectBookType(
  outputPath: string,
  explicitFormat?: TranslateFileInput['format'],
): XLSX.BookType {
  if (explicitFormat) return explicitFormat;

  const extension = extname(outputPath).toLowerCase();
  if (extension === '.csv') return 'csv';
  return 'xlsx';
}
