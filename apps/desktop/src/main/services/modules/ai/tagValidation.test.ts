import { describe, expect, it, vi } from 'vitest';
import type { AITransport } from '../../ports';
import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { evaluateSegmentQa } from '@cat/core/qa';
import { parseDisplayTextToTokens, serializeTokensToEditorText } from '@cat/core/tag';
import { AITextTranslator } from './AITextTranslator';
import { translateDialogueUnit } from './dialogueTranslation';

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
function dialogueParams(segment: Segment, transport: AITransport) {
  return {
    ...connection,
    projectId: 1,
    project: {
      id: 1,
      uuid: 'project',
      name: 'Test',
      srcLang: 'en',
      tgtLang: 'fr',
      createdAt: '',
      updatedAt: '',
    } as Project,
    runtimeConfig: { reasoningEffort: 'medium' as const },
    unit: {
      speaker: 'Speaker',
      speakerKey: 'speaker',
      charCount: 10,
      segments: [
        {
          segment,
          speaker: 'Speaker',
          speakerKey: 'speaker',
          sourceText: 'Text',
          sourcePayload: serializeTokensToEditorText(segment.sourceTokens, segment.sourceTokens),
        },
      ],
    },
    transport,
    tagPolicy: 'default' as const,
    resolveTranslationPromptReferences: async () => ({}),
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
  it('returns the dialogue unit without retrying QA findings', async () => {
    const segment = row(source);
    const transport = {
      testConnection: vi.fn(),
      createResponse: vi
        .fn()
        .mockResolvedValue(
          response(JSON.stringify({ translations: [{ id: 'row', text: output }] })),
        ),
    };
    const result = await translateDialogueUnit(dialogueParams(segment, transport));
    expect(transport.createResponse).toHaveBeenCalledOnce();
    expect(
      evaluateSegmentQa({ ...segment, targetTokens: result.updates[0].targetTokens }).length,
    ).toBeGreaterThan(0);
  });
});
it.each(['translation', 'review', 'custom'] as const)(
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
it('retains dialogue retries for malformed response JSON', async () => {
  const segment = row('Text');
  const transport = {
    testConnection: vi.fn(),
    createResponse: vi
      .fn()
      .mockResolvedValueOnce(response('invalid JSON'))
      .mockResolvedValueOnce(
        response(JSON.stringify({ translations: [{ id: 'row', text: 'Texte' }] })),
      ),
  };
  const result = await translateDialogueUnit(dialogueParams(segment, transport));
  expect(transport.createResponse).toHaveBeenCalledTimes(2);
  expect(result.updates).toHaveLength(1);
});
