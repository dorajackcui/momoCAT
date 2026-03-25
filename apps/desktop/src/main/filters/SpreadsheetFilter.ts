import * as XLSX from 'xlsx';
import { readFile, writeFile } from 'fs/promises';
import { extname } from 'path';
import { type Segment } from '@cat/core/models';
import { parseDisplayTextToTokens, computeTagsSignature } from '@cat/core/tag';
import { computeMatchKey, computeSrcHash } from '@cat/core/text';
import { randomUUID } from 'crypto';
import { extractSheetRows, SheetCellValue } from './sheetRows';
import type { ImportOptions } from '../../shared/ipc';

export class SpreadsheetFilter {
  private async readWorkbook(filePath: string) {
    const fileBuffer = await readFile(filePath);
    return XLSX.read(fileBuffer, { type: 'buffer' });
  }

  private detectBookType(filePath: string): XLSX.BookType {
    const extension = extname(filePath).toLowerCase();
    if (extension === '.csv') return 'csv';
    if (extension === '.xls') return 'xls';
    return 'xlsx';
  }

  /**
   * Import a spreadsheet file (XLSX/CSV) and convert to Segments
   */
  public async import(
    filePath: string,
    projectId: number,
    fileId: number,
    options: ImportOptions,
  ): Promise<Segment[]> {
    void projectId;
    console.log(`[SpreadsheetFilter] Reading file: ${filePath}`);
    const workbook = await this.readWorkbook(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    const importColumnIndexes = [options.sourceCol, options.targetCol];
    if (typeof options.contextCol === 'number') {
      importColumnIndexes.push(options.contextCol);
    }

    // Only iterate rows that actually contain values in import-related columns.
    const sourceRows = extractSheetRows(worksheet, { columnIndexes: importColumnIndexes });
    console.log(
      `[SpreadsheetFilter] Read ${sourceRows.length} effective rows from sheet: ${firstSheetName}`,
    );

    const segments: Segment[] = [];
    for (let rowCursor = 0; rowCursor < sourceRows.length; rowCursor++) {
      if (options.hasHeader && rowCursor === 0) {
        continue;
      }

      const row = sourceRows[rowCursor];
      const sourceText = this.toCellText(row.cells[options.sourceCol]);
      if (!sourceText.trim()) {
        continue;
      }

      const targetText = this.toCellText(row.cells[options.targetCol]);
      const context =
        options.contextCol !== undefined
          ? this.toCellText(row.cells[options.contextCol])
          : undefined;

      const sourceTokens = parseDisplayTextToTokens(sourceText);
      const targetTokens = targetText ? parseDisplayTextToTokens(targetText) : [];

      const tagsSignature = computeTagsSignature(sourceTokens);
      const matchKey = computeMatchKey(sourceTokens);
      const srcHash = computeSrcHash(matchKey, tagsSignature);

      segments.push({
        segmentId: randomUUID(),
        fileId,
        orderIndex: row.rowIndex,
        sourceTokens,
        targetTokens,
        status: targetText ? 'translated' : 'new',
        tagsSignature,
        matchKey,
        srcHash,
        meta: {
          rowRef: row.rowIndex + 1,
          context,
          updatedAt: new Date().toISOString(),
        },
      });
    }

    return segments;
  }

  /**
   * Get first few rows of a spreadsheet for preview
   */
  public async getPreview(filePath: string, rowLimit: number = 10): Promise<SheetCellValue[][]> {
    const workbook = await this.readWorkbook(filePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    return extractSheetRows(worksheet, { maxRows: rowLimit }).map((row) => row.cells);
  }

  /**
   * Export segments back to a spreadsheet, preserving original structure if possible
   * For v0.1, we'll implement a simple "Export to New File" logic that follows the protocol.
   */
  public async export(
    originalFilePath: string,
    segments: Segment[],
    options: ImportOptions,
    outputPath: string,
  ): Promise<void> {
    const workbook = await this.readWorkbook(originalFilePath);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];

    // We update the worksheet in-place for high fidelity
    for (const seg of segments) {
      const rowIndex = seg.orderIndex; // 0-based index from rawData
      const targetText = seg.targetTokens.map((t) => t.content).join('');

      // XLSX row/col are 0-based in some utilities but cells are A1, B2...
      // sheet_to_json with header:1 gave us the array.
      // To write back, we can use XLSX.utils.sheet_add_aoa or direct cell access.

      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: options.targetCol });
      worksheet[cellAddress] = { t: 's', v: targetText };

      // Optionally write back status or other meta to specific columns if protocol allows
    }

    const bookType = this.detectBookType(outputPath);
    const data = XLSX.write(workbook, {
      bookType,
      type: 'buffer',
    }) as Buffer | Uint8Array | string;

    if (typeof data === 'string') {
      await writeFile(outputPath, data, 'utf8');
      return;
    }

    await writeFile(outputPath, Buffer.from(data));
  }

  private toCellText(value: SheetCellValue): string {
    if (value === null || value === undefined) return '';
    return String(value);
  }
}
