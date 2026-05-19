import type { TBMatch } from '@cat/core/models';
import { CATDatabase } from '../../../../../../packages/db/src';
import { describe, expect, it, vi } from 'vitest';
import { SqliteProjectRepository } from '../../services/adapters/SqliteProjectRepository';
import { SqliteTBRepository } from '../../services/adapters/SqliteTBRepository';
import type { TBRepository } from '../../services/ports';
import { TBService } from '../../services/TBService';
import { createTransientSegment } from '../transientSegment';
import {
  MAX_ENGINE_TB_REFERENCES,
  MAX_TB_PROMPT_REFERENCES,
  TBModule,
  mapTBEngineReferences,
} from './TBModule';

describe('TBModule', () => {
  it('inspects mounted TBs, raw matches, selected TB references, and policy limits', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('TB Inspect', 'en', 'fr');
      const tbId = db.createTermBase('Client Terms', 'en', 'fr');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-world',
        tbId,
        srcLang: 'en',
        srcTerm: 'world',
        tgtTerm: 'monde',
        note: 'Use the common noun.',
      });

      const segment = createTransientSegment(
        { id: 'unit-1', source: 'Hello world' },
        0,
        { projectId, sourceLanguage: 'en', targetLanguage: 'fr' },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.mountedTBs).toEqual([
        expect.objectContaining({
          id: tbId,
          name: 'Client Terms',
          srcLang: 'en',
          tgtLang: 'fr',
          priority: 20,
          isEnabled: true,
        }),
      ]);
      expect(artifact.rawMatches).toHaveLength(1);
      expect(artifact.rawMatches[0]).toMatchObject({
        tbName: 'Client Terms',
        srcTerm: 'world',
        tgtTerm: 'monde',
        note: 'Use the common noun.',
      });
      expect(artifact.selectedReferences).toEqual([
        {
          srcTerm: 'world',
          tgtTerm: 'monde',
          note: 'Use the common noun.',
        },
      ]);
      expect(artifact.selectionPolicy).toEqual({
        maxTbReferences: MAX_TB_PROMPT_REFERENCES,
      });
      expect(artifact.diagnostics).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('caps selected references at 100', async () => {
    const segment = createTransientSegment({ id: 'unit-2', source: 'source' }, 0);
    const matches = Array.from({ length: 105 }, (_, index) => createTBMatch(index));
    const tbRepo = {
      getProjectMountedTermBases: vi.fn().mockReturnValue([]),
    } as Pick<TBRepository, 'getProjectMountedTermBases'>;
    const tbService = {
      findMatches: vi.fn().mockResolvedValue(matches),
    } as Pick<TBService, 'findMatches'>;

    const artifact = await new TBModule(tbRepo, tbService).inspect(1, segment);

    expect(artifact.rawMatches).toBe(matches);
    expect(artifact.selectedReferences).toHaveLength(100);
    expect(artifact.selectedReferences[0]).toEqual({
      srcTerm: 'term-0',
      tgtTerm: 'terme-0',
      note: null,
    });
    expect(artifact.selectedReferences[99]).toEqual({
      srcTerm: 'term-99',
      tgtTerm: 'terme-99',
      note: null,
    });
  });

  it('maps TB matches to capped engine references', () => {
    const matches = Array.from({ length: MAX_ENGINE_TB_REFERENCES + 5 }, (_, index) =>
      createTBMatch(index),
    );

    const references = mapTBEngineReferences(matches);

    expect(references).toHaveLength(MAX_ENGINE_TB_REFERENCES);
    expect(references[0]).toEqual({
      tbName: 'Stub TB',
      srcTerm: 'term-0',
      tgtTerm: 'terme-0',
      note: null,
    });
    expect(references[MAX_ENGINE_TB_REFERENCES - 1]).toEqual({
      tbName: 'Stub TB',
      srcTerm: `term-${MAX_ENGINE_TB_REFERENCES - 1}`,
      tgtTerm: `terme-${MAX_ENGINE_TB_REFERENCES - 1}`,
      note: null,
    });
  });

  it('does not include prompt text fields', async () => {
    const segment = createTransientSegment({ id: 'unit-3', source: 'Hello' }, 0);
    const module = new TBModule(
      { getProjectMountedTermBases: vi.fn().mockReturnValue([]) },
      { findMatches: vi.fn().mockResolvedValue([]) },
    );

    const artifact = await module.inspect(1, segment);

    expect(artifact).not.toHaveProperty('tbPromptBlock');
    expect(artifact).not.toHaveProperty('promptText');
  });
});

function createTBMatch(index: number): TBMatch {
  const now = new Date().toISOString();
  return {
    id: `tb-match-${index}`,
    tbId: 'tb-1',
    srcTerm: `term-${index}`,
    tgtTerm: `terme-${index}`,
    srcNorm: `term-${index}`,
    note: null,
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
    tbName: 'Stub TB',
    priority: 1,
    positions: [{ start: index, end: index + 1 }],
  };
}
