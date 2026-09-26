import type { Segment } from '@cat/core/models';
import type { CancellationToken, LocalizationEngine } from '@cat/localization';
import type { AITranslateFileOptions as DesktopAITranslateFileOptions } from '../../../../shared/ipc';
import { parseAITranslationSegmentIds } from '../../../../shared/aiTranslationScope';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import type { AIRuntimeConfigProvider, ProjectRepository, SegmentRepository } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { resolveTranslationPromptReferences } from '@cat/localization';
import type { PromptReferenceResolvers, TranslationPromptReferences } from '@cat/localization';
import { AIProviderCatalogService } from './AIProviderCatalogService';
import { AITextTranslator } from '@cat/localization';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import { runLocalizationFileTranslation } from './localizationFileTranslationWorkflow';
import {
  createSegmentOperationLock,
  runSegmentRefinement,
  runSegmentTranslation,
  runTestTranslation,
} from './segmentTranslationWorkflow';

export interface AITranslateFileOptions extends DesktopAITranslateFileOptions {
  model?: string;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
  cancellationToken?: CancellationToken;
}

export class AITranslationOrchestrator {
  private readonly segmentWorkflow = createSegmentOperationLock();

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly segmentService: SegmentService,
    private readonly aiRuntimeConfigProvider: AIRuntimeConfigProvider,
    private readonly providerCatalogService: AIProviderCatalogService,
    private readonly textTranslator: AITextTranslator,
    private readonly segmentPagingIterator: SegmentPagingIterator,
    private readonly promptReferenceResolvers: PromptReferenceResolvers = {},
    private readonly localizationEngine?: Pick<LocalizationEngine, 'translateProjectSegments'>,
    private readonly translationAuditFlush?: () => Promise<void> | void,
  ) {}

  public async aiTranslateFile(
    fileId: number,
    options?: AITranslateFileOptions,
  ): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');

    const project = this.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const segmentIds = parseAITranslationSegmentIds(options?.segmentIds);
    if (!this.localizationEngine) {
      throw new Error('File translation requires the shared localization engine.');
    }

    return runLocalizationFileTranslation({
      fileId,
      fileName: file.name,
      segmentIds,
      project,
      targetBaseline: options?.targetBaseline ?? 'use-current-targets',
      tagPolicy: resolveFileTagPolicy(file),
      providerId: options?.model ?? project.aiModel,
      localizationEngine: this.localizationEngine,
      segmentPagingIterator: this.segmentPagingIterator,
      segmentService: this.segmentService,
      onProgress: options?.onProgress,
      translationAuditFlush: this.translationAuditFlush,
      cancellationToken: options?.cancellationToken,
    });
  }

  public async aiTranslateSegment(
    segmentId: string,
    options?: {
      model?: string;
    },
  ) {
    return runSegmentTranslation(
      segmentId,
      options,
      this.createSegmentWorkflowDeps(),
      this.segmentWorkflow.withSegmentLock,
    );
  }

  public async aiRefineSegment(
    segmentId: string,
    instruction: string,
    options?: {
      model?: string;
    },
  ) {
    return runSegmentRefinement(
      segmentId,
      instruction,
      options,
      this.createSegmentWorkflowDeps(),
      this.segmentWorkflow.withSegmentLock,
    );
  }

  public async aiTestTranslate(projectId: number, sourceText: string, contextText?: string) {
    return runTestTranslation(projectId, sourceText, contextText, {
      projectRepo: this.projectRepo,
      providerCatalogService: this.providerCatalogService,
      aiRuntimeConfigProvider: this.aiRuntimeConfigProvider,
      textTranslator: this.textTranslator,
    });
  }

  private createSegmentWorkflowDeps() {
    return {
      projectRepo: this.projectRepo,
      segmentRepo: this.segmentRepo,
      segmentService: this.segmentService,
      providerCatalogService: this.providerCatalogService,
      aiRuntimeConfigProvider: this.aiRuntimeConfigProvider,
      textTranslator: this.textTranslator,
      resolveTranslationPromptReferences: (projectId: number, segment: Segment) =>
        this.resolveTranslationPromptReferences(projectId, segment),
    };
  }

  private async resolveTranslationPromptReferences(
    projectId: number,
    segment: Segment,
  ): Promise<TranslationPromptReferences> {
    return resolveTranslationPromptReferences({
      projectId,
      segment,
      resolvers: this.promptReferenceResolvers,
    });
  }
}
