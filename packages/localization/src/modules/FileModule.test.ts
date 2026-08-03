import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { InspectArtifact } from '../artifacts';
import type { TranslateUnitsResult } from '../types';
import {
  fileRowsToLocalizationUnits,
  parseExternalSpreadsheet,
  writeInspectSpreadsheet,
  writeTranslatedSpreadsheet,
} from './FileModule';

describe('FileModule', () => {
  it('parses the first worksheet, preserves cells, and filters empty-source units', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'parse.xlsx');
      const outputPath = join(root, 'unused.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target', 'ctx', 'flag'],
          ['Hello', '', 'menu', true],
          ['', 'Existing', 'empty row', false],
          ['Bye', 2, '', true],
        ]),
        'First',
      );
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Ignored', 'Ignored'],
        ]),
        'Second',
      );
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath,
        columns: { contextHeader: 'ctx' },
      });

      expect(parsed.sheetName).toBe('First');
      expect(parsed.rawRows).toHaveLength(4);
      expect(parsed.artifact.rows).toEqual([
        {
          rowIndex: 1,
          rowNumber: 2,
          unitId: 'row-2',
          source: 'Hello',
          target: '',
          context: 'menu',
          originalCells: ['Hello', '', 'menu', true],
        },
        {
          rowIndex: 2,
          rowNumber: 3,
          unitId: 'row-3',
          source: '',
          target: 'Existing',
          context: 'empty row',
          originalCells: ['', 'Existing', 'empty row', false],
        },
        {
          rowIndex: 3,
          rowNumber: 4,
          unitId: 'row-4',
          source: 'Bye',
          target: '2',
          context: '',
          originalCells: ['Bye', 2, '', true],
        },
      ]);

      expect(fileRowsToLocalizationUnits(parsed.artifact.rows)).toEqual([
        {
          id: 'row-2',
          source: 'Hello',
          target: '',
          context: 'menu',
          rowNumber: 2,
          metadata: { rowIndex: 1, rowNumber: 2 },
        },
        {
          id: 'row-4',
          source: 'Bye',
          target: '2',
          context: '',
          rowNumber: 4,
          metadata: { rowIndex: 3, rowNumber: 4 },
        },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('preserves non-Latin text in a UTF-8 CSV without a byte-order mark', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'utf8.csv');
      const outputPath = join(root, 'unused.xlsx');
      await writeFile(
        inputPath,
        'source,target\r\n“天空港”什么时候开放？,\r\nプロジェクト名は星の庭です。,',
        'utf8',
      );

      const parsed = await parseExternalSpreadsheet({ projectId: 1, inputPath, outputPath });

      expect(parsed.artifact.rows.map((row) => row.source)).toEqual([
        '“天空港”什么时候开放？',
        'プロジェクト名は星の庭です。',
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('strips a UTF-8 byte-order mark from headerless CSV source text', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'utf8-bom.csv');
      const outputPath = join(root, 'unused.xlsx');
      await writeFile(inputPath, '\uFEFF天空港,', 'utf8');

      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath,
        columns: { hasHeader: false, sourceCol: 0, targetCol: 1 },
      });

      expect(parsed.artifact.rows[0]).toMatchObject({
        source: '天空港',
        originalCells: ['天空港', ''],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('defaults optional context column to the context header', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'default-context.xlsx');
      const outputPath = join(root, 'unused.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target', 'context'],
          ['Hello', '', 'menu label'],
          ['Bye', '', 'toolbar action'],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 1, inputPath, outputPath });

      expect(parsed.artifact.rows.map((row) => row.context)).toEqual([
        'menu label',
        'toolbar action',
      ]);
      expect(fileRowsToLocalizationUnits(parsed.artifact.rows).map((unit) => unit.context)).toEqual(
        ['menu label', 'toolbar action'],
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('stops parsing at the last non-empty source cell even when worksheet range is bloated', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'bloated-range.xlsx');
      const outputPath = join(root, 'unused.xlsx');
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['source', 'target', 'note'],
        ['Hello', '', 'first'],
        ['', 'Existing target', 'blank source before final source'],
        ['Bye', '', 'last source'],
      ]);

      worksheet.B100 = { t: 's', v: 'orphan target after source data' };
      worksheet['!ref'] = 'A1:C5000';
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 1, inputPath, outputPath });

      expect(parsed.rawRows).toHaveLength(4);
      expect(parsed.rawRows[3]).toEqual(['Bye', '', 'last source']);
      expect(parsed.rawRows.flat()).not.toContain('orphan target after source data');
      expect(parsed.artifact.rows.map((row) => row.rowNumber)).toEqual([2, 3, 4]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes translated targets to a new workbook without changing input bytes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'input.xlsx');
      const outputPath = join(root, 'output.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target'],
          ['Hello', ''],
          ['Bye', 'Old'],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const inputBefore = await readFile(inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 1, inputPath, outputPath });
      const translation: TranslateUnitsResult = {
        summary: { total: 2, translated: 1, skipped: 1, failed: 0 },
        results: [
          {
            id: 'row-2',
            source: 'Hello',
            target: 'Bonjour',
            status: 'translated',
            metadata: { rowIndex: 1 },
          },
          {
            id: 'row-3',
            source: 'Bye',
            target: 'Au revoir',
            status: 'skipped',
          },
        ],
      };

      await writeTranslatedSpreadsheet(parsed, translation, outputPath);

      expect(await readFile(inputPath)).toEqual(inputBefore);
      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const rows = XLSX.utils.sheet_to_json(written.Sheets.Sheet1, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows[1][1]).toBe('Bonjour');
      expect(rows[2][1]).toBe('Au revoir');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('compacts translated workbook range to parsed rows instead of preserving bloated ranges', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'bloated-input.xlsx');
      const outputPath = join(root, 'compact-output.xlsx');
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.aoa_to_sheet([
        ['source', 'target'],
        ['Hello', ''],
        ['Bye', ''],
      ]);
      worksheet.B100 = { t: 's', v: 'orphan target after source data' };
      worksheet['!ref'] = 'A1:B5000';
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 1, inputPath, outputPath });
      await writeTranslatedSpreadsheet(
        parsed,
        {
          summary: { total: 2, translated: 2, skipped: 0, failed: 0 },
          results: [
            {
              id: 'row-2',
              source: 'Hello',
              target: 'Bonjour',
              status: 'translated',
              metadata: { rowIndex: 1 },
            },
            {
              id: 'row-3',
              source: 'Bye',
              target: 'Au revoir',
              status: 'translated',
              metadata: { rowIndex: 2 },
            },
          ],
        },
        outputPath,
      );

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const worksheetOut = written.Sheets.Sheet1;
      expect(worksheetOut['!ref']).toBe('A1:B3');
      const rows = XLSX.utils.sheet_to_json(worksheetOut, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(rows).toEqual([
        ['source', 'target'],
        ['Hello', 'Bonjour'],
        ['Bye', 'Au revoir'],
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects writing translated output over the input file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'input.xlsx');
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
      const inputBefore = await readFile(inputPath);

      const parsed = await parseExternalSpreadsheet({
        projectId: 1,
        inputPath,
        outputPath: inputPath,
      });

      await expect(
        writeTranslatedSpreadsheet(parsed, buildTranslationResult('Bonjour'), inputPath),
      ).rejects.toThrow('Output path must be different from input path');

      expect(await readFile(inputPath)).toEqual(inputBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('writes inspect workbook segments and MT system prompt sheets', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'inspect-source.xlsx');
      const outputPath = join(root, 'inspect.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target', 'note'],
          ['Hello', '', 'menu'],
          ['', '', 'blank'],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 7, inputPath, outputPath });
      const artifact = buildInspectArtifact(parsed.artifact);

      await writeInspectSpreadsheet(parsed, artifact, outputPath);

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      expect(written.SheetNames).toEqual(['Segments', 'MT_SystemPrompt']);

      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[0]).toEqual([
        'source',
        'target',
        'note',
        '_tm_for_mt',
        '_tb_for_mt',
        '_mt_user_prompt',
        '_inspect_status',
        '_inspect_json_ref',
      ]);
      expect(segmentRows[1]).toEqual([
        'Hello',
        '',
        'menu',
        'TM block',
        'TB block',
        'Translate Hello',
        'ready',
        '#/units/0',
      ]);
      expect(segmentRows[2]).toEqual(['', '', 'blank', '', '', '', 'skipped-empty-source', '']);
      expect(segmentRows).toHaveLength(3);

      const promptRows = XLSX.utils.sheet_to_json(written.Sheets.MT_SystemPrompt, {
        header: 1,
        defval: '',
      }) as Array<[string, string | number | boolean]>;
      expect(promptRows).toContainEqual(['project_id', 7]);
      expect(promptRows).toContainEqual(['project_name', 'Demo Project']);
      expect(promptRows).toContainEqual(['provider_id', 'openai']);
      expect(promptRows).toContainEqual(['model', 'gpt-test']);
      expect(promptRows).toContainEqual(['reasoning_effort', 'medium']);
      expect(promptRows).toContainEqual(['systemPrompt', 'System prompt xlsx']);
      expect(promptRows).toContainEqual(['promptChars', 18]);
      expect(promptRows).toContainEqual(['truncated', false]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects writing inspect output over the input file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'inspect-source.xlsx');
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
      const inputBefore = await readFile(inputPath);

      const parsed = await parseExternalSpreadsheet({
        projectId: 7,
        inputPath,
        outputPath: inputPath,
      });
      const artifact = buildInspectArtifact(parsed.artifact);

      await expect(writeInspectSpreadsheet(parsed, artifact, inputPath)).rejects.toThrow(
        'Output path must be different from input path',
      );
      expect(await readFile(inputPath)).toEqual(inputBefore);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('marks source rows missing from inspect artifact as not inspected', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cat-file-module-'));
    try {
      const inputPath = join(root, 'partial-inspect-source.xlsx');
      const outputPath = join(root, 'partial-inspect.xlsx');
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([
          ['source', 'target', 'note'],
          ['Hello', '', 'first'],
          ['Bye', '', 'second'],
        ]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);

      const parsed = await parseExternalSpreadsheet({ projectId: 7, inputPath, outputPath });
      const artifact = buildInspectArtifact(parsed.artifact);

      await writeInspectSpreadsheet(parsed, artifact, outputPath);

      const written = XLSX.read(await readFile(outputPath), { type: 'buffer' });
      const segmentRows = XLSX.utils.sheet_to_json(written.Sheets.Segments, {
        header: 1,
        defval: '',
      }) as string[][];
      expect(segmentRows[1][6]).toBe('ready');
      expect(segmentRows[2]).toEqual(['Bye', '', 'second', '', '', '', 'not-inspected', '']);
      expect(segmentRows[2][6]).not.toBe('error');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function buildTranslationResult(target: string): TranslateUnitsResult {
  return {
    summary: { total: 1, translated: 1, skipped: 0, failed: 0 },
    results: [
      {
        id: 'row-2',
        source: 'Hello',
        target,
        status: 'translated',
      },
    ],
  };
}

function buildInspectArtifact(inputFile: InspectArtifact['inputFile']): InspectArtifact {
  const unit = inputFile.rows[0];

  return {
    version: 1,
    generatedAt: '2026-05-19T00:00:00.000Z',
    project: {
      id: 7,
      name: 'Demo Project',
      srcLang: 'en',
      tgtLang: 'fr',
      projectType: 'general',
      promptChars: 42,
    },
    inputFile,
    systemPrompt: {
      value: 'System prompt full',
      promptChars: 18,
      xlsxValue: 'System prompt xlsx',
      truncated: false,
    },
    units: [
      {
        unit,
        transientSegment: {
          segmentId: 'segment-row-2',
          matchKey: 'hello',
          srcHash: 'hash',
          tagsSignature: '',
        },
        tm: {
          unitId: unit.unitId,
          segmentId: 'segment-row-2',
          mountedTMs: [],
          rawMatches: [],
          selectedReferences: {
            tmReferences: [],
            concordanceReferences: [],
          },
          selectionPolicy: {
            maxTmReferences: 3,
            maxConcordanceReferences: 0,
          },
          diagnostics: [],
        },
        tb: {
          unitId: unit.unitId,
          segmentId: 'segment-row-2',
          mountedTBs: [],
          rawMatches: [],
          selectedReferences: [],
          selectionPolicy: {
            maxTbReferences: 3,
          },
          diagnostics: [],
        },
        mt: {
          unitId: unit.unitId,
          provider: {
            id: 'openai',
            name: 'OpenAI',
            baseUrl: null,
          },
          model: 'gpt-test',
          reasoningEffort: 'medium',
          projectPrompt: '',
          projectType: 'general',
          sourcePayload: 'Hello',
          tmPromptBlock: 'TM block',
          concordancePromptBlock: '',
          tbPromptBlock: 'TB block',
          referencePromptBlock: 'TM block\n\nTB block',
          systemPrompt: 'System prompt full',
          userPrompt: 'Translate Hello',
          promptChars: {
            system: 18,
            user: 15,
            total: 33,
          },
        },
        xlsx: {
          tmForMt: 'TM block',
          tbForMt: 'TB block',
          mtUserPrompt: 'Translate Hello',
          truncated: {
            tmForMt: false,
            tbForMt: false,
            mtUserPrompt: false,
          },
        },
        status: 'ready',
      },
    ],
  } as InspectArtifact;
}
