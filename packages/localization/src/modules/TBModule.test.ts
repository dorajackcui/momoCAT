import type { TBMatch } from '@cat/core/models';
import { CATDatabase } from '../../../db/src';
import { describe, expect, it, vi } from 'vitest';
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTBRepository } from '../adapters/sqlite/SqliteTBRepository';
import type { TBRepository } from '../ports';
import { TBService } from '../internalServices';
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

      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0, {
        projectId,
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
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

  it('recalls English TB references for inflected, hyphenated, and dotted source terms', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('English TB Recall', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('English Client Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-real-time',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'real time',
        tgtTerm: 'temps reel',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-us',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'US',
        tgtTerm: 'Etats-Unis',
      });

      const segment = createTransientSegment(
        { id: 'unit-english-recall', source: 'Accounts use real-time U.S. settings.' },
        0,
        {
          projectId,
          sourceLanguage: 'en-US',
          targetLanguage: 'fr-FR',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).toEqual(
        expect.arrayContaining(['account', 'real time', 'US']),
      );
      expect(artifact.selectedReferences.map((reference) => reference.srcTerm)).toEqual(
        expect.arrayContaining(['account', 'real time', 'US']),
      );
    } finally {
      db.close();
    }
  });

  it('recalls stopword-prefixed English TB terms through module lookup', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('English Article Terms', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('Article Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-day-of-birth',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'The Day of Birth',
        tgtTerm: 'Premier souffle',
      });

      const segment = createTransientSegment(
        {
          id: 'unit-day-of-birth',
          source: 'Change Details: The Self Reclaimed (Backpiece) The Day of Birth (Dress)',
        },
        0,
        {
          projectId,
          sourceLanguage: 'en-US',
          targetLanguage: 'fr-FR',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).toContain('The Day of Birth');
      expect(artifact.selectedReferences).toEqual(
        expect.arrayContaining([
          {
            srcTerm: 'The Day of Birth',
            tgtTerm: 'Premier souffle',
            note: null,
          },
        ]),
      );
    } finally {
      db.close();
    }
  });

  it('prefers longer EN/general TB matches when suppressing nested terms', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('English Nested TB Profile', 'en-US', 'fr-FR');
      const shortTbId = db.createTermBase('Short Nested Terms', 'en-US', 'fr-FR');
      const longTbId = db.createTermBase('Long Nested Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, shortTbId, 10);
      db.mountTermBaseToProject(projectId, longTbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-birth',
        tbId: shortTbId,
        srcLang: 'en-US',
        srcTerm: 'Birth',
        tgtTerm: 'naissance',
      });
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-day-of-birth-nested',
        tbId: longTbId,
        srcLang: 'en-US',
        srcTerm: 'The Day of Birth',
        tgtTerm: 'Premier souffle',
      });

      const segment = createTransientSegment(
        { id: 'unit-nested-day-of-birth', source: 'The Day of Birth' },
        0,
        {
          projectId,
          sourceLanguage: 'en-US',
          targetLanguage: 'fr-FR',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);
      const rawSrcTerms = artifact.rawMatches.map((match) => match.srcTerm);

      expect(rawSrcTerms).toContain('The Day of Birth');
      expect(rawSrcTerms).not.toContain('Birth');
    } finally {
      db.close();
    }
  });

  it('applies EN/general TB recall rules to non-CJK source projects', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('French General TB Profile', 'fr-FR', 'en-US');
      const tbId = db.createTermBase('French Client Terms', 'fr-FR', 'en-US');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account-fr-source',
        tbId,
        srcLang: 'fr-FR',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const segment = createTransientSegment(
        { id: 'unit-french-general', source: 'Accounts are synced.' },
        0,
        {
          projectId,
          sourceLanguage: 'fr-FR',
          targetLanguage: 'en-US',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).toContain('account');
      expect(artifact.selectedReferences.map((reference) => reference.srcTerm)).toContain(
        'account',
      );
    } finally {
      db.close();
    }
  });

  it('keeps CJK source projects off the EN/general TB recognizer route', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('Chinese TB Guard', 'zh-CN', 'fr-FR');
      const tbId = db.createTermBase('Chinese Client Terms', 'zh-CN', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-account-zh-source',
        tbId,
        srcLang: 'zh-CN',
        srcTerm: 'account',
        tgtTerm: 'compte',
      });

      const segment = createTransientSegment(
        { id: 'unit-chinese-guard', source: 'Accounts are synced.' },
        0,
        {
          projectId,
          sourceLanguage: 'zh-CN',
          targetLanguage: 'fr-FR',
        },
      );
      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).not.toContain('account');
    } finally {
      db.close();
    }
  });

  it('does not match EN/general TB terms across protected token boundaries', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('English Boundary TB Profile', 'en-US', 'fr-FR');
      const tbId = db.createTermBase('Boundary Terms', 'en-US', 'fr-FR');
      db.mountTermBaseToProject(projectId, tbId, 20);
      db.insertTBEntryIfAbsentBySrcTerm({
        id: 'term-api-key',
        tbId,
        srcLang: 'en-US',
        srcTerm: 'API key',
        tgtTerm: 'cle API',
      });

      const segment = createTransientSegment(
        { id: 'unit-api-boundary', source: 'API key' },
        0,
        {
          projectId,
          sourceLanguage: 'en-US',
          targetLanguage: 'fr-FR',
        },
      );
      segment.sourceTokens = [
        { type: 'text', content: 'API' },
        { type: 'tag', content: '{1}', meta: { id: '{1}' } },
        { type: 'text', content: 'key' },
      ];

      const projectRepo = new SqliteProjectRepository(db);
      const tbRepo = new SqliteTBRepository(db);
      const module = new TBModule({
        tbRepo,
        tbService: new TBService(projectRepo, tbRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.rawMatches.map((match) => match.srcTerm)).not.toContain('API key');
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
