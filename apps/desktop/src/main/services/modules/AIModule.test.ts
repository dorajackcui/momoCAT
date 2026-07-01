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
    status: params.status ?? 'new',
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

async function runFileProcessingConcurrencyCase(params: {
  projectType: 'translation' | 'review' | 'custom';
  segmentPrefix: string;
  responseContent: (index: number) => string;
}) {
  const segments: Segment[] = Array.from({ length: 5 }, (_, index) =>
    createSegment({
      segmentId: `${params.segmentPrefix}-${index + 1}`,
      sourceText: `Source ${index + 1}`,
    }),
  );

  const projectRepo = {
    getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
    getProject: vi.fn().mockReturnValue({
      id: 11,
      srcLang: 'en',
      tgtLang: 'zh',
      projectType: params.projectType,
      aiPrompt: params.projectType === 'custom' ? 'Rewrite the input.' : '',
      aiTemperature: 0.2,
    }),
  } as unknown as ProjectRepository;

  const segmentRepo = {
    getSegmentsPage: vi.fn().mockReturnValue(segments),
  } as unknown as SegmentRepository;

  const settingsRepo = createAISettingsRepository();

  const segmentService = {
    updateSegment: vi.fn().mockResolvedValue(undefined),
  } as unknown as SegmentService;

  type TransportResponse = { content: string; status: number; endpoint: string };
  const pending: Array<ReturnType<typeof createDeferred<TransportResponse>>> = [];
  const transport = {
    testConnection: vi.fn().mockResolvedValue({ ok: true }),
    createResponse: vi.fn().mockImplementation(() => {
      const deferred = createDeferred<TransportResponse>();
      pending.push(deferred);
      return deferred.promise;
    }),
  } as unknown as AITransport;

  const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
  const task = module.aiTranslateFile(1);

  await new Promise((resolve) => setTimeout(resolve, 0));
  const initiallyStarted = pending.length;

  let resolved = 0;
  while (resolved < segments.length) {
    while (!pending[resolved]) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
    }
    pending[resolved].resolve({
      content: params.responseContent(resolved),
      status: 200,
      endpoint: '/v1/responses',
    });
    resolved += 1;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 0));
  }

  return {
    initiallyStarted,
    result: await task,
    segmentService,
  };
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
      targetScope: 'blank-only',
    });

    expect(result).toEqual({ translated: 1, skipped: 1, failed: 0, total: 2 });
    expect(localizationEngine.translateProjectSegments).toHaveBeenCalledTimes(1);
    const input = localizationEngine.translateProjectSegments.mock.calls[0][0];
    expect(input.projectId).toBe(11);
    expect(input.documentId).toBe('file-1:demo.xlsx');
    expect(input.options).toEqual({
      mode: 'standard',
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
        metadata: { segmentId: 'loc-empty-1', orderIndex: 4, status: 'new' },
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
      'translated',
    );
    const translatedTokens = (segmentService.updateSegment as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(serializeTokensToDisplayText(translatedTokens)).toBe('Bonjour <b>monde</b>');
    expect(transport.createResponse).not.toHaveBeenCalled();
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
      'translated',
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
      'translated',
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

  it('keeps scanning after consecutive empty source segments', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'empty-1', sourceText: '' }),
      createSegment({ segmentId: 'empty-2', sourceText: '' }),
      createSegment({ segmentId: 'empty-3', sourceText: '' }),
      createSegment({ segmentId: 'valid-1', sourceText: 'Hello world' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    const result = await module.aiTranslateFile(1);

    expect(result.translated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.total).toBe(4);
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'valid-1',
      expect.any(Array),
      'translated',
    );

    const translatedTokens = (segmentService.updateSegment as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(serializeTokensToDisplayText(translatedTokens)).toBe('浣犲ソ涓栫晫');
  });

  it('keeps standard file tag policy none AI output as plain marker-like text', async () => {
    const sourceText = 'Save <xxx>';
    const targetText = 'Guardar <xxx>';
    const segments: Segment[] = [
      createSegment({
        segmentId: 'standard-policy-none-1',
        sourceText,
        sourceTokens: [{ type: 'text', content: sourceText }],
        targetText: '',
        status: 'new',
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
        aiPrompt: '',
        aiTemperature: 0.2,
        projectType: 'translation',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: targetText,
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    const result = await module.aiTranslateFile(1);

    expect(result).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
    const expectedTokens = [{ type: 'text' as const, content: targetText }];
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'standard-policy-none-1',
      expectedTokens,
      'translated',
    );
    expect(transport.createResponse).toHaveBeenCalledTimes(1);
  });

  it('accepts unchanged standard file translation output', async () => {
    const sourceText = '+{num1}';
    const segments: Segment[] = [
      createSegment({
        segmentId: 'standard-unchanged-1',
        sourceText,
        sourceTokens: parseDisplayTextToTokens(sourceText),
      }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
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

    const result = await module.aiTranslateFile(1);

    expect(result).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'standard-unchanged-1',
      expect.any(Array),
      'translated',
    );
    const translatedTokens = (segmentService.updateSegment as ReturnType<typeof vi.fn>).mock
      .calls[0][1];
    expect(serializeTokensToDisplayText(translatedTokens)).toBe(sourceText);
  });

  it('keeps blank-only as default target scope', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'blank-only-empty', sourceText: 'Hello world' }),
      createSegment({
        segmentId: 'blank-only-prefilled',
        sourceText: 'Good morning',
        targetText: 'prefilled target',
      }),
      createSegment({
        segmentId: 'blank-only-confirmed',
        sourceText: 'Confirmed text',
        targetText: 'confirmed target',
        status: 'confirmed',
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        projectType: 'translation',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1);

    expect(result).toEqual({ translated: 1, skipped: 2, failed: 0, total: 3 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'blank-only-empty',
      expect.any(Array),
      'translated',
    );
  });

  it('overwrites non-confirmed targets when targetScope is overwrite-non-confirmed', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'overwrite-empty', sourceText: 'Hello world' }),
      createSegment({
        segmentId: 'overwrite-prefilled',
        sourceText: 'Good morning',
        targetText: 'old target',
      }),
      createSegment({
        segmentId: 'overwrite-confirmed',
        sourceText: 'Confirmed text',
        targetText: 'confirmed target',
        status: 'confirmed',
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        projectType: 'translation',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'new target',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1, {
      targetScope: 'overwrite-non-confirmed',
    });

    expect(result).toEqual({ translated: 2, skipped: 1, failed: 0, total: 3 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(2);
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      1,
      'overwrite-empty',
      expect.any(Array),
      'translated',
    );
    expect(segmentService.updateSegment).toHaveBeenNthCalledWith(
      2,
      'overwrite-prefilled',
      expect.any(Array),
      'translated',
    );
    expect(segmentService.updateSegment).not.toHaveBeenCalledWith(
      'overwrite-confirmed',
      expect.any(Array),
      'translated',
    );
  });

  it('includes prefilled non-confirmed segments in dialogue mode overwrite scope', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'dialogue-overwrite-1', sourceText: 'Hello', context: 'Alice' }),
      createSegment({
        segmentId: 'dialogue-overwrite-2',
        sourceText: 'How are you?',
        targetText: 'old target',
        context: 'Alice',
      }),
      createSegment({
        segmentId: 'dialogue-overwrite-confirmed',
        sourceText: 'Confirmed',
        targetText: 'confirmed target',
        context: 'Alice',
        status: 'confirmed',
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        projectType: 'translation',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          translations: [
            { id: 'dialogue-overwrite-1', text: '浣犲ソ' },
            { id: 'dialogue-overwrite-2', text: '浣犲ソ鍚楋紵' },
          ],
        }),
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1, {
      mode: 'dialogue',
      targetScope: 'overwrite-non-confirmed',
    });

    expect(result).toEqual({ translated: 2, skipped: 1, failed: 0, total: 3 });
    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledTimes(1);
    const updates = (segmentService.updateSegmentsAtomically as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updates).toHaveLength(2);
    expect(updates[0].segmentId).toBe('dialogue-overwrite-1');
    expect(updates[1].segmentId).toBe('dialogue-overwrite-2');
  });

  it('includes imported context in user prompt', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'ctx-1', sourceText: 'Hello world', context: 'UI button label' }),
    ];

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
      getSegmentsPage: vi.fn((_fileId: number, offset: number) =>
        offset === 0 ? segments : [],
      ),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).toContain('Context: UI button label');
  });

  it('injects TM/TB references into translation user prompt', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'ref-1', sourceText: 'Hello world', context: 'UI button label' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
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
          similarity: 100,
          tmName: 'Main TM',
          sourceTokens: [{ type: 'text', content: 'Hello world' }],
          targetTokens: [{ type: 'text', content: '浣犲ソ涓栫晫' }],
        },
      ]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue([
        { srcTerm: 'world', tgtTerm: '涓栫晫', note: null },
        { srcTerm: 'hello', tgtTerm: '浣犲ソ', note: 'prefer short form' },
      ]),
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

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).toContain('TM References (top matches):');
    expect(userPrompt).toContain('- Similarity: 100% | TM: Main TM');
    expect(userPrompt).toContain('- Source: Hello world');
    expect(userPrompt).toContain('- Target: 浣犲ソ涓栫晫');
    expect(userPrompt).toContain('Terminology References (hit terms):');
    expect(userPrompt).toContain('- world => 涓栫晫');
    expect(userPrompt).toContain('- hello => 浣犲ソ (note: prefer short form)');
    expect(tmService.findMatches).toHaveBeenCalledTimes(1);
    expect(tbService.findMatches).toHaveBeenCalledTimes(1);
  });

  it('injects concordance matches separately from TM references in translation user prompt', async () => {
    const segments: Segment[] = [
      createSegment({
        segmentId: 'concordance-ref-1',
        sourceText: '楹︽氮鍐滃満',
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'zh-CN',
        tgtLang: 'fr-FR',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Contexte cible',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const tmService = {
      findMatches: vi.fn().mockResolvedValue([
        {
          id: 'concordance-1',
          projectId: 1,
          srcLang: 'zh-CN',
          tgtLang: 'fr-FR',
          srcHash: 'context-hash',
          matchKey: 'context',
          tagsSignature: '',
          sourceTokens: [
            {
              type: 'text',
              content: 'Long concordance source context.',
            },
          ],
          targetTokens: [{ type: 'text', content: 'Contexte cible' }],
          usageCount: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          kind: 'concordance',
          rank: 73,
          tmName: 'Main TM',
          tmType: 'main',
          matchedSourceText: '楹︽氮鍐滃満',
          sourceCoverage: 100,
          entryCoverage: 10,
        },
      ]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue([]),
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

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).toContain('Concordance Suggestions:');
    expect(userPrompt).not.toContain('Similarity: 73%');
  });

  it('keeps only top 3 TM references in translation prompt', async () => {
    const segments: Segment[] = [createSegment({ segmentId: 'tm-top-3', sourceText: 'Hello world' })];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'translated',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const tmService = {
      findMatches: vi.fn().mockResolvedValue([
        {
          kind: 'tm',
          similarity: 100,
          tmName: 'Main TM',
          sourceTokens: [{ type: 'text', content: 'Hello world' }],
          targetTokens: [{ type: 'text', content: 'Target one' }],
        },
        {
          kind: 'tm',
          similarity: 92,
          tmName: 'Main TM',
          sourceTokens: [{ type: 'text', content: 'Hello there' }],
          targetTokens: [{ type: 'text', content: 'Target two' }],
        },
        {
          kind: 'tm',
          similarity: 88,
          tmName: 'Project TM',
          sourceTokens: [{ type: 'text', content: 'World hello' }],
          targetTokens: [{ type: 'text', content: 'Target three' }],
        },
        {
          kind: 'tm',
          similarity: 77,
          tmName: 'Overflow TM',
          sourceTokens: [{ type: 'text', content: 'Overflow source' }],
          targetTokens: [{ type: 'text', content: 'Overflow target' }],
        },
      ]),
    } as unknown as Pick<TMService, 'findMatches'>;

    const tbService = {
      findMatches: vi.fn().mockResolvedValue([]),
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

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).toContain('TM References (top matches):');
    expect(userPrompt).toContain('- Target: Target one');
    expect(userPrompt).toContain('- Target: Target two');
    expect(userPrompt).toContain('- Target: Target three');
    expect(userPrompt).not.toContain('Overflow source');
    expect(userPrompt).not.toContain('Overflow target');
  });

  it('keeps only top 100 TB references in translation prompt', async () => {
    const segments: Segment[] = [createSegment({ segmentId: 'ref-2', sourceText: 'Hello world' })];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
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

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expectTBPromptCap(userPrompt);
  });

  it('does not resolve TM/TB references for review and custom projects', async () => {
    const tmService = {
      findMatches: vi.fn().mockResolvedValue([]),
    } as unknown as Pick<TMService, 'findMatches'>;
    const tbService = {
      findMatches: vi.fn().mockResolvedValue([]),
    } as unknown as Pick<TBService, 'findMatches'>;

    const runCase = async (projectType: 'review' | 'custom') => {
      const segments: Segment[] = [
        createSegment({ segmentId: `${projectType}-ref-1`, sourceText: 'Source text' }),
      ];
      const projectRepo = {
        getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
        getProject: vi.fn().mockReturnValue({
          id: 11,
          srcLang: 'en',
          tgtLang: 'zh',
          projectType,
          aiPrompt: '',
          aiTemperature: 0.2,
        }),
      } as unknown as ProjectRepository;
      const segmentRepo = {
        getSegmentsPage: vi.fn().mockReturnValue(segments),
      } as unknown as SegmentRepository;
      const settingsRepo = createAISettingsRepository();
      const segmentService = {
        updateSegment: vi.fn().mockResolvedValue(undefined),
      } as unknown as SegmentService;
      const transport = {
        testConnection: vi.fn().mockResolvedValue({ ok: true }),
        createResponse: vi.fn().mockResolvedValue({
          content: '澶勭悊缁撴灉',
          status: 200,
          endpoint: '/v1/responses',
        }),
      } as unknown as AITransport;

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
      await module.aiTranslateFile(1);
    };

    await runCase('review');
    await runCase('custom');

    expect(tmService.findMatches).toHaveBeenCalledTimes(0);
    expect(tbService.findMatches).toHaveBeenCalledTimes(0);
  });

  it('continues translation when TM/TB reference resolving fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const segments: Segment[] = [
      createSegment({ segmentId: 'ref-fail-1', sourceText: 'Hello world' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
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
      findMatches: vi.fn().mockRejectedValue(new Error('tm lookup failed')),
    } as unknown as Pick<TMService, 'findMatches'>;
    const tbService = {
      findMatches: vi.fn().mockRejectedValue(new Error('tb lookup failed')),
    } as unknown as Pick<TBService, 'findMatches'>;

    try {
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
      const result = await module.aiTranslateFile(1);

      expect(result.translated).toBe(1);
      expect(result.failed).toBe(0);
      expect(segmentService.updateSegment).toHaveBeenCalledTimes(1);
      const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
        .userPrompt;
      expect(userPrompt).not.toContain('TM References (top matches):');
      expect(userPrompt).not.toContain('Terminology References (hit terms):');
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve TM reference for segment ref-fail-1'),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to resolve TB references for segment ref-fail-1'),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('uses project-level configured provider for file translation', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'model-1', sourceText: 'Hello world' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    await module.aiTranslateFile(1);

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.baseUrl).toBe(TEST_PROVIDER_BASE_URL);
    expect(request.model).toBe(TEST_PROVIDER_MODEL);
  });

  it('prefers request provider over project aiModel when request provider is configured', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'model-2', sourceText: 'Hello world' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: TEST_PROVIDER_ID,
      }),
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
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    await module.aiTranslateFile(1, { model: ALT_PROVIDER_ID });

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.model).toBe(ALT_PROVIDER_MODEL);
  });

  it('rejects translation when neither request nor project provider is configured', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'model-3', sourceText: 'Hello world' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        aiPrompt: '',
        aiTemperature: 0.2,
        aiModel: 'provider:missing-project',
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    await expect(module.aiTranslateFile(1, { model: 'provider:missing-request' })).rejects.toThrow(
      'AI provider is not configured.',
    );
    expect(transport.createResponse).not.toHaveBeenCalled();
  });

  it('omits context field in user prompt when imported context is missing', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'ctx-empty-1', sourceText: 'Hello world' }),
    ];

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
      getSegmentsPage: vi.fn((_fileId: number, offset: number) =>
        offset === 0 ? segments : [],
      ),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '浣犲ソ涓栫晫',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    await module.aiTranslateFile(1);

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).not.toContain('Context:');
  });

  it('keeps review language instruction when custom review prompt is provided', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'review-1', sourceText: 'Existing translation text' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'review',
        aiPrompt: 'Review only for terminology and fluency. Keep style concise.',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Existing translation text',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    await module.aiTranslateFile(1);

    const systemPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .systemPrompt;
    expect(systemPrompt).toContain('Original text language: en. Translation text language: zh.');
    expect(systemPrompt).toContain('Review only for terminology and fluency. Keep style concise.');
  });

  it('allows unchanged output in review project during file processing', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'review-unchanged-1', sourceText: 'Already good text' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'review',
        aiPrompt: '',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Already good text',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);

    const result = await module.aiTranslateFile(1);
    expect(result.failed).toBe(0);
    expect(result.translated).toBe(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'review-unchanged-1',
      expect.any(Array),
      'reviewed',
    );
  });

  it('uses custom prompt as full system prompt and custom input/context user prompt', async () => {
    const segments: Segment[] = [
      createSegment({
        segmentId: 'custom-1',
        sourceText: 'Input text',
        context: 'Context details',
      }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'custom',
        aiPrompt: 'Classify the input and output only one label.',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'positive',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    await module.aiTranslateFile(1);

    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.systemPrompt).toBe('Classify the input and output only one label.');
    expect(request.userPrompt).toContain('Input:');
    expect(request.userPrompt).toContain('Input text');
    expect(request.userPrompt).toContain('Context: Context details');
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'custom-1',
      expect.any(Array),
      'translated',
    );
  });

  it('allows unchanged output in custom project during file processing', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'custom-unchanged-1', sourceText: 'Same text' }),
    ];

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'custom',
        aiPrompt: 'Return the input unchanged.',
        aiTemperature: 0.2,
      }),
    } as unknown as ProjectRepository;

    const segmentRepo = {
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Same text',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1);
    expect(result.failed).toBe(0);
    expect(result.translated).toBe(1);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'custom-unchanged-1',
      expect.any(Array),
      'translated',
    );
  });

  it('starts custom file processing with bounded concurrent provider requests', async () => {
    const { initiallyStarted, result, segmentService } = await runFileProcessingConcurrencyCase({
      projectType: 'custom',
      segmentPrefix: 'custom-concurrent',
      responseContent: (index) => `Output ${index + 1}`,
    });

    expect(initiallyStarted).toBe(4);
    expect(result).toEqual({ translated: 5, skipped: 0, failed: 0, total: 5 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(5);
  });

  it('starts default translation file processing with bounded concurrent provider requests', async () => {
    const { initiallyStarted, result, segmentService } = await runFileProcessingConcurrencyCase({
      projectType: 'translation',
      segmentPrefix: 'translation-concurrent',
      responseContent: (index) => `璇戞枃 ${index + 1}`,
    });

    expect(initiallyStarted).toBe(4);
    expect(result).toEqual({ translated: 5, skipped: 0, failed: 0, total: 5 });
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(5);
  });

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

  it('groups consecutive speaker segments and injects previous dialogue group context', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'dlg-a1', sourceText: 'Hello', context: 'Alice' }),
      createSegment({ segmentId: 'dlg-a2', sourceText: 'How are you?', context: 'Alice' }),
      createSegment({ segmentId: 'dlg-b1', sourceText: 'I am fine.', context: 'Bob' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi
        .fn()
        .mockResolvedValueOnce({
          content:
            '{"translations":[{"id":"dlg-a1","text":"hello"},{"id":"dlg-a2","text":"how are you"}]}',
          status: 200,
          endpoint: '/v1/responses',
        })
        .mockResolvedValueOnce({
          content: '{"translations":[{"id":"dlg-b1","text":"I am fine"}]}',
          status: 200,
          endpoint: '/v1/responses',
        }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1, { mode: 'dialogue' });

    expect(result.translated).toBe(3);
    expect(result.failed).toBe(0);
    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledTimes(2);
    const firstUpdate = (segmentService.updateSegmentsAtomically as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(firstUpdate).toHaveLength(2);
    const secondPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[1][0]
      .userPrompt;
    expect(secondPrompt).toContain('Previous Dialogue Group (for consistency):');
    expect(secondPrompt).toContain('speaker: Alice');
    expect(secondPrompt).toContain('hello');
    expect(segmentService.updateSegment).not.toHaveBeenCalled();
  });

  it('accepts unchanged dialogue translation output', async () => {
    const sourceText = '+{num1}';
    const segments: Segment[] = [
      createSegment({
        segmentId: 'dlg-unchanged-1',
        sourceText,
        sourceTokens: parseDisplayTextToTokens(sourceText),
        context: 'Alice',
      }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          translations: [{ id: 'dlg-unchanged-1', text: sourceText }],
        }),
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1, { mode: 'dialogue' });

    expect(result).toEqual({ translated: 1, skipped: 0, failed: 0, total: 1 });
    expect(segmentService.updateSegmentsAtomically).toHaveBeenCalledTimes(1);
    const update = (segmentService.updateSegmentsAtomically as ReturnType<typeof vi.fn>).mock
      .calls[0][0][0];
    expect(update.segmentId).toBe('dlg-unchanged-1');
    expect(update.status).toBe('translated');
    expect(serializeTokensToDisplayText(update.targetTokens)).toBe(sourceText);
    expect(segmentService.updateSegment).not.toHaveBeenCalled();
  });

  it('keeps only top 100 TB references in dialogue prompts', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'dlg-tb-cap-1', sourceText: 'Hello', context: 'Alice' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: '{"translations":[{"id":"dlg-tb-cap-1","text":"dialogue-output"}]}',
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

    await module.aiTranslateFile(1, { mode: 'dialogue' });

    const userPrompt = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .userPrompt;
    expect(userPrompt).toContain('Terminology References (hit terms):');
    expectTBPromptCap(userPrompt);
  });

  it('falls back to per-segment translation when dialogue group translation fails', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'dlg-fallback-1', sourceText: 'First line', context: 'Alice' }),
      createSegment({ segmentId: 'dlg-fallback-2', sourceText: 'Second line', context: 'Alice' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const responses = ['not-json', 'still-not-json', 'again-not-json', 'line one', 'line two'];
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockImplementation(async () => ({
        content: responses.shift() ?? 'default target',
        status: 200,
        endpoint: '/v1/responses',
      })),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateFile(1, { mode: 'dialogue' });

    expect(result.translated).toBe(2);
    expect(result.failed).toBe(0);
    expect(segmentService.updateSegmentsAtomically).not.toHaveBeenCalled();
    expect(segmentService.updateSegment).toHaveBeenCalledTimes(2);
  });

  it('emits dialogue progress only after group translation is committed', async () => {
    const segments: Segment[] = [
      createSegment({ segmentId: 'dlg-progress-1', sourceText: 'First line', context: 'Alice' }),
      createSegment({ segmentId: 'dlg-progress-2', sourceText: 'Second line', context: 'Alice' }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const deferred = createDeferred<{ content: string; status: number; endpoint: string }>();
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockImplementation(() => deferred.promise),
    } as unknown as AITransport;

    const progressEvents: Array<{ current: number; total: number; message?: string }> = [];
    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const task = module.aiTranslateFile(1, {
      mode: 'dialogue',
      onProgress: (event) => progressEvents.push(event),
    });

    await Promise.resolve();
    expect(progressEvents).toHaveLength(0);

    deferred.resolve({
      content:
        '{"translations":[{"id":"dlg-progress-1","text":"line one"},{"id":"dlg-progress-2","text":"line two"}]}',
      status: 200,
      endpoint: '/v1/responses',
    });
    await task;

    expect(progressEvents.map((event) => event.current)).toEqual([1, 2]);
    expect(progressEvents[0].total).toBe(2);
    expect(progressEvents[1].message).toContain('segment 2 of 2');
  });

  it('emits dialogue fallback progress after each segment completes', async () => {
    const segments: Segment[] = [
      createSegment({
        segmentId: 'dlg-progress-fallback-1',
        sourceText: 'First line',
        context: 'Alice',
      }),
      createSegment({
        segmentId: 'dlg-progress-fallback-2',
        sourceText: 'Second line',
        context: 'Alice',
      }),
    ];

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
      getSegmentsPage: vi.fn().mockReturnValue(segments),
    } as unknown as SegmentRepository;

    const settingsRepo = createAISettingsRepository();

    const segmentService = {
      updateSegment: vi.fn().mockResolvedValue(undefined),
      updateSegmentsAtomically: vi.fn().mockResolvedValue([]),
    } as unknown as SegmentService;

    const fallbackFirst = createDeferred<{ content: string; status: number; endpoint: string }>();
    const fallbackSecond = createDeferred<{ content: string; status: number; endpoint: string }>();
    type TransportResponse = { content: string; status: number; endpoint: string };
    const queue: Array<Promise<TransportResponse> | TransportResponse> = [
      Promise.resolve({ content: 'not-json', status: 200, endpoint: '/v1/responses' }),
      Promise.resolve({ content: 'still-not-json', status: 200, endpoint: '/v1/responses' }),
      Promise.resolve({ content: 'again-not-json', status: 200, endpoint: '/v1/responses' }),
      fallbackFirst.promise,
      fallbackSecond.promise,
    ];
    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockImplementation(async () => {
        const next = queue.shift();
        if (!next) {
          return { content: 'default target', status: 200, endpoint: '/v1/responses' };
        }
        return next;
      }),
    } as unknown as AITransport;

    const progressEvents: Array<{ current: number; total: number; message?: string }> = [];
    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const task = module.aiTranslateFile(1, {
      mode: 'dialogue',
      onProgress: (event) => progressEvents.push(event),
    });

    await Promise.resolve();
    await Promise.resolve();
    expect(progressEvents).toHaveLength(0);

    fallbackFirst.resolve({ content: 'line one', status: 200, endpoint: '/v1/responses' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(progressEvents.map((event) => event.current)).toEqual([1]);

    fallbackSecond.resolve({ content: 'line two', status: 200, endpoint: '/v1/responses' });
    await task;
    expect(progressEvents.map((event) => event.current)).toEqual([1, 2]);
    expect(progressEvents[1].message).toContain('segment 2 of 2');
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
      status: 'translated',
      propagatedIds: ['single-propagated-1'],
      serverAppliedAt: '2026-06-12T00:00:00.000Z',
    });
    expect(serializeTokensToDisplayText(result.targetTokens)).toBe('浣犲ソ涓栫晫');
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-1',
      expect.any(Array),
      'translated',
    );
    const request = (transport.createResponse as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(request.userPrompt).toContain('Context: UI button label');
    expect(request.userPrompt).toContain('TM References (top matches):');
    expect(request.userPrompt).toContain('Terminology References (hit terms):');
  });

  it('returns reviewed status for review project', async () => {
    const segment = createSegment({
      segmentId: 'single-review-1',
      sourceText: 'Review this text',
      targetText: '鍒濈',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'review',
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
        serverAppliedAt: '2026-06-12T00:00:01.000Z',
      }),
    } as unknown as SegmentService;

    const transport = {
      testConnection: vi.fn().mockResolvedValue({ ok: true }),
      createResponse: vi.fn().mockResolvedValue({
        content: 'Review this text',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiTranslateSegment('single-review-1');

    expect(result).toEqual({
      fileId: segment.fileId,
      segmentId: 'single-review-1',
      targetTokens: expect.any(Array),
      status: 'reviewed',
      propagatedIds: [],
      serverAppliedAt: '2026-06-12T00:00:01.000Z',
    });
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-review-1',
      expect.any(Array),
      'reviewed',
    );
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
      status: 'translated',
      propagatedIds: [],
      serverAppliedAt: '2026-06-12T00:00:02.000Z',
    });
    expect(serializeTokensToDisplayText(result.targetTokens)).toBe(sourceText);
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'single-unchanged-1',
      expect.any(Array),
      'translated',
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
      'translated',
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
      'translated',
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
        status: 'translated',
        propagatedIds: [],
        serverAppliedAt: expect.any(String),
      }),
    );
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'refine-1',
      expect.any(Array),
      'translated',
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

  it('returns reviewed status for review project', async () => {
    const segment = createSegment({
      segmentId: 'refine-review-1',
      sourceText: 'Review this text',
      targetText: '鍒濈',
      status: 'draft',
    });

    const projectRepo = {
      getFile: vi.fn().mockReturnValue({ id: 1, projectId: 11, name: 'demo.xlsx' }),
      getProject: vi.fn().mockReturnValue({
        id: 11,
        srcLang: 'en',
        tgtLang: 'zh',
        projectType: 'review',
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
        content: 'refined target',
        status: 200,
        endpoint: '/v1/responses',
      }),
    } as unknown as AITransport;

    const module = new AIModule(projectRepo, segmentRepo, settingsRepo, segmentService, transport);
    const result = await module.aiRefineSegment('refine-review-1', 'Fix terminology only');

    expect(result).toEqual(
      expect.objectContaining({
        segmentId: 'refine-review-1',
        targetTokens: [{ type: 'text', content: 'refined target' }],
        status: 'reviewed',
        propagatedIds: [],
        serverAppliedAt: expect.any(String),
      }),
    );
    expect(segmentService.updateSegment).toHaveBeenCalledWith(
      'refine-review-1',
      expect.any(Array),
      'reviewed',
    );
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
      status: 'new',
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
        status: 'translated',
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
