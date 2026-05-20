import { readFile } from 'fs/promises';
import { describe, expect, it } from 'vitest';
import { computeSrcHash, serializeTokensToDisplayText } from '@cat/core/text';
import { createTransientSegment, toTransientSegmentId } from './transientSegment';

describe('createTransientSegment', () => {
  it('tokenizes source text into source tokens', () => {
    const segment = createTransientSegment(
      {
        id: 'row-2',
        source: '浣犲ソ <bpt id="1"/>world<ept id="1"/>',
        target: '',
      },
      7,
    );

    expect(segment.segmentId).toBe(toTransientSegmentId('row-2'));
    expect(segment.fileId).toBe(0);
    expect(segment.orderIndex).toBe(7);
    expect(serializeTokensToDisplayText(segment.sourceTokens)).toBe(
      '浣犲ソ <bpt id="1"/>world<ept id="1"/>',
    );
    expect(segment.sourceTokens.some((token) => token.type === 'tag')).toBe(true);
    expect(segment.targetTokens).toEqual([]);
    expect(segment.status).toBe('new');
  });

  it('computes a stable source hash from source text and tags', () => {
    const first = createTransientSegment(
      { id: 'first', source: 'Hello <bpt id="1"/>world<ept id="1"/>' },
      0,
    );
    const second = createTransientSegment(
      { id: 'second', source: 'Hello <bpt id="1"/>world<ept id="1"/>' },
      1,
    );

    expect(first.matchKey).toBe(second.matchKey);
    expect(first.tagsSignature).toBe(second.tagsSignature);
    expect(first.srcHash).toBe(second.srcHash);
    expect(first.srcHash).toBe(computeSrcHash(first.matchKey, first.tagsSignature));
  });

  it('preserves project, file, row, language, and custom metadata', () => {
    const segment = createTransientSegment(
      {
        id: 'row-3',
        source: 'Hello',
        target: 'Bonjour',
        sourceLanguage: 'en-US',
        targetLanguage: 'fr-FR',
        context: 'speaker: Nikki',
        fileName: 'dialogue.xlsx',
        rowNumber: 3,
        metadata: { sheetName: 'Sheet2' },
      },
      8,
      { projectId: 42 },
    );

    expect(segment.status).toBe('translated');
    expect(serializeTokensToDisplayText(segment.targetTokens)).toBe('Bonjour');
    expect(segment.meta).toMatchObject({
      externalUnitId: 'row-3',
      projectId: 42,
      sourceLanguage: 'en-US',
      targetLanguage: 'fr-FR',
      context: 'speaker: Nikki',
      fileName: 'dialogue.xlsx',
      rowNumber: 3,
      sheetName: 'Sheet2',
    });
  });

  it('has no database dependency or insert side effects', async () => {
    const source = await readFile(new URL('./transientSegment.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('@cat/db');
    expect(source).not.toContain('CATDatabase');
    expect(source).not.toContain('insert');

    const segment = createTransientSegment({ id: 'row-4', source: 'No writes' }, 0);
    expect(segment.fileId).toBe(0);
    expect(segment.segmentId.startsWith('transient:')).toBe(true);
  });
});
