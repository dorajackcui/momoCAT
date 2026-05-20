import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import * as XLSX from 'xlsx';
import { translateSpreadsheetFile } from './spreadsheetFileAdapter';
import type { LocalizationUnit, TranslateUnitsResult } from './types';

describe('translateSpreadsheetFile', () => {
  it('detects source and target headers and writes translated output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-localization-file-'));
    try {
      const inputPath = join(root, 'mt.xlsx');
      const outputPath = join(root, 'mt.fr.xlsx');
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['source', 'target', 'note'],
        ['你好', '', 'row note'],
        ['已有译文', 'Deja traduit', 'keep'],
      ]);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet2');
      XLSX.writeFile(workbook, inputPath);

      const translateUnits = vi.fn(
        async (units: LocalizationUnit[]): Promise<TranslateUnitsResult> => {
          expect(units).toEqual([
            {
              id: 'row-2',
              source: '你好',
              target: '',
              context: undefined,
              rowNumber: 2,
              metadata: { rowIndex: 1, rowNumber: 2 },
            },
            {
              id: 'row-3',
              source: '已有译文',
              target: 'Deja traduit',
              context: undefined,
              rowNumber: 3,
              metadata: { rowIndex: 2, rowNumber: 3 },
            },
          ]);

          return {
            summary: { total: 2, translated: 1, skipped: 1, failed: 0 },
            results: [
              {
                id: 'row-2',
                source: '你好',
                target: 'Bonjour',
                status: 'translated',
              },
              {
                id: 'row-3',
                source: '已有译文',
                target: 'Deja traduit',
                status: 'skipped',
              },
            ],
          };
        },
      );

      const result = await translateSpreadsheetFile(
        {
          projectId: 3,
          inputPath,
          outputPath,
          options: { targetScope: 'blank-only' },
        },
        translateUnits,
      );

      expect(translateUnits).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        inputPath,
        outputPath,
        summary: { total: 2, translated: 1, skipped: 1, failed: 0 },
      });

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet2, {
        header: 1,
      }) as string[][];
      expect(rows[1][1]).toBe('Bonjour');
      expect(rows[2][1]).toBe('Deja traduit');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('fails when required headers are missing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-localization-file-'));
    try {
      const inputPath = join(root, 'bad.xlsx');
      const outputPath = join(root, 'bad.out.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['src', 'dst']]), 'Sheet1');
      XLSX.writeFile(workbook, inputPath);

      await expect(
        translateSpreadsheetFile({ projectId: 3, inputPath, outputPath }, async () => {
          throw new Error('translate should not run');
        }),
      ).rejects.toThrow('Could not detect source/target columns');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('expands worksheet range when numeric target column is outside existing cells', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-localization-file-'));
    try {
      const inputPath = join(root, 'source-only.xlsx');
      const outputPath = join(root, 'source-only.out.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['Hello'], ['World']]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      const translateUnits = vi.fn(
        async (units: LocalizationUnit[]): Promise<TranslateUnitsResult> => {
          expect(units).toEqual([
            {
              id: 'row-1',
              source: 'Hello',
              target: '',
              context: undefined,
              rowNumber: 1,
              metadata: { rowIndex: 0, rowNumber: 1 },
            },
            {
              id: 'row-2',
              source: 'World',
              target: '',
              context: undefined,
              rowNumber: 2,
              metadata: { rowIndex: 1, rowNumber: 2 },
            },
          ]);

          return {
            summary: { total: 2, translated: 2, skipped: 0, failed: 0 },
            results: [
              {
                id: 'row-1',
                source: 'Hello',
                target: 'Bonjour',
                status: 'translated',
              },
              {
                id: 'row-2',
                source: 'World',
                target: 'Monde',
                status: 'translated',
              },
            ],
          };
        },
      );

      await translateSpreadsheetFile(
        {
          projectId: 3,
          inputPath,
          outputPath,
          columns: { hasHeader: false, sourceCol: 0, targetCol: 2 },
        },
        translateUnits,
      );

      expect(translateUnits).toHaveBeenCalledTimes(1);

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const worksheet = written.Sheets.Sheet1;
      const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as string[][];
      expect(worksheet['!ref']).toBe('A1:C2');
      expect(rows[0][2]).toBe('Bonjour');
      expect(rows[1][2]).toBe('Monde');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('honors explicit xlsx format even when output path has csv extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-localization-file-'));
    try {
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'output.csv');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', ''],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      await translateSpreadsheetFile(
        {
          projectId: 3,
          inputPath,
          outputPath,
          format: 'xlsx',
        },
        async () => ({
          summary: { total: 1, translated: 1, skipped: 0, failed: 0 },
          results: [
            {
              id: 'row-2',
              source: 'Hello',
              target: 'Bonjour',
              status: 'translated',
            },
          ],
        }),
      );

      const writtenBytes = await readFile(outputPath);
      expect(writtenBytes.subarray(0, 2).toString('utf8')).toBe('PK');

      const written = XLSX.read(writtenBytes, { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][1]).toBe('Bonjour');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
