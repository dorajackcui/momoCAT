import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';

describe('TMRepo FTS replacement', () => {
  let db: CATDatabase;

  beforeEach(() => {
    db = new CATDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
  });

  it('replaces FTS rows in batch and keeps the last replacement for duplicate entry ids', () => {
    const projectId = db.createProject('Batch FTS Project', 'en', 'fr');
    const tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
    const now = '2026-06-15T00:00:00.000Z';
    const entryId = db.upsertTMEntryBySrcHash({
      id: 'entry-hello',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-hello',
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello' }],
      targetTokens: [{ type: 'text', content: 'OldTarget' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    db.replaceTMFts(tmId, 'Hello', 'OldTarget', entryId);

    db.upsertTMEntryBySrcHash({
      id: 'entry-hello-new',
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-hello',
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: 'Hello' }],
      targetTokens: [{ type: 'text', content: 'ModernQuartz' }],
      createdAt: now,
      updatedAt: now,
      usageCount: 1,
    });
    (db as unknown as {
      replaceTMFtsBatch(rows: Array<{
        tmId: string;
        srcText: string;
        tgtText: string;
        tmEntryId: string;
      }>): void;
    }).replaceTMFtsBatch([
      { tmId, srcText: 'Hello', tgtText: 'AncientZebra', tmEntryId: entryId },
      { tmId, srcText: 'Hello', tgtText: 'ModernQuartz', tmEntryId: entryId },
    ]);

    expect(db.searchConcordance(projectId, 'AncientZebra', [tmId])).toHaveLength(0);
    const currentMatches = db.searchConcordance(projectId, 'ModernQuartz', [tmId]);
    expect(currentMatches).toHaveLength(1);
    expect(currentMatches[0].targetTokens).toEqual([
      { type: 'text', content: 'ModernQuartz' },
    ]);
  });
});
