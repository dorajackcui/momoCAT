import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CATDatabase, exportCloudProject, restoreCloudProject } from '@cat/db';
import type { Segment } from '@cat/core/models';
import { TMService } from '../services/TMService';
import { TBService } from '../services/TBService';
import { SqliteProjectRepository } from '../services/adapters/SqliteProjectRepository';
import { SqliteTMRepository } from '../services/adapters/SqliteTMRepository';
import { SqliteTBRepository } from '../services/adapters/SqliteTBRepository';

describe('cloud resource roundtrip through the existing matching engine', () => {
  it.each([
    ['en', 'Open the crystal orchard gate.', 'crystal orchard'],
    ['zh', '请打开水晶果园的大门。', '水晶果园'],
    ['ja', '水晶果樹園の門を開けてください。', '水晶果樹園'],
    ['ko', '수정 과수원의 문을 열어 주세요.', '수정 과수원'],
  ])(
    'preserves TM/TB matches for the same complete %s resource corpus',
    async (language, text, term) => {
      const directory = mkdtempSync(join(tmpdir(), 'momocat-cloud-references-'));
      const sourcePath = join(directory, 'source.db');
      const targetPath = join(directory, 'target.db');
      const source = new CATDatabase(sourcePath);
      let target: CATDatabase | undefined;
      try {
        const id = source.createProject('Reference roundtrip', language, 'fr');
        const tm = source.createTM('Main', language, 'fr', 'main');
        source.mountTMToProject(id, tm);
        source.upsertTMEntry({
          id: 'tm-entry',
          projectId: id,
          tmId: tm,
          srcLang: language,
          tgtLang: 'fr',
          srcHash: 'same-source',
          matchKey: text,
          tagsSignature: '',
          sourceTokens: [{ type: 'text', content: text }],
          targetTokens: [{ type: 'text', content: 'Ouvrez la porte.' }],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
          usageCount: 1,
        });
        const tb = source.createTermBase('Terms', language, 'fr');
        source.mountTermBaseToProject(id, tb);
        source.insertTBEntryIfAbsentBySrcTerm({
          id: 'tb-entry',
          tbId: tb,
          srcLang: language,
          srcTerm: term,
          tgtTerm: 'verger',
        });
        const snapshot = exportCloudProject(sourcePath, id);
        restoreCloudProject(targetPath, snapshot.state, snapshot.resources);
        target = new CATDatabase(targetPath);
        const segment: Segment = {
          segmentId: 's1',
          fileId: 1,
          orderIndex: 0,
          sourceTokens: [{ type: 'text', content: text }],
          targetTokens: [],
          status: 'empty',
          srcHash: 'same-source',
          matchKey: text,
          tagsSignature: '',
          meta: { updatedAt: '2026-01-01' },
        };
        const matches = async (db: CATDatabase) => {
          const projects = new SqliteProjectRepository(db);
          return {
            tm: await new TMService(projects, new SqliteTMRepository(db)).findMatches(id, segment),
            tb: await new TBService(projects, new SqliteTBRepository(db)).findMatches(id, segment),
          };
        };
        const baseline = await matches(source);
        const restored = await matches(target);
        expect(baseline.tm.length).toBeGreaterThan(0);
        expect(baseline.tb.length).toBeGreaterThan(0);
        expect(restored).toEqual(baseline);
      } finally {
        target?.close();
        source.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
