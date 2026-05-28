import { describe, expect, it } from 'vitest';
import { resolveDefaultContextColumn } from '../../../shared/importColumnDefaults';

describe('resolveDefaultContextColumn', () => {
  it('uses the context header as the default context column for translation imports', () => {
    expect(
      resolveDefaultContextColumn({
        hasHeader: true,
        previewData: [
          ['source', 'target', 'context'],
          ['Hello', '', 'menu label'],
        ],
        projectType: 'translation',
        sourceCol: 0,
      }),
    ).toBe(2);
  });

  it('keeps review imports on source fallback when no context header exists', () => {
    expect(
      resolveDefaultContextColumn({
        hasHeader: true,
        previewData: [
          ['translation', 'review output'],
          ['Existing translation', ''],
        ],
        projectType: 'review',
        sourceCol: 1,
      }),
    ).toBe(1);
  });

  it('prefers a context header over the review source fallback', () => {
    expect(
      resolveDefaultContextColumn({
        hasHeader: true,
        previewData: [
          ['translation', 'review output', 'context'],
          ['Existing translation', '', 'Original source'],
        ],
        projectType: 'review',
        sourceCol: 0,
      }),
    ).toBe(2);
  });
});
