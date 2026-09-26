import { describe, expect, it, vi } from 'vitest';
import type { Segment, Token } from '@cat/core/models';
import { parseDisplayTextToTokens } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { TranslateProjectSegmentsInput } from '@cat/localization';
import { AIModule } from './AIModule';
import { AITransport, ProjectRepository, SegmentRepository, SettingsRepository } from '../ports';
import type { ProxySettingsApplier } from '../proxy/ProxySettingsManager';
import { SegmentService } from '../SegmentService';
import type { TBService } from '../TBService';
import type { TMService } from '../TMService';

function createSegment(params: {
  segmentId: string;
  sourceText: string;
  targetText?: string;
  sourceTokens?: Token[];
  targetTokens?: Token[];
  status?: Segment['status'];
  context?: string;
  orderIndex?: number;
}): Segment {
  const sourceTokens = params.sourceTokens ?? (params.sourceText
    ? [{ type: 'text', content: params.sourceText as string }]
    : []);
  const targetTokens = params.targetTokens ?? (params.targetText
    ? [{ type: 'text', content: params.targetText as string }]
    : []);
  return {
    segmentId: params.segmentId,
    fileId: 1,
    orderIndex: params.orderIndex ?? 0,
    sourceTokens,
    targetTokens,
    status: params.status ?? 'empty',
    tagsSignature: '',
    matchKey: params.sourceText.toLowerCase(),
    srcHash: `hash-${params.segmentId}`,
    meta: {
      context: params.context,
      updatedAt: new Date().toISOString(),
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const TEST_CONNECTION_ID = 'connection:test-openai';
const TEST_PROVIDER_ID = 'provider:test-gpt-5-mini';
const TEST_PROVIDER_MODEL = 'gpt-5-mini';
const ALT_PROVIDER_ID = 'provider:test-gpt-5.4';
const ALT_PROVIDER_MODEL = 'gpt-5.4';
const TEST_PROVIDER_BASE_URL = 'https://api.test/v1';
const TEST_TIMESTAMP = '2026-01-01T00:00:00.000Z';

function createAISettingsRepository(options?: {
  apiKey?: string;
  providers?: Array<{ id: string; name: string; model: string }>;
}): SettingsRepository {
  const apiKey = options?.apiKey ?? 'test-api-key';
  const providers = options?.providers ?? [
    { id: TEST_PROVIDER_ID, name: 'Test GPT 5 mini', model: TEST_PROVIDER_MODEL },
  ];
  const discoveredModels = Array.from(new Set(providers.map((provider) => provider.model)));
  const settingsStore = new Map<string, string>([
    [
      'ai_connection_catalog_v1',
      JSON.stringify([
        {
          id: TEST_CONNECTION_ID,
          name: 'Test OpenAI',
          baseUrl: TEST_PROVIDER_BASE_URL,
          protocol: 'chat-completions',
          kind: 'openai-compatible',
          apiKeyLast4: apiKey.slice(-4),
          discoveredModels,
          lastTestedAt: TEST_TIMESTAMP,
          lastRefreshedAt: TEST_TIMESTAMP,
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        },
      ]),
    ],
    [
      'ai_provider_catalog_v2',
      JSON.stringify(
        providers.map((provider) => ({
          id: provider.id,
          name: provider.name,
          connectionId: TEST_CONNECTION_ID,
          model: provider.model,
          protocol: 'chat-completions',
          kind: 'configured',
          createdAt: TEST_TIMESTAMP,
          updatedAt: TEST_TIMESTAMP,
        })),
      ),
    ],
    [`ai_connection_key::${TEST_CONNECTION_ID}`, apiKey],
  ]);

  return {
    getSetting: vi.fn((key: string) => settingsStore.get(key)),
    setSetting: vi.fn((key: string, value: string | null) => {
      if (value === null) {
        settingsStore.delete(key);
        return;
      }
      settingsStore.set(key, value);
    }),
  } as unknown as SettingsRepository;
}

function createTBPromptMatches(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    srcTerm: `t${index + 1}`,
    tgtTerm: `v${index + 1}`,
    note: null,
  }));
}

function expectTBPromptCap(userPrompt: string) {
  expect(userPrompt).toContain('- t1 => v1');
  expect(userPrompt).toContain('- t100 => v100');
  expect(userPrompt).not.toContain('- t101 => v101');
}

describe('AIModule.aiTranslateFile', () => {
  it('uses localization window-partial workflow for default translation project file translate', async () => {
    const segments: Segment[] = [
      createSegment({
        segmentId: 'loc-empty-1',
        sourceText: 'Hello <b>world</b>',
        context: '  Homepage title  ',
        orderIndex: 4,
      }),
      createSegment({
        segmentId: 'loc-confirmed-1',
        sourceText: 'Already done',
        targetText: 'Deja termine',
        status: 'confirmed',
        orderIndex: 5,
      }),
    ];

    const project = {
      id: 11,
      srcLang: 'en',
      tgtLang: 'fr',
      projectType: 'translation',
      aiPrompt: '',
      aiTemperature: 0.2,
      aiModel: TEST_PROVIDER_ID,
    };
    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue(project),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository({
      providers: [
        { id: TEST_PROVIDER_ID, name: 'Test GPT 5 mini', model: TEST_PROVIDER_MODEL },
        { id: ALT_PROVIDER_ID, name: 'Test GPT 5.4', model: ALT_PROVIDER_MODEL },
      ],
    });

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;

    const localizationEngine = {
      translateProjectSegments: vi.fn(async (input: TranslateProjectSegmentsInput) => {
        await input.onResult?.({
          id: 'loc-empty-1',
          source: 'Hello <b>world</b>',
          target: 'Bonjour <b>monde</b>',
          status: 'translated',
          metadata: { segmentId: 'loc-empty-1' },
        });
        return {
          summary: { total: 2, translated: 1, reused: 0, skipped: 1, failed: 0 },
          results: [],
        };
      }),
    };

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      settingsRepo,
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
    );

    const result = await module.aiTranslateFile(1, {
      model: ALT_PROVIDER_ID,
    });

    expect(result).toEqual({ translated: 1, skipped: 1, failed: 0, total: 2 });
    expect(localizationEngine.translateProjectSegments).toHaveBeenCalledTimes(1);
    const input = localizationEngine.translateProjectSegments.mock.calls[0][0];
    expect(input.projectId).toBe(11);
    expect(input.documentId).toBe('file-1:demo.xlsx');
    expect(input.options).toEqual({
      requestMode: 'window-partial',
      targetBaseline: 'use-current-targets',
      tagPolicy: 'default',
      mt: { providerId: ALT_PROVIDER_ID },
    });
    expect(input.units).toEqual([
      {
        id: 'loc-empty-1',
        source: 'Hello <b>world</b>',
        target: '',
        context: 'Homepage title',
        rowNumber: 5,
        metadata: { segmentId: 'loc-empty-1', orderIndex: 4, status: 'empty' },
      },
      {
        id: 'loc-confirmed-1',
        source: 'Already done',
        target: 'Deja termine',
        rowNumber: 6,
        locked: true,
        metadata: { segmentId: 'loc-confirmed-1', orderIndex: 5, status: 'confirmed' },
      },
    ]);
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'loc-empty-1',
      expect.any(Array),
      'draft',
    );
    const translatedTokens = (segmentService.updateSegment as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(serializeTokensToDisplayText(translatedTokens)).toBe('Bonjour <b>monde</b>');
    expect(transport.createResponse).not.toHaveBeenCalled();

    vi.mocked(segmentRepo.getSegmentsPage).mockReturnValue([
      segments[0],
      createSegment({ segmentId: 'excluded', sourceText: 'Excluded dialogue' }),
      segments[1],
    ]);
    await module.aiTranslateFile(1, {
      segmentIds: ['loc-confirmed-1', 'loc-empty-1'],
    });
    expect(localizationEngine.translateProjectSegments.mock.calls[1][0].units).toEqual(input.units);
  });

  it('flushes translation audit after successful localization file translation', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'loc-flush-success-1', sourceText: 'Hello' }),
    ];
    const calls: string[] = [];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async () => {
        calls.push('translate');
        return {
          summary: { total: 1, translated: 1, reused: 0, skipped: 0, failed: 0 },
          results: [],
        };
      }),
    };
    const translationAuditFlush = vi.fn(async () => {
      calls.push('flush');
    });

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
      translationAuditFlush,
    );

    await module.aiTranslateFile(1);

    expect(translationAuditFlush).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['translate', 'flush']);
  });

  it('keeps successful localization translation when translation audit flush rejects', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'loc-flush-reject-success-1', sourceText: 'Hello' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async (input: TranslateProjectSegmentsInput) => {
        await input.onResult?.({
          id: 'loc-flush-reject-success-1',
          source: 'Hello',
          target: 'Bonjour',
          status: 'translated',
          metadata: { segmentId: 'loc-flush-reject-success-1' },
        });
        return {
          summary: { total: 1, translated: 1, reused: 0, skipped: 0, failed: 0 },
          results: [],
        };
      }),
    };
    const translationAuditFlush = vi.fn(async () => {
      throw new Error('audit flush failed');
    });

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
      translationAuditFlush,
    );

    await expect(module.aiTranslateFile(1)).resolves.toEqual({
      translated: 1,
      skipped: 0,
      failed: 0,
      total: 1,
    });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'loc-flush-reject-success-1',
      expect.any(Array),
      'draft',
    );
    expect(translationAuditFlush).toHaveBeenCalledTimes(1);
  });

  it('flushes translation audit when localization file translation fails', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'loc-flush-failure-1', sourceText: 'Hello' }),
    ];
    const translationError = new Error('translation failed');

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async () => {
        throw translationError;
      }),
    };
    const translationAuditFlush = vi.fn();

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
      translationAuditFlush,
    );

    await expect(module.aiTranslateFile(1)).rejects.toBe(translationError);
    expect(translationAuditFlush).toHaveBeenCalledTimes(1);
  });

  it('writes localization display targets without reinterpreting placeholder-like tags as editor markers', async () => {
    const sourceText =
      '<Yellow_20>{1}</>邀请你进入<Yellow_20>喵舞训练营·灿烂烟花</>，是否接受？';
    const targetText =
      "<Yellow_20>{1}</> vous invite à entrer dans <Yellow_20>Camp de danse de Momo : feux d'artifice</>. Accepter ?";
    const segments: Segment[] = [
      createSegment({
        segmentId: 'loc-display-tags-1',
        sourceText,
        sourceTokens: parseDisplayTextToTokens(sourceText),
        orderIndex: 9,
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'zh-CN',
        tgtLang: 'fr-FR',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async (input: TranslateProjectSegmentsInput) => {
        await input.onResult?.({
          id: 'loc-display-tags-1',
          source: sourceText,
          target: targetText,
          status: 'translated',
          metadata: { segmentId: 'loc-display-tags-1' },
        });
        return {
          summary: { total: 1, translated: 1, reused: 0, skipped: 0, failed: 0 },
          results: [],
        };
      }),
    };

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
    );

    await module.aiTranslateFile(1);

    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
    const translatedTokens = (segmentService.updateSegment as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(serializeTokensToDisplayText(translatedTokens)).toBe(targetText);
    expect(
      translatedTokens
        .filter((token: Token) => token.type === 'tag')
        .map((token: Token) => token.content),
    ).toEqual(['<Yellow_20>', '{1}', '</>', '<Yellow_20>', '</>']);
  });

  it('keeps localization tagPolicy none targets as plain marker-like text', async () => {
    const sourceText = 'Save <xxx>';
    const targetText = 'Guardar <xxx>';
    const segments: Segment[] = [
      createSegment({
        segmentId: 'loc-policy-none-1',
        sourceText,
        sourceTokens: [{ type: 'text', content: sourceText }],
        orderIndex: 0,
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 1,
        projectId: 11,
        name: 'demo.xlsx',
        importOptionsJson: JSON.stringify({ tagPolicy: 'none' }),
      }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'es',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async (input: TranslateProjectSegmentsInput) => {
        await input.onResult?.({
          id: 'loc-policy-none-1',
          source: sourceText,
          target: targetText,
          status: 'translated',
          metadata: { segmentId: 'loc-policy-none-1' },
        });
        return {
          summary: { total: 1, translated: 1, reused: 0, skipped: 0, failed: 0 },
          results: [],
        };
      }),
    };

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
    );

    const result = await module.aiTranslateFile(1);

    expect(result).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
    const input = localizationEngine.translateProjectSegments.mock.calls[0][0];
    expect(input.options?.tagPolicy).toBe('none');
    const expectedTokens = [{ type: 'text' as const, content: targetText }];
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'loc-policy-none-1',
      expectedTokens,
      'draft',
    );
    expect(transport.createResponse).not.toHaveBeenCalled();
  });

  it('passes target baseline to localization so the engine can ignore current targets', async () => {
    const segments: Segment[] = [
      createSegment({
        segmentId: 'baseline-prefilled',
        sourceText: 'Good morning',
        targetText: 'old target',
        orderIndex: 0,
      }),
      createSegment({
        segmentId: 'baseline-confirmed',
        sourceText: 'Confirmed text',
        targetText: 'confirmed target',
        status: 'confirmed',
        orderIndex: 1,
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'fr',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;
    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;
    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;
    const localizationEngine = {
      translateProjectSegments: vi.fn(async () => ({
        summary: { total: 2, translated: 1, reused: 0, skipped: 1, failed: 0 },
        results: [],
      })),
    };

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      createAISettingsRepository(),
      segmentService,
      transport,
      undefined,
      undefined,
      undefined,
      localizationEngine,
    );

    await module.aiTranslateFile(1, {
      targetBaseline: 'ignore-current-targets',
    });

    const input = localizationEngine.translateProjectSegments.mock.calls[0][0];
    expect(input.options?.targetBaseline).toBe('ignore-current-targets');
    expect(input.options?.targetScope).toBeUndefined();
    expect(input.units).toEqual([
      expect.objectContaining({
        id: 'baseline-prefilled',
        target: 'old target',
      }),
      expect.objectContaining({
        id: 'baseline-confirmed',
        target: 'confirmed target',
        locked: true,
      }),
    ]);
  });

});

describe('AIModule.aiTestTranslate', () => {
  it('returns the actual tester system/user prompts from aiTestTranslate', async () => {
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'custom',
        aiPrompt: 'Process text',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue([]),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'processed',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTestTranslate(11, 'Input text', 'Additional context');

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(result.ok).toBe(true);
    expect(result.systemPrompt).toBe(request.systemPrompt);
    expect(result.userPrompt).toBe(request.userPrompt);
    expect(result.translatedText).toBe('processed');
    expect(request.model).toBe(TEST_PROVIDER_MODEL);
    expect(request.userPrompt).toContain('Input:');
    expect(request.userPrompt).toContain('Input text');
    expect(request.userPrompt).toContain('Context: Additional context');
  });

  it('returns the actual tester system/user prompts when aiTestTranslate transport fails', async () => {
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'translation',
        aiPrompt: 'Use concise style.',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue([]),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockRejectedValue(new Error('transport failed')),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTestTranslate(11, 'Input text', 'Additional context');

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(result).toMatchObject({
      ok: false,
      error: 'transport failed',
      translatedText: '',
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
    });
  });

  it('returns tester prompts when aiTestTranslate accepts unchanged translation output', async () => {
    const projectRepo = {
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue([]),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Input text',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTestTranslate(11, 'Input text', 'Additional context');

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(result.error).toBeUndefined();
    expect(result).toMatchObject({
      ok: true,
      translatedText: 'Input text',
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
    });
  });
});

describe('AIModule.aiTranslateSegment', () => {
  it('translates one segment with the same prompt references as file translation', async () => {
    const segment = createSegment({
      segmentId: 'single-1',
      sourceText: 'Hello world',
      context: 'UI button label',
      targetText: 'old target',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue({
        propagatedIds: ['single-propagated-1'],
        serverAppliedAt: '2026-06-12T00:00:00.000Z',
      }),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const tmService = {
      findMatches: vi.fn().mockResolvedValue([
        {
          kind: 'tm',
          similarity: 99,
          tmName: 'Main TM',
          sourceTokens: [{ type: 'text', content: 'Hello world' }],
          targetTokens: [{ type: 'text', content: '浣犲ソ涓栫晫' }],
        },
      ]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue([{ srcTerm: 'world', tgtTerm: '涓栫晫', note: null }]),
    } as unknown as Pick<TBService, 'findMatches'>;

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      settingsRepo,
      segmentService,
      transport,
      undefined,
      {
        getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      },
      { tmService, tbService },
    );

    const result = await module.aiTranslateSegment('single-1');

    expect(result).toEqual({
      fileId: segment.fileId,
      segmentId: 'single-1',
      targetTokens: expect.any(Array),
      status: 'draft',
      propagatedIds: ['single-propagated-1'],
      serverAppliedAt: '2026-06-12T00:00:00.000Z',
    });
    expect(serializeTokensToDisplayText(result.targetTokens)).toBe('浣犲ソ涓栫晫');
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-1',
      expect.any(Array),
      'draft',
    );
    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.userPrompt).toContain('Context: UI button label');
    expect(request.userPrompt).toContain('TM References (top matches):');
    expect(request.userPrompt).toContain('Terminology References (hit terms):');
  });

  it('accepts unchanged single segment translation output', async () => {
    const sourceText = '+{num1}';
    const segment = createSegment({
      segmentId: 'single-unchanged-1',
      sourceText,
      sourceTokens: parseDisplayTextToTokens(sourceText),
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue({
        propagatedIds: [],
        serverAppliedAt: '2026-06-12T00:00:02.000Z',
      }),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: sourceText,
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateSegment('single-unchanged-1');

    expect(result).toEqual({
      fileId: segment.fileId,
      segmentId: 'single-unchanged-1',
      targetTokens: expect.any(Array),
      status: 'draft',
      propagatedIds: [],
      serverAppliedAt: '2026-06-12T00:00:02.000Z',
    });
    expect(serializeTokensToDisplayText(result.targetTokens)).toBe(sourceText);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-unchanged-1',
      expect.any(Array),
      'draft',
    );
  });

  it('keeps marker-like AI output plain under tagPolicy none', async () => {
    const segment = createSegment({
      segmentId: 'single-policy-none-1',
      sourceText: 'Save {1}',
      sourceTokens: [{ type: 'text', content: 'Save {1}' }],
      targetText: '',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 1,
        projectId: 11,
        name: 'demo.xlsx',
        importOptionsJson: JSON.stringify({ tagPolicy: 'none' }),
      }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'es',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue({
        propagatedIds: [],
        serverAppliedAt: '2026-06-12T00:00:02.000Z',
      }),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Guardar {1}',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateSegment('single-policy-none-1');

    const expectedTokens = [{ type: 'text' as const, content: 'Guardar {1}' }];
    expect(result.targetTokens).toEqual(expectedTokens);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-policy-none-1',
      expectedTokens,
      'draft',
    );
    expect(transport.createResponse).toHaveBeenCalledTimes(1);
  });

  it('keeps marker-like display AI output plain under tagPolicy none', async () => {
    const segment = createSegment({
      segmentId: 'single-display-policy-none-1',
      sourceText: 'Save <xxx>',
      sourceTokens: [{ type: 'text', content: 'Save <xxx>' }],
      targetText: '',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({
        id: 1,
        projectId: 11,
        name: 'demo.xlsx',
        importOptionsJson: JSON.stringify({ tagPolicy: 'none' }),
      }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'es',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue({
        propagatedIds: [],
        serverAppliedAt: '2026-06-12T00:00:03.000Z',
      }),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Guardar <xxx>',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateSegment('single-display-policy-none-1');

    const expectedTokens = [{ type: 'text' as const, content: 'Guardar <xxx>' }];
    expect(result.targetTokens).toEqual(expectedTokens);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-display-policy-none-1',
      expectedTokens,
      'draft',
    );
    expect(transport.createResponse).toHaveBeenCalledTimes(1);
  });
});

describe('AIModule.aiRefineSegment', () => {
  it('refines one segment with refinement prompt fields and translation references', async () => {
    const segment = createSegment({
      segmentId: 'refine-1',
      sourceText: 'Hello world',
      targetText: '浣犲ソ涓栫晫',
      context: 'UI button label',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'hello world target',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const tmService = {
      findMatches: vi.fn().mockResolvedValue([
        {
          kind: 'tm',
          similarity: 99,
          tmName: 'Main TM',
          sourceTokens: [{ type: 'text', content: 'Hello world' }],
          targetTokens: [{ type: 'text', content: '浣犲ソ涓栫晫' }],
        },
      ]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue([{ srcTerm: 'world', tgtTerm: '涓栫晫', note: null }]),
    } as unknown as Pick<TBService, 'findMatches'>;

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      settingsRepo,
      segmentService,
      transport,
      undefined,
      {
        getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      },
      { tmService, tbService },
    );

    const result = await module.aiRefineSegment('refine-1', 'Make the tone concise');

    expect(result).toEqual(
      expect.objectContaining({
        segmentId: 'refine-1',
        targetTokens: [{ type: 'text', content: 'hello world target' }],
        status: 'draft',
        propagatedIds: [],
        serverAppliedAt: expect.any(String),
      }),
    );
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'refine-1',
      expect.any(Array),
      'draft',
    );
    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.userPrompt).toContain('Context: UI button label');
    expect(request.userPrompt).toContain('Current Translation:');
    expect(request.userPrompt).toContain('浣犲ソ涓栫晫');
    expect(request.userPrompt).toContain('Refinement Instruction:');
    expect(request.userPrompt).toContain('Make the tone concise');
    expect(request.userPrompt).toContain('TM References (top matches):');
    expect(request.userPrompt).toContain('Terminology References (hit terms):');
  });

  it('keeps only top 100 TB references in refine prompts', async () => {
    const segment = createSegment({
      segmentId: 'refine-tb-cap-1',
      sourceText: 'Hello world',
      targetText: 'Draft output',
      context: 'Tooltip copy',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'refined-output',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const tmService = {
      findMatches: vi.fn().mockResolvedValue([]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue(createTBPromptMatches(101)),
    } as unknown as Pick<TBService, 'findMatches'>;

    const module = new AIModule(
      projectRepo,
      segmentRepo,
      settingsRepo,
      segmentService,
      transport,
      undefined,
      {
        getModelConfig: vi.fn().mockResolvedValue({ reasoningEffort: 'medium' }),
      },
      { tmService, tbService },
    );

    await module.aiRefineSegment('refine-tb-cap-1', 'Make it shorter');

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.userPrompt).toContain('Terminology References (hit terms):');
    expectTBPromptCap(request.userPrompt);
  });

  it('throws when refinement instruction is empty', async () => {
    const segment = createSegment({
      segmentId: 'refine-empty-inst-1',
      sourceText: 'Hello',
      targetText: '浣犲ソ',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    await expect(module.aiRefineSegment('refine-empty-inst-1', '   ')).rejects.toThrow(
      'Refinement instruction is empty',
    );
    expect(transport.createResponse).not.toHaveBeenCalled();
    expect(segmentService.updateSegment).not.toHaveBeenCalled();
  });

  it('throws when current target is empty', async () => {
    const segment = createSegment({
      segmentId: 'refine-empty-target-1',
      sourceText: 'Hello',
      targetText: '',
      status: 'empty',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn(),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    await expect(
      module.aiRefineSegment('refine-empty-target-1', 'Make it shorter'),
    ).rejects.toThrow('Target segment is empty');
    expect(transport.createResponse).not.toHaveBeenCalled();
    expect(segmentService.updateSegment).not.toHaveBeenCalled();
  });
});

describe('AIModule.segmentAIOperationLock', () => {
  it('rejects concurrent refine request when segment translation is in progress', async () => {
    const segment = createSegment({
      segmentId: 'lock-1',
      sourceText: 'Hello world',
      targetText: '浣犲ソ涓栫晫',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const pending = createDeferred<{ content: string; status: number; endpoint: string }>();
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockImplementation(() => pending.promise),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const firstCall = module.aiTranslateSegment('lock-1');

    await Promise.resolve();
    await expect(module.aiRefineSegment('lock-1', 'Make it concise')).rejects.toThrow(
      'AI request already in progress for this segment',
    );

    pending.resolve({ content: 'hello world target', status: 200, endpoint: '/v1/responses' });
    await firstCall;
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
  });

  it('releases segment lock after failure and allows next request', async () => {
    const segment = createSegment({
      segmentId: 'lock-release-1',
      sourceText: 'Hello world',
      targetText: '浣犲ソ涓栫晫',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'translation',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegment: vi.fn().mockReturnValue(segment),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi
        .fn()
        .mockRejectedValueOnce(new Error('temporary upstream error'))
        .mockResolvedValueOnce({
          content: 'hello world target',
          status: 200,
          endpoint: '/v1/responses',
        }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    await expect(module.aiTranslateSegment('lock-release-1')).rejects.toThrow(
      'temporary upstream error',
    );
    await expect(module.aiTranslateSegment('lock-release-1')).resolves.toEqual(
      expect.objectContaining({
        segmentId: 'lock-release-1',
        targetTokens: [{ type: 'text', content: 'hello world target' }],
        status: 'draft',
        propagatedIds: [],
        serverAppliedAt: expect.any(String),
      }),
    );
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
  });
});

describe('AIModule.proxySettings', () => {
  it('returns system mode by default when no proxy settings are stored', () => {
    const settingsRepo = {
      getSetting: vi.fn().mockReturnValue(undefined),
      setSetting: vi.fn(),
    } as unknown as SettingsRepository;

    const proxySettingsManager = {
      getEffectiveProxyUrl: vi.fn().mockReturnValue(undefined),
      applySettings: vi.fn(),
    } as unknown as ProxySettingsApplier;

    const module = new AIModule(
      {} as ProjectRepository,
      {} as SegmentRepository,
      settingsRepo,
      {} as SegmentService,
      {} as AITransport,
      proxySettingsManager,
    );

    expect(module.getProxySettings()).toEqual({
      mode: 'system',
      customProxyUrl: '',
      effectiveProxyUrl: undefined,
    });
  });

  it('applies and persists custom proxy settings', () => {
    const settingsStore = new Map<string, string>();
    const settingsRepo = {
      getSetting: vi.fn((key: string) => settingsStore.get(key)),
      setSetting: vi.fn((key: string, value: string | null) => {
        if (value === null) {
          settingsStore.delete(key);
          return;
        }
        settingsStore.set(key, value);
      }),
    } as unknown as SettingsRepository;

    const proxySettingsManager = {
      getEffectiveProxyUrl: vi.fn().mockReturnValue('http://127.0.0.1:7890'),
      applySettings: vi.fn().mockReturnValue({
        mode: 'custom',
        customProxyUrl: 'http://127.0.0.1:7890',
        effectiveProxyUrl: 'http://127.0.0.1:7890',
      }),
    } as unknown as ProxySettingsApplier;

    const module = new AIModule(
      {} as ProjectRepository,
      {} as SegmentRepository,
      settingsRepo,
      {} as SegmentService,
      {} as AITransport,
      proxySettingsManager,
    );

    const result = module.setProxySettings({
      mode: 'custom',
      customProxyUrl: ' http://127.0.0.1:7890 ',
    });

    expect(proxySettingsManager.applySettings).toHaveBeenCalledWith({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
    });
    expect(settingsRepo.setSetting).toHaveBeenCalledWith('app_proxy_mode', 'custom');
    expect(settingsRepo.setSetting).toHaveBeenCalledWith('app_proxy_url', 'http://127.0.0.1:7890');
    expect(result).toEqual({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
      effectiveProxyUrl: 'http://127.0.0.1:7890',
    });
  });

  it('applies saved proxy settings on startup', () => {
    const settingsRepo = {
      getSetting: vi.fn((key: string) => {
        if (key === 'app_proxy_mode') return 'custom';
        if (key === 'app_proxy_url') return 'http://127.0.0.1:7890';
        return undefined;
      }),
      setSetting: vi.fn(),
    } as unknown as SettingsRepository;

    const proxySettingsManager = {
      getEffectiveProxyUrl: vi.fn().mockReturnValue('http://127.0.0.1:7890'),
      applySettings: vi.fn().mockReturnValue({
        mode: 'custom',
        customProxyUrl: 'http://127.0.0.1:7890',
        effectiveProxyUrl: 'http://127.0.0.1:7890',
      }),
    } as unknown as ProxySettingsApplier;

    const module = new AIModule(
      {} as ProjectRepository,
      {} as SegmentRepository,
      settingsRepo,
      {} as SegmentService,
      {} as AITransport,
      proxySettingsManager,
    );

    const result = module.applySavedProxySettings();

    expect(proxySettingsManager.applySettings).toHaveBeenCalledWith({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
    });
    expect(result).toEqual({
      mode: 'custom',
      customProxyUrl: 'http://127.0.0.1:7890',
      effectiveProxyUrl: 'http://127.0.0.1:7890',
    });
  });
});
