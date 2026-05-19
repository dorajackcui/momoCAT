import type { Segment, TMEntry } from '@cat/core/models';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { CATDatabase } from '../../../../../../packages/db/src';
import { describe, expect, it, vi } from 'vitest';
import { SqliteProjectRepository } from '../../services/adapters/SqliteProjectRepository';
import { SqliteTMRepository } from '../../services/adapters/SqliteTMRepository';
import type { TMRepository } from '../../services/ports';
import { TMService, type TMMatch } from '../../services/TMService';
import { createTransientSegment } from '../transientSegment';
import {
  MAX_CONCORDANCE_PROMPT_REFERENCES,
  MAX_ENGINE_TM_REFERENCES,
  MAX_TM_PROMPT_REFERENCES,
  TMModule,
  mapTMEngineReferences,
} from './TMModule';

describe('TMModule', () => {
  it('inspects mounted TMs, raw matches, selected TM references, and policy limits', async () => {
    const db = new CATDatabase(':memory:');
    try {
      const projectId = db.createProject('TM Inspect', 'en', 'fr');
      const tmId = db.createTM('Client Main TM', 'en', 'fr', 'main');
      db.mountTMToProject(projectId, tmId, 10, 'read');

      const segment = createTransientSegment({ id: 'unit-1', source: 'Hello world' }, 0, {
        projectId,
        sourceLanguage: 'en',
        targetLanguage: 'fr',
      });
      const entry = createTMEntry({
        id: 'tm-entry-1',
        tmId,
        projectId,
        segment,
        targetText: 'Bonjour le monde',
      });
      const entryId = db.upsertTMEntryBySrcHash(entry);
      db.replaceTMFts(
        tmId,
        serializeTokensToDisplayText(entry.sourceTokens),
        serializeTokensToDisplayText(entry.targetTokens),
        entryId,
      );

      const projectRepo = new SqliteProjectRepository(db);
      const tmRepo = new SqliteTMRepository(db);
      const module = new TMModule({
        tmRepo,
        tmService: new TMService(projectRepo, tmRepo),
      });

      const artifact = await module.inspect(projectId, segment);

      expect(artifact.mountedTMs).toContainEqual(
        expect.objectContaining({
          id: tmId,
          name: 'Client Main TM',
          srcLang: 'en',
          tgtLang: 'fr',
          type: 'main',
          priority: 10,
          permission: 'read',
          isEnabled: true,
        }),
      );
      expect(artifact.rawMatches).toHaveLength(1);
      expect(artifact.rawMatches[0]).toMatchObject({
        kind: 'tm',
        tmName: 'Client Main TM',
        similarity: 100,
      });
      expect(artifact.selectedReferences.tmReferences).toEqual([
        {
          similarity: 100,
          tmName: 'Client Main TM',
          sourceText: 'Hello world',
          targetText: 'Bonjour le monde',
        },
      ]);
      expect(artifact.selectionPolicy).toEqual({
        maxTmReferences: MAX_TM_PROMPT_REFERENCES,
        maxConcordanceReferences: MAX_CONCORDANCE_PROMPT_REFERENCES,
      });
      expect(artifact.diagnostics).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('selects concordance references from service matches', async () => {
    const segment = createTransientSegment({ id: 'unit-2', source: 'short source' }, 0);
    const match = createTMMatch({
      kind: 'concordance',
      id: 'concordance-1',
      matchedSourceText: 'short',
      sourceText: 'short source with context',
      targetText: 'source courte avec contexte',
    });
    const tmRepo = {
      getProjectMountedTMs: vi.fn().mockReturnValue([
        {
          id: 'tm-1',
          name: 'Stub TM',
          srcLang: 'en',
          tgtLang: 'fr',
          type: 'main',
          priority: 1,
          permission: 'read',
          isEnabled: 1,
          createdAt: '',
          updatedAt: '',
        },
      ]),
    } as Pick<TMRepository, 'getProjectMountedTMs'>;
    const tmService = {
      findMatches: vi.fn().mockResolvedValue([match]),
    } as Pick<TMService, 'findMatches'>;

    const artifact = await new TMModule(tmRepo, tmService).inspect(7, segment);

    expect(artifact.rawMatches[0]).toBe(match);
    expect(artifact.selectedReferences.concordanceReferences).toEqual([
      {
        tmName: 'Stub TM',
        matchedSourceText: 'short',
        sourceText: 'short source with context',
        targetText: 'source courte avec contexte',
      },
    ]);
    expect(artifact.selectedReferences.tmReferences).toEqual([]);
  });

  it('caps selected TM and concordance references at 3 each', async () => {
    const segment = createTransientSegment({ id: 'unit-cap', source: 'source' }, 0);
    const matches: TMMatch[] = [
      ...Array.from({ length: 5 }, (_, index) =>
        createTMMatch({
          kind: 'tm',
          id: `tm-${index}`,
          sourceText: `source ${index}`,
          targetText: `target ${index}`,
          similarity: 100 - index,
        }),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        createTMMatch({
          kind: 'concordance',
          id: `concordance-${index}`,
          matchedSourceText: `matched ${index}`,
          sourceText: `concordance source ${index}`,
          targetText: `concordance target ${index}`,
        }),
      ),
    ];
    const module = new TMModule(
      { getProjectMountedTMs: vi.fn().mockReturnValue([]) },
      { findMatches: vi.fn().mockResolvedValue(matches) },
    );

    const artifact = await module.inspect(1, segment);

    expect(artifact.rawMatches).toBe(matches);
    expect(artifact.selectedReferences.tmReferences).toHaveLength(MAX_TM_PROMPT_REFERENCES);
    expect(artifact.selectedReferences.concordanceReferences).toHaveLength(
      MAX_CONCORDANCE_PROMPT_REFERENCES,
    );
    expect(
      artifact.selectedReferences.tmReferences.map((reference) => reference.sourceText),
    ).toEqual(['source 0', 'source 1', 'source 2']);
    expect(
      artifact.selectedReferences.concordanceReferences.map(
        (reference) => reference.matchedSourceText,
      ),
    ).toEqual(['matched 0', 'matched 1', 'matched 2']);
  });

  it('maps TM and concordance matches to capped engine references', () => {
    const tmMatch = createTMMatch({
      kind: 'tm',
      id: 'tm-engine',
      sourceText: 'Hello',
      targetText: 'Bonjour',
      similarity: 98,
    });
    const concordanceMatch = createTMMatch({
      kind: 'concordance',
      id: 'concordance-engine',
      matchedSourceText: 'world',
      sourceText: 'Hello world',
      targetText: 'Bonjour le monde',
    });
    const extraMatches = Array.from({ length: MAX_ENGINE_TM_REFERENCES }, (_, index) =>
      createTMMatch({
        kind: 'tm',
        id: `extra-${index}`,
        sourceText: `extra source ${index}`,
        targetText: `extra target ${index}`,
        similarity: 80,
      }),
    );

    const references = mapTMEngineReferences([tmMatch, concordanceMatch, ...extraMatches]);

    expect(references).toHaveLength(MAX_ENGINE_TM_REFERENCES);
    expect(references[0]).toEqual({
      kind: 'tm',
      rank: 98,
      similarity: 98,
      tmName: 'Stub TM',
      sourceText: 'Hello',
      targetText: 'Bonjour',
    });
    expect(references[1]).toEqual({
      kind: 'concordance',
      rank: 90,
      tmName: 'Stub TM',
      sourceText: 'Hello world',
      targetText: 'Bonjour le monde',
      matchedSourceText: 'world',
    });
  });

  it('does not include prompt text fields', async () => {
    const segment = createTransientSegment({ id: 'unit-3', source: 'Hello' }, 0);
    const module = new TMModule(
      { getProjectMountedTMs: vi.fn().mockReturnValue([]) },
      { findMatches: vi.fn().mockResolvedValue([]) },
    );

    const artifact = await module.inspect(1, segment);

    expect(artifact).not.toHaveProperty('tmPromptBlock');
    expect(artifact).not.toHaveProperty('promptText');
  });
});

function createTMEntry(params: {
  id: string;
  tmId: string;
  projectId: number;
  segment: Segment;
  targetText: string;
}): TMEntry & { tmId: string } {
  const now = new Date().toISOString();
  return {
    id: params.id,
    tmId: params.tmId,
    projectId: params.projectId,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: params.segment.srcHash,
    matchKey: params.segment.matchKey,
    tagsSignature: params.segment.tagsSignature,
    sourceTokens: params.segment.sourceTokens,
    targetTokens: [{ type: 'text', content: params.targetText }],
    originSegmentId: params.segment.segmentId,
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
  };
}

function createTMMatch(
  params:
    | {
        kind: 'tm';
        id: string;
        sourceText: string;
        targetText: string;
        similarity: number;
      }
    | {
        kind: 'concordance';
        id: string;
        sourceText: string;
        targetText: string;
        matchedSourceText: string;
      },
): TMMatch {
  const now = new Date().toISOString();
  const base = {
    id: params.id,
    projectId: 1,
    srcLang: 'en',
    tgtLang: 'fr',
    srcHash: `${params.id}-hash`,
    matchKey: params.sourceText.toLowerCase(),
    tagsSignature: '',
    sourceTokens: [{ type: 'text' as const, content: params.sourceText }],
    targetTokens: [{ type: 'text' as const, content: params.targetText }],
    createdAt: now,
    updatedAt: now,
    usageCount: 1,
    rank: params.kind === 'tm' ? params.similarity : 90,
    tmName: 'Stub TM',
    tmType: 'main' as const,
  };

  if (params.kind === 'tm') {
    return {
      ...base,
      kind: 'tm',
      similarity: params.similarity,
    };
  }

  return {
    ...base,
    kind: 'concordance',
    matchedSourceText: params.matchedSourceText,
    sourceCoverage: 50,
    entryCoverage: 100,
  };
}
