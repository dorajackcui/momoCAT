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
      }),
    ).toBe(2);
  });
});
