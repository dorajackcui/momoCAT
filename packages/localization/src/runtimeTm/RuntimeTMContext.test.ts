import { describe, expect, it } from 'vitest';
import { createTransientSegment } from '../transientSegment';
import type { UnitResult } from '../job/types';
import { RuntimeTMContext } from './RuntimeTMContext';

describe('RuntimeTMContext', () => {
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
