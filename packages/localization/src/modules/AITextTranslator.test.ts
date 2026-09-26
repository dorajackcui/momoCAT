import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { evaluateSegmentQa } from '@cat/core/qa';
import { parseDisplayTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { AITextTranslator } from './AITextTranslator';

const cases = [
  ['missing', '{name}', 'Texte'],
  ['extra', 'Text', '<b>Texte</b>'],
  ['count', '{name}{name}', '{1}'],
  ['structure', '<b><i>Text</i></b>', '{1>{2>Texte<4}<3}'],
];
const connection = { apiKey: 'test-key', baseUrl: 'https://example.test', model: 'test-model' };
const response = (content: string) => ({ content, status: 200, endpoint: '/mock' });
function row(source: string): Segment {
  return {
    segmentId: 'row',
    fileId: 1,
    orderIndex: 0,
    status: 'draft',
    sourceTokens: parseDisplayTextToTokens(source),
    targetTokens: [],
    tagsSignature: '',
    matchKey: '',
    srcHash: '',
    meta: {},
  };
}
function textParams(segment: Segment, source: string) {
  return {
    ...connection,
    sourceTokens: segment.sourceTokens,
    sourceText: source,
    sourceTagPreservedText: serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens),
    srcLang: 'en',
    tgtLang: 'fr',
  };
}
describe.each(cases)('AI output with tag %s findings', (_name, source, output) => {
  it.each(['translate', 'refine'])('returns %s output without QA retry', async (flow) => {
    const segment = row(source);
    const transport = {
      testConnection: vi.fn(),
      createResponse: vi.fn().mockResolvedValue(response(output)),
    };
    const targetTokens = await new AITextTranslator(transport).translateSegment({
      ...textParams(segment, source),
      ...(flow === 'refine'
        ? { currentTranslationPayload: 'Old', refinementInstruction: 'Improve this translation.' }
        : {}),
    });
    expect(transport.createResponse).toHaveBeenCalledOnce();
    expect(evaluateSegmentQa({ ...segment, targetTokens }).length).toBeGreaterThan(0);
  });
});
it.each(['translation', 'custom'] as const)(
  'does not retry missing tags in %s projects',
  async (projectType) => {
    const segment = row('{name}');
    const transport = {
      testConnection: vi.fn(),
      createResponse: vi.fn().mockResolvedValue(response('Texte')),
    };
    await new AITextTranslator(transport).translateSegment({
      ...textParams(segment, '{name}'),
      projectType,
    });
    expect(transport.createResponse).toHaveBeenCalledOnce();
  },
);
