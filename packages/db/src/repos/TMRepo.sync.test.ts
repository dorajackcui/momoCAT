import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CATDatabase } from '../index';
import type { TMSyncStagedRow } from '../types';

const RUN_ID = 'run-1';

function stagedRow(src: string, tgt: string): TMSyncStagedRow {
  return {
    srcHash: `hash-${src}`,
    matchKey: src.toLowerCase(),
    tagsSignature: '',
    sourceTokensJson: JSON.stringify([{ type: 'text', content: src }]),
    targetTokensJson: JSON.stringify([{ type: 'text', content: tgt }]),
    srcText: src,
    tgtText: tgt,
  };
}

describe('TMRepo external file sync primitives', () => {
  let db: CATDatabase;
  let projectId: number;
  let tmId: string;

  beforeEach(() => {
    db = new CATDatabase(':memory:');
    projectId = db.createProject('Sync Project', 'en', 'fr');
    tmId = db.createTM('Main TM', 'en', 'fr', 'main');
    db.mountTMToProject(projectId, tmId, 10, 'read');
  });

  afterEach(() => {
    db.close();
  });

  function seedEntry(src: string, tgt: string, usageCount = 1): string {
    const entryId = db.upsertTMEntryBySrcHash({
      id: `entry-${src}`,
      tmId,
      projectId: 0,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: `hash-${src}`,
      matchKey: src.toLowerCase(),
      tagsSignature: '',
      sourceTokens: [{ type: 'text', content: src }],
      targetTokens: [{ type: 'text', content: tgt }],
      createdAt: '2026-06-15T00:00:00.000Z',
      updatedAt: '2026-06-15T00:00:00.000Z',
      usageCount,
    });
    db.replaceTMFts(tmId, src, tgt, entryId);
    return entryId;
  }

  it('stages rows with last-wins dedupe on srcHash', () => {
    db.runInTransaction(() => {
      db.stageTMSyncRows(RUN_ID, tmId, [
        stagedRow('Hello', 'AncienneVersion'),
        stagedRow('World', 'Monde'),
        stagedRow('Hello', 'VersionFinale'),
      ]);
    });

    expect(db.countTMSyncStagedRows(RUN_ID)).toBe(2);

    const diff = db.getTMSyncDiffSummary(RUN_ID, tmId);
    expect(diff.added).toBe(2);

    const newRows = db.listTMSyncNewRows(RUN_ID, tmId, '', 10);
    const hello = newRows.find((row) => row.srcHash === 'hash-Hello');
    expect(hello?.tgtText).toBe('VersionFinale');
  });

  it('classifies new, changed, deleted and counts overwritten local edits', () => {
    seedEntry('Unchanged', 'Inchange');
    seedEntry('Changed', 'AncienneTraduction');
    seedEntry('Removed', 'Supprime');

    db.runInTransaction(() => {
      db.stageTMSyncRows(RUN_ID, tmId, [
        stagedRow('Unchanged', 'Inchange'),
        stagedRow('Changed', 'NouvelleTraduction'),
        stagedRow('Added', 'Ajoute'),
      ]);
    });

    const diff = db.getTMSyncDiffSummary(RUN_ID, tmId);
    expect(diff).toMatchObject({ added: 1, changed: 1, deleted: 1 });
    expect(diff.overwrittenLocalEdits).toBe(0);
    expect(diff.deletedLocalEdits).toBe(0);

    // The seeded entries were written after this lastSyncedAt, so both the
    // pending overwrite and the pending prune delete count as local edits.
    const withBaseline = db.getTMSyncDiffSummary(RUN_ID, tmId, '2020-01-01T00:00:00.000Z');
    expect(withBaseline.overwrittenLocalEdits).toBe(1);
    expect(withBaseline.deletedLocalEdits).toBe(1);
    expect(
      db.listTMSyncChangedRows(RUN_ID, tmId, '', 10, '2020-01-01T00:00:00.000Z'),
    ).toMatchObject([{ entryId: 'entry-Changed', localEdit: 1 }]);
    expect(db.listTMSyncDeletedEntries(RUN_ID, tmId, '', 10, '2020-01-01T00:00:00.000Z')).toEqual([
      { id: 'entry-Removed', localEdit: 1 },
    ]);

    // With a baseline after the entries' updatedAt, nothing counts as a local edit.
    const afterSeed = db.getTMSyncDiffSummary(RUN_ID, tmId, '2100-01-01T00:00:00.000Z');
    expect(afterSeed.overwrittenLocalEdits).toBe(0);
    expect(afterSeed.deletedLocalEdits).toBe(0);
    expect(
      db.listTMSyncChangedRows(RUN_ID, tmId, '', 10, '2100-01-01T00:00:00.000Z')[0],
    ).toMatchObject({ localEdit: 0 });
    expect(
      db.listTMSyncDeletedEntries(RUN_ID, tmId, '', 10, '2100-01-01T00:00:00.000Z')[0],
    ).toMatchObject({ localEdit: 0 });
  });

  it('applyTMSyncInserts writes entry + FTS pairs and skips conflicts idempotently', () => {
    db.runInTransaction(() => {
      db.stageTMSyncRows(RUN_ID, tmId, [stagedRow('Fresh', 'ModernQuartz')]);
    });
    const rows = db.listTMSyncNewRows(RUN_ID, tmId, '', 10);

    const inserted = db.runInTransaction(() =>
      db.applyTMSyncInserts(
        tmId,
        rows.map((row, index) => ({ ...row, id: `sync-${index}` })),
      ),
    );
    expect(inserted).toBe(1);

    const entry = db.findTMEntryByHash(tmId, 'hash-Fresh');
    expect(entry?.usageCount).toBe(0);
    expect(db.searchConcordance(projectId, 'ModernQuartz', [tmId])).toHaveLength(1);

    // Re-applying the same page (e.g. after a resumed run) inserts nothing and
    // leaves a single FTS row.
    const reInserted = db.runInTransaction(() =>
      db.applyTMSyncInserts(
        tmId,
        rows.map((row, index) => ({ ...row, id: `sync-retry-${index}` })),
      ),
    );
    expect(reInserted).toBe(0);
    expect(db.searchConcordance(projectId, 'ModernQuartz', [tmId])).toHaveLength(1);
  });

  it('applyTMSyncUpdates changes the target but preserves usage metadata', () => {
    const entryId = seedEntry('Stable', 'AncientZebra', 5);
    const before = db.findTMEntryByHash(tmId, 'hash-Stable');

    const updated = db.runInTransaction(() =>
      db.applyTMSyncUpdates(tmId, [
        {
          entryId,
          sourceTokensJson: JSON.stringify([{ type: 'text', content: 'Stable' }]),
          targetTokensJson: JSON.stringify([{ type: 'text', content: 'ModernQuartz' }]),
          srcText: 'Stable',
          tgtText: 'ModernQuartz',
        },
      ]),
    );
    expect(updated).toBe(1);

    const after = db.findTMEntryByHash(tmId, 'hash-Stable');
    expect(after?.targetTokens).toEqual([{ type: 'text', content: 'ModernQuartz' }]);
    expect(after?.usageCount).toBe(5);
    expect(after?.createdAt).toBe(before?.createdAt);

    expect(db.searchConcordance(projectId, 'AncientZebra', [tmId])).toHaveLength(0);
    expect(db.searchConcordance(projectId, 'ModernQuartz', [tmId])).toHaveLength(1);
  });

  it('flags source-display-only changes (same srcHash) and refreshes source tokens + FTS', () => {
    // Seeded with lowercase display; the file now carries 'STABLE PHRASE' —
    // matchKey normalization keeps srcHash identical, only the display differs.
    const entryId = seedEntry('stable phrase', 'CalmMeadow', 3);

    const fileRow: TMSyncStagedRow = {
      ...stagedRow('stable phrase', 'CalmMeadow'),
      sourceTokensJson: JSON.stringify([{ type: 'text', content: 'STABLE PHRASE' }]),
      srcText: 'STABLE PHRASE',
    };
    db.runInTransaction(() => {
      db.stageTMSyncRows(RUN_ID, tmId, [fileRow]);
    });

    const diff = db.getTMSyncDiffSummary(RUN_ID, tmId);
    expect(diff.changed).toBe(1);

    const changedRows = db.listTMSyncChangedRows(RUN_ID, tmId, '', 10);
    expect(changedRows).toHaveLength(1);

    const updated = db.runInTransaction(() =>
      db.applyTMSyncUpdates(tmId, [
        {
          entryId,
          sourceTokensJson: fileRow.sourceTokensJson,
          targetTokensJson: fileRow.targetTokensJson,
          srcText: fileRow.srcText,
          tgtText: fileRow.tgtText,
        },
      ]),
    );
    expect(updated).toBe(1);

    const after = db.findTMEntryByHash(tmId, 'hash-stable phrase');
    expect(after?.sourceTokens).toEqual([{ type: 'text', content: 'STABLE PHRASE' }]);
    expect(after?.usageCount).toBe(3);
    // The FTS source text follows the file's display form.
    const matches = db.searchConcordance(projectId, 'CalmMeadow', [tmId]);
    expect(matches).toHaveLength(1);
  });

  it('deleteTMEntriesWithFts removes the entry together with its FTS row', () => {
    const entryId = seedEntry('Doomed', 'VanishingGlacier');

    const deleted = db.runInTransaction(() => db.deleteTMEntriesWithFts([entryId]));
    expect(deleted).toBe(1);
    expect(db.findTMEntryByHash(tmId, 'hash-Doomed')).toBeUndefined();
    expect(db.searchConcordance(projectId, 'VanishingGlacier', [tmId])).toHaveLength(0);
  });

  it('pages diff sets with a keyset cursor that stays stable across applies', () => {
    db.runInTransaction(() => {
      db.stageTMSyncRows(
        RUN_ID,
        tmId,
        ['A', 'B', 'C', 'D', 'E'].map((src) => stagedRow(src, `tgt-${src}`)),
      );
    });

    let cursor = '';
    let total = 0;
    for (;;) {
      const page = db.listTMSyncNewRows(RUN_ID, tmId, cursor, 2);
      if (page.length === 0) break;
      cursor = page[page.length - 1].srcHash;
      total += db.runInTransaction(() =>
        db.applyTMSyncInserts(
          tmId,
          page.map((row) => ({ ...row, id: `sync-${row.srcHash}` })),
        ),
      );
    }

    expect(total).toBe(5);
    expect(db.listTMSyncNewRows(RUN_ID, tmId, '', 10)).toHaveLength(0);
    expect(db.getTMStats(tmId).entryCount).toBe(5);
  });

  it('clearTMSyncStagingForTM scopes cleanup to one TM and can except the live run', () => {
    const otherTmId = db.createTM('Other TM', 'en', 'fr', 'main');
    db.runInTransaction(() => {
      db.stageTMSyncRows('run-old', tmId, [stagedRow('Old', 'Vieux')]);
      db.stageTMSyncRows(RUN_ID, tmId, [stagedRow('New', 'Nouveau')]);
      db.stageTMSyncRows('run-other', otherTmId, [stagedRow('Other', 'Autre')]);
    });

    // Clearing this TM's stale runs must not touch a concurrent sync of
    // another TM.
    db.clearTMSyncStagingForTM(tmId, RUN_ID);
    expect(db.countTMSyncStagedRows('run-old')).toBe(0);
    expect(db.countTMSyncStagedRows(RUN_ID)).toBe(1);
    expect(db.countTMSyncStagedRows('run-other')).toBe(1);

    db.clearTMSyncStagingRun(RUN_ID);
    expect(db.countTMSyncStagedRows(RUN_ID)).toBe(0);

    db.clearTMSyncStagingForTM(otherTmId);
    expect(db.countTMSyncStagedRows('run-other')).toBe(0);
  });
});
