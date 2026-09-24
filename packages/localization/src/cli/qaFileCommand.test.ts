import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { CATDatabase } from '@cat/db';
import { normalizeQASettings } from '@cat/core/project';
import { createTransientSegment } from '../transientSegment';
import { runQAFileCommand } from './qaFileCommand';

describe('shared CLI QA', () => {
  it('keeps the stored file identity when there are no segments', async () => {
    const root = mkdtempSync(join(tmpdir(), 'momocat-qa-empty-'));
    try {
      const dbPath = join(root, 'cat.db');
      const db = new CATDatabase(dbPath);
      let projectId: number;
      let fileId: number;
      try {
        projectId = db.createProject('QA', 'en', 'zh');
        fileId = db.createFile(projectId, 'empty.xlsx');
      } finally {
        db.close();
      }
      const before = readFileSync(dbPath);
      expect(await runQAFileCommand({ dbPath, projectId, fileId })).toEqual({
        fileId,
        checkedSegments: 0,
        issueCount: 0,
        affectedSegments: 0,
        issues: [],
      });
      expect(readFileSync(dbPath)).toEqual(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['{broken', 'null', '{"tagPolicy":"unknown"}'])(
    'reports corrupt stored import options without modifying the database: %s',
    async (importOptionsJson) => {
      const root = mkdtempSync(join(tmpdir(), 'momocat-qa-options-'));
      try {
        const dbPath = join(root, 'cat.db');
        const db = new CATDatabase(dbPath);
        const projectId = db.createProject('QA', 'en', 'zh');
        const fileId = db.createFile(projectId, 'broken.xlsx', importOptionsJson);
        db.close();
        const before = readFileSync(dbPath);
        await expect(runQAFileCommand({ dbPath, projectId, fileId })).rejects.toThrow(
          `Invalid import options for file ${fileId}:`,
        );
        expect(readFileSync(dbPath)).toEqual(before);
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    },
  );

  it('uses saved subchecks and mounted TBs for stored and external files without writing inputs', async () => {
    const root = mkdtempSync(join(tmpdir(), 'momocat-qa-'));
    const dbPath = join(root, 'cat.db');
    const inputPath = join(root, 'input.xlsx');
    try {
      const db = new CATDatabase(dbPath);
      const projectId = db.createProject('QA', 'en', 'zh', 'translation');
      const settings = normalizeQASettings({
        enabledRuleIds: ['source-consistency', 'terminology-consistency', 'target-text'],
        disabledCheckIds: ['consecutive-spaces'],
        options: { termMarks: ['corner'] },
      });
      db.updateProjectQASettings(projectId, settings);
      const tbId = db.createTermBase('Terms', 'en', 'zh');
      db.upsertTBEntryBySrcTerm({
        id: 'term-open',
        tbId,
        srcLang: 'en',
        srcTerm: 'Open',
        tgtTerm: '打开',
      });
      db.mountTermBaseToProject(projectId, tbId, 1);
      const fileId = db.createFile(projectId, 'input.xlsx');
      const rows = [
        ['Open', '打开'],
        ['Open', '开启'],
        ['Open menu', '开启菜单'],
        ['Clean', 'two  spaces'],
        ['Save file', '存档文件'],
        ['【Open】 【Save】', '【打开】 【保存】'],
      ];
      db.bulkInsertSegments(
        rows.map(([source, target], index) => ({
          ...createTransientSegment(
            {
              id: `s${index}`,
              source,
              target,
              rowNumber: index + 2,
              metadata: { rowRef: index + 2 },
            },
            index,
          ),
          fileId,
        })),
      );
      db.close();
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(
        workbook,
        XLSX.utils.aoa_to_sheet([['Source', 'Target'], ...rows]),
        'Sheet1',
      );
      XLSX.writeFile(workbook, inputPath);
      const beforeDB = readFileSync(dbPath),
        beforeInput = readFileSync(inputPath);
      const stored = await runQAFileCommand({ dbPath, projectId, fileId });
      const external = await runQAFileCommand({ dbPath, projectId, inputPath });
      const groupShape = (report: typeof stored) =>
        report.issues.map(({ ruleId, groupLabel, row, origins }) => ({
          ruleId,
          groupLabel,
          row,
          origins,
        }));
      expect(groupShape(external)).toEqual(groupShape(stored));
      expect(
        stored.issues
          .filter((issue) => issue.ruleId === 'tb-term-missing')
          .map((issue) => issue.groupLabel),
      ).toEqual(['Open → 打开', 'Open → 打开', 'Save → 保存']);
      expect(stored.issues.find((issue) => issue.ruleId === 'tb-term-missing')?.origins).toEqual([
        'Terms',
      ]);
      expect(stored.issues.filter((issue) => issue.ruleId === 'source-consistency')).toHaveLength(
        2,
      );
      expect(stored.issues.some((issue) => issue.ruleId === 'consecutive-spaces')).toBe(false);
      const reopened = new CATDatabase(dbPath, { readonly: true, fileMustExist: true });
      expect(reopened.getTermBaseStats(tbId).entryCount).toBe(1);
      expect(reopened.getProject(projectId)?.qaSettings).toEqual(settings);
      expect(
        reopened.getSegmentsPage(fileId, 0, 100).every((segment) => !segment.qaIssues?.length),
      ).toBe(true);
      reopened.close();
      expect(readFileSync(dbPath)).toEqual(beforeDB);
      expect(readFileSync(inputPath)).toEqual(beforeInput);
      await expect(runQAFileCommand({ dbPath, projectId: projectId + 1, fileId })).rejects.toThrow(
        'Project not found',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects missing databases without creating them', async () => {
    const root = mkdtempSync(join(tmpdir(), 'momocat-qa-missing-'));
    try {
      const dbPath = join(root, 'missing.db');
      await expect(runQAFileCommand({ dbPath, projectId: 1, fileId: 1 })).rejects.toThrow();
      expect(existsSync(dbPath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
