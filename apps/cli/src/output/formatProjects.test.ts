import type { InspectProjectsResult } from '@cat/localization';
import { describe, expect, it } from 'vitest';
import { formatProjectsInspection } from './formatProjects';

describe('formatProjectsInspection', () => {
  it('formats provider nulls safely, masks keys, and sorts status counts deterministically', () => {
    const result: InspectProjectsResult = {
      dbPath: 'fixture.db',
      generatedAt: '2026-05-21T00:00:00.000Z',
      providers: [
        {
          id: 'custom:missing',
          name: 'Missing Provider',
          baseUrl: null,
          model: null,
          kind: 'custom',
          apiKeySet: true,
          apiKeyLast4: '7890',
        },
      ],
      projects: [
        {
          id: 7,
          name: 'Fixture',
          srcLang: 'en-US',
          tgtLang: 'zh-CN',
          projectType: 'translation',
          promptChars: 12,
          model: {
            id: 'custom:missing',
            name: 'Unknown custom provider',
            baseUrl: null,
            model: null,
            kind: 'custom',
            apiKeySet: true,
            apiKeyLast4: '7890',
          },
          mountedTMs: [],
          mountedTBs: [],
          files: [
            {
              id: 3,
              name: 'fixture.xlsx',
              totalSegments: 8,
              targetRows: 6,
              confirmedSegments: 1,
              statusCounts: {
                zeta: 1,
                translated: 2,
                new: 3,
                alpha: 1,
                confirmed: 1,
              },
            },
          ],
        },
      ],
    };

    const output = formatProjectsInspection(result);

    expect(output).toContain(
      'custom:missing (Missing Provider / unknown) apiKey: set last4=7890 baseUrl: not configured',
    );
    expect(output).toContain('model: custom:missing (Unknown custom provider), apiKey: set last4=7890');
    expect(output).toContain('status=new:3, translated:2, confirmed:1, alpha:1, zeta:1');
    expect(output).not.toContain('sk-test-1234567890');
    expect(output).not.toContain('null');
  });
});
