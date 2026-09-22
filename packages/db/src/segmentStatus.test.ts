import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import type { Segment } from '@cat/core/models';
import { CATDatabase } from './index';

describe('segment status compatibility', () => {
  it('reads legacy v15 states consistently without rewriting rows, including readonly inspection', () => {
    const root = mkdtempSync(join(tmpdir(), 'momocat-status-'));
    const dbPath = join(root, 'status.db');
    const cases = [
      ['new', '', 'empty'],
      ['new', 'Imported target', 'draft'],
      ['translated', 'AI translation', 'draft'],
      ['reviewed', 'AI review', 'draft'],
      ['translated', ' \n\t\u3000', 'empty'],
      ['draft', '', 'empty'],
      ['confirmed', '', 'confirmed'],
      ['confirmed', 'Confirmed target', 'confirmed'],
    ] as const;
    try {
      const seed = new CATDatabase(dbPath);
      const projectId = seed.createProject('Status fixture', 'en', 'zh');
      const fileId = seed.createFile(projectId, 'status.xlsx');
      const emptyFileId = seed.createFile(projectId, 'empty.xlsx');
      seed.bulkInsertSegments(
        cases.map(
          ([, target], index): Segment => ({
            segmentId: `s${index}`,
            fileId,
            orderIndex: index,
            sourceTokens: [{ type: 'text', content: `Source ${index}` }],
            targetTokens: target ? [{ type: 'text', content: target }] : [],
            status: 'draft',
            tagsSignature: '',
            matchKey: `s${index}`,
            srcHash: `s${index}`,
            meta: { updatedAt: '2026-01-01T00:00:00.000Z' },
          }),
        ),
      );
      seed.close();

      const raw = new Database(dbPath);
      try {
        const write = raw.prepare('UPDATE segments SET status = ? WHERE segmentId = ?');
        cases.forEach(([status], index) => write.run(status, `s${index}`));
        const snapshot = () => raw.prepare('SELECT * FROM segments ORDER BY orderIndex').all();
        const before = snapshot();
        for (const readonly of [false, true]) {
          const db = new CATDatabase(dbPath, { readonly });
          try {
            expect(db.getSegmentsPage(fileId, 0, 20).map((row) => row.status)).toEqual(
              cases.map(([, , status]) => status),
            );
            expect(
              Object.fromEntries(
                db.getProjectStats(projectId).map((row) => [row.status, row.count]),
              ),
            ).toEqual({ empty: 3, draft: 3, confirmed: 2 });
            expect(db.getFile(fileId)?.segmentStatusStats).toMatchObject({
              totalSegments: 8,
              emptySegments: 3,
              inProgressSegments: 3,
              confirmedSegmentsForBar: 2,
              qaProblemSegments: 0,
            });
            expect(db.getFile(emptyFileId)?.segmentStatusStats?.totalSegments).toBe(0);
          } finally {
            db.close();
          }
          expect(snapshot()).toEqual(before);
        }
        const db = new CATDatabase(dbPath);
        try {
          db.updateSegmentTarget('s2', [], 'draft');
          expect(db.getSegment('s2')?.status).toBe('empty');
          expect(raw.prepare('SELECT status FROM segments WHERE segmentId = ?').get('s2')).toEqual({
            status: 'empty',
          });
        } finally {
          db.close();
        }
      } finally {
        raw.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
