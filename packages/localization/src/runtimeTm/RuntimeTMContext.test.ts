import { describe, expect, it, vi } from 'vitest';
import { createTransientSegment } from '../transientSegment';
import type { UnitResult } from '../job/types';
import { RuntimeTMContext } from './RuntimeTMContext';

describe('RuntimeTMContext', () => {
  it('summarizes runtime TM activity across seeding, commits, caps, and inspect hits', async () => {
    const runtime = RuntimeTMContext.create({
      srcLang: 'en',
      tgtLang: 'fr',
      tagPolicy: 'none',
      maxEntries: 2,
    });
    try {
      expect(runtime.summary()).toEqual({
        enabled: true,
        tagPolicy: 'none',
        seeded: 0,
        appended: 0,
        skipped: 0,
        entryCount: 0,
        inspectCalls: 0,
        hitUnits: 0,
        tmHits: 0,
        concordanceHits: 0,
        capped: false,
      });

      runtime.seedResults([
        result({ unitId: 'seed-1', source: 'Save file', target: 'Enregistrer le fichier' }),
        result({ unitId: 'seed-2', source: 'Empty target', target: '' }),
      ]);
      runtime.commitResults([
        result({ unitId: 'commit-1', source: 'Open file', target: 'Ouvrir le fichier' }),
        result({ unitId: 'commit-2', source: 'Close file', target: 'Fermer le fichier' }),
      ]);

      await runtime.inspect(createTransientSegment({ id: 'query', source: 'Save file' }, 0));

      expect(runtime.summary()).toMatchObject({
        enabled: true,
        tagPolicy: 'none',
        seeded: 1,
        appended: 1,
        skipped: 2,
        entryCount: 2,
        inspectCalls: 1,
        hitUnits: 1,
        concordanceHits: 0,
        capped: true,
      });
      expect(runtime.summary().tmHits).toBeGreaterThanOrEqual(1);
    } finally {
      runtime.dispose();
    }
  });

  it('degrades to disabled instead of throwing when an append fails', () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      let calls = 0;
      vi.spyOn(
        (runtime as unknown as { tmService: { upsertFromConfirmedSegment: () => void } })
          .tmService,
        'upsertFromConfirmedSegment',
      ).mockImplementation(() => {
        calls += 1;
        if (calls === 2) {
          throw new Error('append failed');
        }
      });

      const failing = runtime.commitResults([
        result({ unitId: 'skip-1', source: 'Empty target', target: '' }),
        result({ unitId: 'commit-1', source: 'Save file', target: 'Enregistrer le fichier' }),
        result({ unitId: 'commit-2', source: 'Open file', target: 'Ouvrir le fichier' }),
        result({ unitId: 'commit-3', source: 'Close file', target: 'Fermer le fichier' }),
      ]);

      // The failing result and everything after it are skipped, not thrown.
      expect(failing).toEqual({ appended: 1, skipped: 3, disabled: true });
      expect(runtime.summary()).toMatchObject({
        enabled: false,
        seeded: 0,
        appended: 1,
        skipped: 3,
        entryCount: 1,
        capped: false,
      });

      // A degraded runtime TM stops serving references and accepting commits.
      expect(runtime.hasEntries()).toBe(false);
      expect(
        runtime.commitResults([result({ unitId: 'late-1', source: 'Late', target: 'Tard' })]),
      ).toEqual({ appended: 0, skipped: 1, disabled: true });
    } finally {
      vi.restoreAllMocks();
      runtime.dispose();
    }
  });

  it('counts repeated sources as one entry and keeps the latest translation', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr', maxEntries: 1 });
    try {
      const first = runtime.commitResults([
        result({ unitId: 'u1', source: 'Save file', target: 'AncienneVersion' }),
      ]);
      // Same source again: an upsert into the existing entry, allowed even at
      // the cap because it does not grow the runtime TM.
      const second = runtime.commitResults([
        result({ unitId: 'u2', source: 'Save file', target: 'VersionFinale' }),
      ]);

      expect(first).toEqual({ appended: 1, skipped: 0, disabled: false });
      expect(second).toEqual({ appended: 1, skipped: 0, disabled: false });
      expect(runtime.summary()).toMatchObject({
        appended: 2,
        entryCount: 1,
        capped: false,
      });

      const artifact = await runtime.inspect(
        createTransientSegment({ id: 'query', source: 'Save file' }, 0),
      );
      expect(artifact.rawMatches).toHaveLength(1);
      expect(artifact.rawMatches[0]).toMatchObject({
        kind: 'tm',
        similarity: 100,
        targetTokens: [{ type: 'text', content: 'VersionFinale' }],
      });
    } finally {
      runtime.dispose();
    }
  });

  it('returns an empty artifact instead of throwing when a lookup fails', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      runtime.commitResults([
        result({ unitId: 'u1', source: 'Save file', target: 'Enregistrer le fichier' }),
      ]);
      vi.spyOn(
        (runtime as unknown as { tmModule: { inspect: () => Promise<unknown> } }).tmModule,
        'inspect',
      ).mockRejectedValue(new Error('lookup failed'));

      const artifact = await runtime.inspect(
        createTransientSegment({ id: 'query', source: 'Save file' }, 0),
      );

      expect(artifact.rawMatches).toEqual([]);
      expect(artifact.selectedReferences).toEqual({
        tmReferences: [],
        concordanceReferences: [],
      });
      // A single failed lookup does not disable the runtime TM.
      expect(runtime.hasEntries()).toBe(true);
    } finally {
      vi.restoreAllMocks();
      runtime.dispose();
    }
  });

  it('commits translated and skipped non-empty results into an isolated runtime TM', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr' });
    try {
      const summary = runtime.commitResults([
        result({ unitId: 'u1', source: 'Save file', target: 'Enregistrer le fichier' }),
        result({
          unitId: 'u2',
          status: 'skipped',
          source: 'Open file',
          target: 'Ouvrir le fichier',
        }),
        result({ unitId: 'u3', status: 'failed', source: 'Close file', target: '' }),
        result({ unitId: 'u4', source: 'Empty target', target: '' }),
      ]);

      expect(summary).toEqual({ appended: 2, skipped: 2, disabled: false });
      expect(runtime.hasEntries()).toBe(true);

      const artifact = await runtime.inspect(
        createTransientSegment({ id: 'query', source: 'Save file' }, 0),
      );
      expect(artifact.rawMatches[0]).toMatchObject({
        kind: 'tm',
        tmName: 'Runtime TM',
        similarity: 100,
      });
    } finally {
      runtime.dispose();
    }
  });

  it('stops appending after the configured cap without failing translation', () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr', maxEntries: 1 });
    try {
      const first = runtime.commitResults([
        result({ unitId: 'u1', source: 'One', target: 'Un' }),
      ]);
      const second = runtime.commitResults([
        result({ unitId: 'u2', source: 'Two', target: 'Deux' }),
      ]);

      expect(first).toEqual({ appended: 1, skipped: 0, disabled: false });
      expect(second).toEqual({ appended: 0, skipped: 1, disabled: true });
    } finally {
      runtime.dispose();
    }
  });

  it('commits runtime entries with the configured tag policy', async () => {
    const runtime = RuntimeTMContext.create({ srcLang: 'en', tgtLang: 'fr', tagPolicy: 'none' });
    try {
      runtime.commitResults([
        result({ unitId: 'u1', source: 'Save {1}', target: 'Enregistrer {1}' }),
      ]);

      const artifact = await runtime.inspect(
        createTransientSegment({ id: 'query', source: 'Save {1}' }, 0, {}, { tagPolicy: 'none' }),
      );

      expect(artifact.rawMatches[0]).toMatchObject({
        kind: 'tm',
        tmName: 'Runtime TM',
        similarity: 100,
        sourceTokens: [{ type: 'text', content: 'Save {1}' }],
        targetTokens: [{ type: 'text', content: 'Enregistrer {1}' }],
      });
    } finally {
      runtime.dispose();
    }
  });
});

function result(overrides: Partial<UnitResult>): UnitResult {
  return {
    jobId: 'job-1',
    documentId: 'sheet.xlsx',
    unitId: 'u1',
    sourceHash: overrides.sourceHash ?? `hash-${overrides.unitId ?? 'u1'}`,
    status: 'translated',
    source: 'Save file',
    target: 'Enregistrer le fichier',
    ...overrides,
  };
}
