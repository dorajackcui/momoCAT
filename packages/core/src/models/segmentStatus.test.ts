import { describe, expect, it } from 'vitest';
import { normalizeSegmentStatus, type Token } from './index';

describe('segment workflow status', () => {
  it.each(['empty', 'draft', 'new', 'translated', 'reviewed', undefined, 'invalid'])(
    'derives unconfirmed status from target content for %s',
    (status) => {
      expect(normalizeSegmentStatus(status, [])).toBe('empty');
      expect(normalizeSegmentStatus(status, [{ type: 'text', content: ' \n\t\u3000' }])).toBe(
        'empty',
      );
      expect(normalizeSegmentStatus(status, [{ type: 'text', content: 'Translation' }])).toBe(
        'draft',
      );
      expect(normalizeSegmentStatus(status, [{ type: 'tag', content: '<br/>' }])).toBe('draft');
    },
  );

  it.each<[Token[]]>([[[]], [[{ type: 'text', content: 'Translation' }]]])(
    'retains explicit confirmation independently of translation origin',
    (targetTokens) => {
      expect(normalizeSegmentStatus('confirmed', targetTokens)).toBe('confirmed');
    },
  );
});
