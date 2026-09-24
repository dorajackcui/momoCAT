import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { evaluateDocumentQa } from '@cat/core/qa';
import type { ProjectRepository, SegmentRepository, SpreadsheetGateway } from '../ports';
import { ProjectFileModule } from './ProjectFileModule';

describe('file QA persistence boundary', () => {
  it.each(['default', 'none'] as const)(
    'exports %s files even when protected markers are missing',
    async (policy) => {
      const projectRepo = {
        getFile: () => ({
          id: 1,
          projectId: 1,
          name: 'input.xlsx',
          importOptionsJson: JSON.stringify({ sourceCol: 0, targetCol: 1, tagPolicy: policy }),
        }),
        getProject: () => ({ id: 1 }),
      } as unknown as ProjectRepository;
      const row = {
        segmentId: 'a',
        fileId: 1,
        sourceTokens: [{ type: 'tag', content: '{name}' }],
        targetTokens: [],
        meta: { rowRef: 2 },
      } as unknown as Segment;
      const segmentRepo = { getSegmentsPage: () => [row] } as unknown as SegmentRepository;
      const write = vi.fn();
      const filter = { export: write } as unknown as SpreadsheetGateway;
      const module = new ProjectFileModule(projectRepo, segmentRepo, filter, '/unused');
      const operation = module.exportFile(1, '/output.xlsx', {
        sourceCol: 0,
        targetCol: 1,
        hasHeader: true,
        tagPolicy: policy === 'none' ? 'default' : 'none',
      });
      await operation;
      expect(write).toHaveBeenCalledOnce();
    },
  );
  it.each(['content', 'source', 'settings', 'import-policy', 'qa-flags'] as const)(
    'validates current %s before persisting worker results',
    async (change) => {
      let rows: Segment[] = [
        {
          segmentId: 'a',
          fileId: 1,
          orderIndex: 0,
          sourceTokens: [{ type: 'text', content: 'Count 1' }],
          targetTokens: [{ type: 'text', content: 'Count 2' }],
          status: 'draft',
          tagsSignature: '',
          srcHash: 'a',
          matchKey: 'a',
          meta: { rowRef: 2, updatedAt: '' },
        },
      ];
      const settings = { enabledRuleIds: ['number'], instantQaOnConfirm: true };
      let importOptionsJson = '{}';
      if (change === 'qa-flags')
        rows[0].qaIssues = evaluateDocumentQa(rows, {
          settings: { enabledRuleIds: ['number'], instantQaOnConfirm: true },
        }).issues;
      const projectRepo = {
        getFile: () => ({ id: 1, projectId: 1, importOptionsJson }),
        getProject: () => ({ id: 1, srcLang: 'en', tgtLang: 'fr', qaSettings: settings }),
      } as unknown as ProjectRepository;
      const write = vi.fn();
      const segmentRepo = {
        getSegmentsPage: () => rows,
        updateSegmentQaIssues: write,
      } as unknown as SegmentRepository;
      const evaluator = vi.fn(async (segments, options) => {
        const report = evaluateDocumentQa(segments, options);
        if (change === 'content') rows[0].targetTokens[0].content = 'Count 1';
        else if (change === 'source') rows[0].sourceTokens[0].content = 'Count 2';
        else if (change === 'settings') settings.enabledRuleIds.length = 0;
        else if (change === 'import-policy') importOptionsJson = '{"tagPolicy":"none"}';
        else rows = [{ ...rows[0], qaIssues: [] }];
        return report;
      });
      const module = new ProjectFileModule(
        projectRepo,
        segmentRepo,
        {} as SpreadsheetGateway,
        '/unused',
        undefined,
        undefined,
        undefined,
        undefined,
        evaluator,
      );
      const report = await module.runFileQA(1, vi.fn());
      expect(report.issueCount).toBe(1);
      expect(Boolean(report.stale)).toBe(change !== 'qa-flags');
      expect(write).toHaveBeenCalledTimes(change === 'qa-flags' ? 1 : 0);
    },
  );
});
