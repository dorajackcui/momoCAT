import type { Segment } from '@cat/core/models';
import type { AIBatchMode, AIBatchTargetScope } from '../../../../shared/ipc';
import type { AITransport, ProjectRepository, SegmentRepository } from '../../ports';
import { SegmentService } from '../../SegmentService';
import { resolveTranslationPromptReferences } from './promptReferences';
import type { PromptReferenceResolvers, TranslationPromptReferences } from './types';
import { AISettingsService } from './AISettingsService';
import { AITextTranslator } from './AITextTranslator';
import { SegmentPagingIterator } from './SegmentPagingIterator';
import { resolveBatchTargetScope } from './translationTargetScope';
import { runDialogueFileTranslation } from './dialogueTranslationWorkflow';
import { runStandardFileTranslation } from './fileTranslationWorkflow';
import {
  buildSegmentWorkflowDeps,
  createSegmentOperationLock,
  runSegmentRefinement,
  runSegmentTranslation,
  runTestTranslation,
} from './segmentTranslationWorkflow';
import { TagValidator } from '@cat/core/qa';

export interface AITranslateFileOptions {
  model?: string;
  mode?: AIBatchMode;
  targetScope?: AIBatchTargetScope;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
}

export class AITranslationOrchestrator {
  private static readonly TRANSLATION_INTERVAL_MS = 40;

  private readonly tagValidator = new TagValidator();
  private readonly segmentWorkflow = createSegmentOperationLock();

  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly segmentRepo: SegmentRepository,
    private readonly segmentService: SegmentService,
    private readonly transport: AITransport,
    private readonly settingsService: AISettingsService,
    private readonly textTranslator: AITextTranslator,
    private readonly segmentPagingIterator: SegmentPagingIterator,
    private readonly promptReferenceResolvers: PromptReferenceResolvers = {},
  ) {}

  public async aiTranslateFile(
    fileId: number,
    options?: AITranslateFileOptions,
  ): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
    const file = this.projectRepo.getFile(fileId);
    if (!file) throw new Error('File not found');

    const project = this.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');

    const apiKey = this.settingsService.getStoredApiKey();
    if (!apiKey) {
      throw new Error('AI API key is not configured');
    }

    const model = this.textTranslator.resolveModel(options?.model, project.aiModel);
    const temperature = this.textTranslator.resolveTemperature(project.aiTemperature);
    const targetScope = resolveBatchTargetScope(options?.targetScope);

    if ((project.projectType || 'translation') === 'translation' && options?.mode === 'dialogue') {
      return runDialogueFileTranslation({
        fileId,
        project,
        apiKey,
        model,
        temperature,
        targetScope,
        transport: this.transport,
        tagValidator: this.tagValidator,
        textTranslator: this.textTranslator,
        segmentService: this.segmentService,
        segmentPagingIterator: this.segmentPagingIterator,
        resolveTranslationPromptReferences: (projectId, segment) =>
          this.resolveTranslationPromptReferences(projectId, segment),
        onProgress: options?.onProgress,
        intervalMs: AITranslationOrchestrator.TRANSLATION_INTERVAL_MS,
      });
    }

    return runStandardFileTranslation({
      fileId,
      projectId: file.projectId,
      project,
      apiKey,
      model,
      temperature,
      targetScope,
      segmentPagingIterator: this.segmentPagingIterator,
      textTranslator: this.textTranslator,
      segmentService: this.segmentService,
      resolveTranslationPromptReferences: (projectId, segment) =>
        this.resolveTranslationPromptReferences(projectId, segment),
      onProgress: options?.onProgress,
      intervalMs: AITranslationOrchestrator.TRANSLATION_INTERVAL_MS,
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
      settingsService: this.settingsService,
      textTranslator: this.textTranslator,
    });
  }

  private createSegmentWorkflowDeps() {
    return buildSegmentWorkflowDeps({
      projectRepo: this.projectRepo,
      segmentRepo: this.segmentRepo,
      segmentService: this.segmentService,
      settingsService: this.settingsService,
      textTranslator: this.textTranslator,
      resolveTranslationPromptReferences: (projectId, segment) =>
        this.resolveTranslationPromptReferences(projectId, segment),
    });
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
