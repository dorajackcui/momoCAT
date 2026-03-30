import { TagValidator } from '@cat/core/qa';
import type {
  AddAIProviderInput,
  AIBatchMode,
  AIProviderSummary,
  AITestProviderResult,
  AIBatchTargetScope,
  ProxySettings,
  ProxySettingsInput,
  TestAIProviderInput,
} from '../../../shared/ipc';
import type {
  AIRuntimeConfigProvider,
  AITransport,
  ProjectRepository,
  SegmentRepository,
  SettingsRepository,
} from '../ports';
import type { ProxySettingsApplier } from '../proxy/ProxySettingsManager';
import { ProxySettingsManager } from '../proxy/ProxySettingsManager';
import { SegmentService } from '../SegmentService';
import { DefaultAIRuntimeConfigProvider } from './ai/AIRuntimeConfigService';
import { AIProviderCatalogService } from './ai/AIProviderCatalogService';
import { AISettingsService } from './ai/AISettingsService';
import { AITextTranslator } from './ai/AITextTranslator';
import { AITranslationOrchestrator } from './ai/AITranslationOrchestrator';
import { SegmentPagingIterator } from './ai/SegmentPagingIterator';
import type { PromptReferenceResolvers } from './ai/types';

export class AIModule {
  private static readonly SEGMENT_PAGE_SIZE = 1000;

  private readonly settingsService: AISettingsService;
  private readonly providerCatalogService: AIProviderCatalogService;
  private readonly translationOrchestrator: AITranslationOrchestrator;
  private readonly projectRepo: ProjectRepository;

  constructor(
    projectRepo: ProjectRepository,
    segmentRepo: SegmentRepository,
    settingsRepo: SettingsRepository,
    segmentService: SegmentService,
    transport: AITransport,
    proxySettingsManager: ProxySettingsApplier = new ProxySettingsManager(),
    aiRuntimeConfigProvider: AIRuntimeConfigProvider = new DefaultAIRuntimeConfigProvider(),
    promptReferenceResolvers: PromptReferenceResolvers = {},
  ) {
    this.projectRepo = projectRepo;
    const tagValidator = new TagValidator();
    const textTranslator = new AITextTranslator(transport, tagValidator);
    const segmentPagingIterator = new SegmentPagingIterator(
      segmentRepo,
      AIModule.SEGMENT_PAGE_SIZE,
    );

    this.settingsService = new AISettingsService(settingsRepo, transport, proxySettingsManager);
    this.providerCatalogService = new AIProviderCatalogService(settingsRepo, transport);
    this.translationOrchestrator = new AITranslationOrchestrator(
      projectRepo,
      segmentRepo,
      segmentService,
      transport,
      aiRuntimeConfigProvider,
      this.providerCatalogService,
      textTranslator,
      segmentPagingIterator,
      promptReferenceResolvers,
    );
  }

  public getAISettings(): { apiKeySet: boolean; apiKeyLast4?: string } {
    return this.settingsService.getAISettings();
  }

  public setAIKey(apiKey: string): void {
    this.settingsService.setAIKey(apiKey);
  }

  public clearAIKey(): void {
    this.settingsService.clearAIKey();
  }

  public listAIProviders(): AIProviderSummary[] {
    return this.providerCatalogService.listProviders();
  }

  public async testAIProvider(input: TestAIProviderInput): Promise<AITestProviderResult> {
    return this.providerCatalogService.testProvider(input);
  }

  public addAIProvider(input: AddAIProviderInput): AIProviderSummary {
    return this.providerCatalogService.addProvider(input);
  }

  public deleteAIProvider(providerId: string): void {
    const isInUse = this.projectRepo
      .listProjects()
      .some((project) => project.aiModel === providerId);
    this.providerCatalogService.deleteProvider(providerId, isInUse);
  }

  public getProxySettings(): ProxySettings {
    return this.settingsService.getProxySettings();
  }

  public setProxySettings(settings: ProxySettingsInput): ProxySettings {
    return this.settingsService.setProxySettings(settings);
  }

  public applySavedProxySettings(): ProxySettings {
    return this.settingsService.applySavedProxySettings();
  }

  public async testAIConnection(apiKey?: string): Promise<{ ok: true }> {
    return this.settingsService.testAIConnection(apiKey);
  }

  public async aiTranslateFile(
    fileId: number,
    options?: {
      model?: string;
      mode?: AIBatchMode;
      targetScope?: AIBatchTargetScope;
      onProgress?: (data: { current: number; total: number; message?: string }) => void;
    },
  ): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
    return this.translationOrchestrator.aiTranslateFile(fileId, options);
  }

  public async aiTranslateSegment(
    segmentId: string,
    options?: {
      model?: string;
    },
  ) {
    return this.translationOrchestrator.aiTranslateSegment(segmentId, options);
  }

  public async aiRefineSegment(
    segmentId: string,
    instruction: string,
    options?: {
      model?: string;
    },
  ) {
    return this.translationOrchestrator.aiRefineSegment(segmentId, instruction, options);
  }

  public async aiTestTranslate(projectId: number, sourceText: string, contextText?: string) {
    return this.translationOrchestrator.aiTestTranslate(projectId, sourceText, contextText);
  }
}
