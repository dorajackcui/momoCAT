import { normalizeProjectAIModel } from '@cat/core/project';
import type { CATDatabase } from '@cat/db';
import { buildFileTranslationResumeFingerprint } from './engine/FileResumeFingerprint';
import {
  createLocalizationEngineAssembly,
  type LocalizationEngineAssembly,
} from './engine/LocalizationEngineAssembly';
import { mergeMTOptions, normalizeWindowJobOptions } from './engine/localizationEngineOptions';
import {
  prepareJobTranslationUnit,
  unitResultToPublicResult,
} from './engine/LocalizationUnitPreparation';
import { translateSpreadsheetFileJob } from './fileTranslationJobAdapter';
import { translateProjectSegmentsJob } from './projectSegmentJobAdapter';
import { RuntimeTMContext, RuntimeTMReferenceResolver } from './runtimeTm';
import { resolveTagPolicy } from './tagPolicy';
import { unitKey } from './requestModes/shared/unitIdentity';
import type { RequestModeReferenceResolver } from './requestModes/shared/references';
import {
  jobUnitToExternalUnit,
  toArtifactRecord,
  toUnitResult,
} from './requestModes/shared/results';
import type { PreparedTranslatableJobUnit } from './requestModes/types';
import type {
  ArtifactRecord,
  TaskExecutionContext,
  TaskExecutionResult,
  TranslationTask,
  TranslationTaskExecutor,
  UnitResult,
} from './job/types';
import type {
  LocalizationEngineConstructorOptions,
  LocalizationEngineProfile,
  TranslateFileInput,
  TranslateFileResult,
  TranslateProjectSegmentsInput,
  TranslateUnitsResult,
} from './types';

export type { LocalizationEngineConstructorOptions } from './types';

export interface LocalizationTaskExecutorOptions {
  referenceResolver?: RequestModeReferenceResolver;
}

export class LocalizationEngine {
  private readonly assembly: LocalizationEngineAssembly;
  private readonly options: LocalizationEngineConstructorOptions;

  constructor(db: CATDatabase, options: LocalizationEngineConstructorOptions) {
    this.options = options;
    this.assembly = createLocalizationEngineAssembly(db, options);
  }

  public async inspectProject(projectId: number): Promise<LocalizationEngineProfile> {
    const project = this.assembly.projectRepo.getProject(projectId);
    if (!project) {
      return {
        projectId,
        projectName: '',
        srcLang: '',
        tgtLang: '',
        promptChars: 0,
        model: null,
        apiKeySet: false,
        mountedTMCount: 0,
        mountedTBCount: 0,
        ready: false,
        errors: ['Project not found'],
      };
    }

    const errors: string[] = [];
    let model: string | null = null;
    let apiKeySet = false;
    const providerId = this.options.mt?.providerId ?? project.aiModel;

    try {
      const config = await this.assembly.mtModule.resolveConfig(project, this.options.mt);
      model = config.model;
      apiKeySet = config.apiKey.trim().length > 0;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      const normalizedProviderId = normalizeProjectAIModel(providerId);
      const provider = this.assembly.providerCatalogService
        .listProviders()
        .find((candidate) => candidate.id === normalizedProviderId);
      model = this.options.mt?.model ?? provider?.model ?? null;
      apiKeySet = Boolean(provider?.apiKeyLast4);
    }

    return {
      projectId: project.id,
      projectName: project.name,
      srcLang: project.srcLang,
      tgtLang: project.tgtLang,
      promptChars: project.aiPrompt?.length ?? 0,
      model,
      apiKeySet,
      mountedTMCount: this.assembly.tmRepo.getProjectMountedTMs(projectId).length,
      mountedTBCount: this.assembly.tbRepo.getProjectMountedTermBases(projectId).length,
      ready: errors.length === 0,
      errors,
    };
  }

  public createTaskExecutor(
    options: LocalizationTaskExecutorOptions = {},
  ): TranslationTaskExecutor {
    return (task, context) => this.executeTranslationTask(task, context, options);
  }

  public async executeTranslationTask(
    task: TranslationTask,
    context: TaskExecutionContext,
    options: LocalizationTaskExecutorOptions = {},
  ): Promise<TaskExecutionResult> {
    const project = this.assembly.projectRepo.getProject(context.job.projectId);
    if (!project) {
      throw new Error(`Project not found: ${context.job.projectId}`);
    }

    const translationOptions = context.job.translationOptions;

    const tagPolicy = resolveTagPolicy(translationOptions?.tagPolicy);
    const preparedUnits = task.units.map((unit, index) =>
      prepareJobTranslationUnit(jobUnitToExternalUnit(unit), index, project, tagPolicy),
    );
    const hasTranslatableUnits = preparedUnits.some((prepared) => prepared.kind === 'translatable');
    const captureArtifacts = context.captureArtifacts !== false;
    const results: Array<UnitResult | undefined> = [];
    const artifacts: ArtifactRecord[] | undefined = captureArtifacts ? [] : undefined;
    const skippedResults: UnitResult[] = [];
    const translatableUnits: PreparedTranslatableJobUnit[] = [];

    for (let index = 0; index < preparedUnits.length; index += 1) {
      const jobUnit = task.units[index];
      const prepared = preparedUnits[index];

      if (!jobUnit || !prepared) {
        continue;
      }

      if (prepared.kind === 'skipped') {
        const result = toUnitResult(context.job.id, jobUnit, prepared.result);
        results[index] = result;
        skippedResults.push(result);
        artifacts?.push(toArtifactRecord(context.job.id, task.taskId, jobUnit, result));
        continue;
      }

      translatableUnits.push({ jobUnit, segment: prepared.segment });
    }

    if (!hasTranslatableUnits || translatableUnits.length === 0) {
      return { results: results.flatMap((result) => (result ? [result] : [])), artifacts };
    }

    const mtOptions = mergeMTOptions(this.options.mt, translationOptions?.mt);
    const mtConfig = await this.assembly.mtModule.resolveConfig(
      project,
      mtOptions,
      translationOptions?.providerOverride,
    );
    const requestMode = task.requestMode ?? translationOptions?.requestMode ?? 'window';
    const strategy =
      requestMode === 'window-partial'
        ? this.assembly.windowPartialStrategy
        : this.assembly.windowModeStrategy;
    const translated = await strategy.translate({
      task,
      context,
      project,
      mtConfig,
      mtOptions,
      tagPolicy,
      includeReferences: Boolean(translationOptions?.includeReferences),
      captureArtifacts,
      translatableUnits,
      skippedResults,
      referenceResolver: options.referenceResolver,
    });
    const translatedByKey = new Map(translated.results.map((result) => [unitKey(result), result]));

    for (let index = 0; index < task.units.length; index += 1) {
      if (results[index]) {
        continue;
      }
      const translatedResult = translatedByKey.get(unitKey(task.units[index]));
      if (translatedResult) {
        results[index] = translatedResult;
      }
    }
    artifacts?.push(...(translated.artifacts ?? []));

    return { results: results.flatMap((result) => (result ? [result] : [])), artifacts };
  }

  public async translateFile(input: TranslateFileInput): Promise<TranslateFileResult> {
    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);

    const project = this.assembly.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }
    const normalizedOptions = normalizeWindowJobOptions(input.options);
    const normalizedInput = { ...input, options: normalizedOptions };
    const resumeFingerprint = await buildFileTranslationResumeFingerprint({
      input: normalizedInput,
      project,
      options: this.options,
      mtModule: this.assembly.mtModule,
      tmRepo: this.assembly.tmRepo,
      tbRepo: this.assembly.tbRepo,
    });
    const runtimeTm =
      (project.projectType ?? 'translation') === 'translation'
        ? RuntimeTMContext.create({
            srcLang: project.srcLang,
            tgtLang: project.tgtLang,
            tagPolicy,
          })
        : undefined;
    const referenceResolver = runtimeTm
      ? new RuntimeTMReferenceResolver(runtimeTm).resolve
      : undefined;

    try {
      return await translateSpreadsheetFileJob(
        {
          ...normalizedInput,
          job: {
            ...input.job,
            resumeFingerprint,
          },
        },
        {
          taskExecutor: this.createTaskExecutor({ referenceResolver }),
          runtimeTm: runtimeTm
            ? {
                seed: (results) => {
                  runtimeTm.seedResults(results);
                },
                commit: (results) => {
                  runtimeTm.commitResults(results);
                },
                summary: () => runtimeTm.summary(),
              }
            : undefined,
          auditSink: this.options.auditSink,
        },
      );
    } finally {
      runtimeTm?.dispose();
    }
  }

  public async translateProjectSegments(
    input: TranslateProjectSegmentsInput,
  ): Promise<TranslateUnitsResult> {
    const project = this.assembly.projectRepo.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const tagPolicy = resolveTagPolicy(input.options?.tagPolicy);
    const runtimeTm =
      (project.projectType ?? 'translation') === 'translation'
        ? RuntimeTMContext.create({
            srcLang: project.srcLang,
            tgtLang: project.tgtLang,
            tagPolicy,
          })
        : undefined;
    const referenceResolver = runtimeTm
      ? new RuntimeTMReferenceResolver(runtimeTm).resolve
      : undefined;
    const normalizedOptions = normalizeWindowJobOptions(input.options);

    try {
      return await translateProjectSegmentsJob(
        {
          projectId: input.projectId,
          documentId: input.documentId,
          units: input.units,
          options: {
            ...normalizedOptions,
            requestMode: normalizedOptions.requestMode ?? 'window-partial',
          },
          job: input.job,
        },
        {
          taskExecutor: this.createTaskExecutor({ referenceResolver }),
          runtimeTm: runtimeTm
            ? {
                seed: (results) => {
                  runtimeTm.seedResults(results);
                },
                commit: (results) => {
                  runtimeTm.commitResults(results);
                },
                summary: () => runtimeTm.summary(),
              }
            : undefined,
          auditSink: this.options.auditSink,
          applyResult: input.onResult
            ? (result) => input.onResult?.(unitResultToPublicResult(result))
            : undefined,
          onProgress: input.onProgress,
          cancellationToken: input.cancellationToken,
        },
      );
    } finally {
      runtimeTm?.dispose();
    }
  }
}
