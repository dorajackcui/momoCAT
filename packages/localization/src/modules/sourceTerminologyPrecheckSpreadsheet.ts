import * as XLSX from 'xlsx';
import type { FileCellValue } from '../artifacts';
import type { ParsedSpreadsheetFile } from './FileModule';
import {
  assertDistinctSpreadsheetPaths,
  buildRowsWithAppendedColumns,
  writeSpreadsheetWorkbook,
} from './spreadsheetOutput';

const OUTPUT_COLUMNS = [
  '_historical_tb',
  '_new_source_terms',
  '_term_precheck_status',
  '_term_precheck_error',
] as const;

export interface SourceTerminologyPrecheckSpreadsheetRow {
  unitId: string;
  historicalTb: string;
  sourceTerms: string[];
  status: 'ready' | 'error' | 'cancelled';
  error?: string;
}

export interface SourceTerminologySummarySpreadsheetRow {
  sourceTerm: string;
  variants: string[];
  occurrences: number;
  rowNumbers: number[];
  sampleSources: string[];
  status: 'candidate';
}

export async function writeSourceTerminologyPrecheckSpreadsheet(
  parsed: ParsedSpreadsheetFile,
  rows: SourceTerminologyPrecheckSpreadsheetRow[],
  terms: SourceTerminologySummarySpreadsheetRow[],
  outputPath: string,
): Promise<void> {
  assertDistinctSpreadsheetPaths(parsed.inputPath, outputPath);

  const workbook = XLSX.utils.book_new();
  const rowByUnitId = new Map(rows.map((row) => [row.unitId, row] as const));
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(
      buildRowsWithAppendedColumns(parsed, OUTPUT_COLUMNS, (parseRow) => {
        if (!parseRow?.source.trim()) return ['', '', '', ''];
        const result = rowByUnitId.get(parseRow.unitId);
        return [
          result?.historicalTb ?? '',
          result?.sourceTerms.join('\n') ?? '',
          result?.status ?? 'error',
          result?.error ?? (result ? '' : 'Term precheck result was not produced.'),
        ];
      }),
    ),
    parsed.sheetName,
  );
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet(buildSummaryRows(terms)),
    uniqueSheetName('New_Terms', workbook.SheetNames),
  );

  await writeSpreadsheetWorkbook(workbook, outputPath, 'xlsx');
}

function buildSummaryRows(terms: SourceTerminologySummarySpreadsheetRow[]): FileCellValue[][] {
  return [
    ['source_term', 'variants', 'occurrences', 'rows', 'sample_sources', 'status'],
    ...terms.map((term) => [
      term.sourceTerm,
      term.variants.join('\n'),
      term.occurrences,
      term.rowNumbers.join(', '),
      term.sampleSources.join('\n---\n'),
      term.status,
    ]),
  ];
}

function uniqueSheetName(preferredName: string, existingNames: string[]): string {
  const existing = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  if (!existing.has(preferredName.toLocaleLowerCase())) return preferredName;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${preferredName}_${suffix}`;
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  throw new Error(`Unable to allocate worksheet name for ${preferredName}.`);
}
