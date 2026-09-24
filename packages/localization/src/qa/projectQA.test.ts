import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import { normalizeQASettings } from '@cat/core/project';
import { parseDisplayTextToTokens } from '@cat/core/tag';
import { runProjectFileQA } from './runProjectFileQA';
import { runProjectSegmentQA } from './runProjectSegmentQA';

let db: CATDatabase;
let projectId: number;
let fileId: number;
function add(id: string, source: string, target: string, policy: 'default' | 'none' = 'default') {
  const segment: Segment = {
    segmentId: id,
    fileId,
    orderIndex: db.getSegmentsPage(fileId, 0, 100).length,
    sourceTokens: parseDisplayTextToTokens(source, { tagPolicy: policy }),
    targetTokens: parseDisplayTextToTokens(target, { tagPolicy: policy }),
    status: 'draft',
    tagsSignature: '',
    srcHash: source,
    matchKey: source,
    meta: { updatedAt: '' },
  };
  db.bulkInsertSegments([segment]);
  return segment;
}
const inputs = () => ({
  projectRepo: db,
  segmentRepo: db,
  resolveTermMatches: async () => [],
  getRevision: () => db.getQARevision(),
  transaction: <T>(work: () => T) => db.runInTransaction(work, 'immediate'),
});
beforeEach(() => {
  db = new CATDatabase(':memory:');
  projectId = db.createProject('QA', 'en', 'zh');
  fileId = db.createFile(projectId, 'protected');
});
afterEach(() => db.close());

describe('persisted QA lifecycle', () => {
  it.each(['file', 'instant'] as const)(
    'rejects corrupt import options before %s QA or writes',
    async (scope) => {
      fileId = db.createFile(projectId, 'broken.xlsx', '{broken');
      add('a', 'Count 1', 'Count 2');
      const previous = [
        { ruleId: 'number', severity: 'info' as const, message: 'Previous finding' },
      ];
      db.updateSegmentQaIssues('a', previous);
      const write = vi.spyOn(db, 'updateSegmentQaIssues');
      const resolveTermMatches = vi.fn(async () => []);
      const options = { ...inputs(), resolveTermMatches };
      await expect(
        scope === 'file'
          ? runProjectFileQA({ ...options, fileId })
          : runProjectSegmentQA({ ...options, segmentId: 'a' }),
      ).rejects.toThrow(`Invalid import options for file ${fileId}: invalid JSON.`);
      expect(resolveTermMatches).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(db.getSegment('a')!.qaIssues).toEqual(previous);
    },
  );

  it('checks tokens in document QA but skips disabled instant QA', async () => {
    add('a', '{name}{name}', '{name}');
    db.updateProjectQASettings(
      projectId,
      normalizeQASettings({ enabledRuleIds: [], instantQaOnConfirm: false }),
    );
    const file = await runProjectFileQA({ ...inputs(), fileId });
    const instant = await runProjectSegmentQA({ ...inputs(), segmentId: 'a' });
    expect(file.issues.map((issue) => issue.ruleId)).toEqual(['tag-count']);
    expect(instant).toBeNull();
    expect(db.getSegment('a')?.qaIssues?.map((issue) => issue.ruleId)).toEqual(['tag-count']);
    expect(db.listFiles(projectId)[0].segmentStatusStats.qaProblemSegments).toBe(1);
  });

  it('reports configurable Plain tags without blocking confirmation', async () => {
    fileId = db.createFile(projectId, 'plain', JSON.stringify({ tagPolicy: 'none' }));
    add('plain', '<color=red>x</color>', 'x', 'none');
    const result = await runProjectSegmentQA({ ...inputs(), segmentId: 'plain' });
    expect(result?.segment.qaIssues?.some((issue) => issue.ruleId === 'tag-missing')).toBe(true);
    db.updateProjectQASettings(
      projectId,
      normalizeQASettings({ enabledRuleIds: [], instantQaOnConfirm: false }),
    );
    expect(db.getSegment('plain')?.qaIssues).toBeUndefined();
    expect(await runProjectSegmentQA({ ...inputs(), segmentId: 'plain' })).toBeNull();
  });

  it('retains document evidence on unchanged confirmation and invalidates all rows on editing', async () => {
    add('a', '[Open]', '[打开]');
    const b = add('b', 'Open', '开启');
    await runProjectFileQA({ ...inputs(), fileId });
    const original = db.getSegment('b')!.qaIssues;
    expect(original?.some((issue) => issue.ruleId === 'tb-term-missing')).toBe(true);
    await runProjectSegmentQA({ ...inputs(), segmentId: 'b' });
    db.updateSegmentTarget('b', b.targetTokens, 'confirmed');
    expect(db.getSegment('b')!.qaIssues).toEqual(original);
    db.updateSegmentTarget('a', parseDisplayTextToTokens('[开启]'), 'draft');
    expect(db.getSegmentsPage(fileId, 0, 10).every((row) => row.qaIssues === undefined)).toBe(true);
    expect(db.listFiles(projectId)[0].segmentStatusStats.qaProblemSegments).toBe(0);
    await runProjectFileQA({ ...inputs(), fileId });
    expect(db.getSegmentsPage(fileId, 0, 10).every((row) => row.qaIssues !== undefined)).toBe(true);
  });

  it.each(['settings', 'mount', 'term', 'unmount', 'delete'] as const)(
    'invalidates persisted findings after %s changes',
    async (change) => {
      add('a', 'Count 1', 'Count 2');
      const tbId = db.createTermBase('Main', 'en', 'zh');
      db.mountTermBaseToProject(projectId, tbId);
      await runProjectFileQA({ ...inputs(), fileId });
      expect(db.getSegment('a')!.qaIssues?.length).toBeGreaterThan(0);
      if (change === 'settings')
        db.updateProjectQASettings(projectId, normalizeQASettings({ enabledRuleIds: [] }));
      if (change === 'mount') db.mountTermBaseToProject(projectId, tbId, 5);
      if (change === 'term')
        db.upsertTBEntryBySrcTerm({
          id: 'term',
          tbId,
          srcLang: 'en',
          srcTerm: 'Count',
          tgtTerm: '计数',
        });
      if (change === 'unmount') db.unmountTermBaseFromProject(projectId, tbId);
      if (change === 'delete') db.deleteTermBase(tbId);
      expect(db.getSegment('a')!.qaIssues).toBeUndefined();
      expect(db.listFiles(projectId)[0].segmentStatusStats.qaProblemSegments).toBe(0);
    },
  );

  it.each(['file', 'instant'] as const)(
    'discards %s results if a terminology mutation occurs during lookup',
    async (scope) => {
      add('a', 'Open', '开启');
      const read = vi.spyOn(db, 'getSegmentsPage');
      const options = {
        ...inputs(),
        resolveTermMatches: async () => {
          const tbId = db.createTermBase('New', 'en', 'zh');
          db.mountTermBaseToProject(projectId, tbId);
          return [];
        },
      };
      const result =
        scope === 'file'
          ? await runProjectFileQA({ ...options, fileId })
          : await runProjectSegmentQA({ ...options, segmentId: 'a' });
      expect(result?.stale).toBe(true);
      expect(db.getSegment('a')!.qaIssues).toBeUndefined();
      // File QA reads once before evaluation, then rejects the revision before rereading.
      expect(read).toHaveBeenCalledTimes(scope === 'file' ? 1 : 0);
    },
  );
});
