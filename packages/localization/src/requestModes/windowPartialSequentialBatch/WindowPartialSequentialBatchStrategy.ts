import type { Project } from '@cat/core/project';
import type { TagPolicy } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { LocalizationEngineOptions } from '../../types';
import type {
  ArtifactRecord,
  TaskExecutionContext,
  TranslationTask,
  UnitResult,
} from '../../job/types';
import type { MTModule, ResolvedMTConfig } from '../../modules/MTModule';
import type {
  PreparedTranslatableJobUnit,
  PreparedWindowBatchResult,
  RequestModeReferenceModules,
} from '../types';
import {
  emptyReferencesForUnit,
  type RequestModeReferenceResolver,
  resolveRequestModeReferences,
} from '../shared/references';
import { toArtifactRecord } from '../shared/results';
import { requestResponseId, unitKey } from '../shared/unitIdentity';
import { buildWindowPartialReadOnlyContextRows } from '../shared/windowPartialContextBuilder';

export interface WindowPartialSequentialBatchStrategyDependencies
  extends RequestModeReferenceModules {
  mtModule: Pick<MTModule, 'translateBatch'>;
}

export interface WindowPartialSequentialBatchStrategyInput {
  task: TranslationTask;
  context: TaskExecutionContext;
  project: Project;
  mtConfig: ResolvedMTConfig;
  mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
  tagPolicy: TagPolicy;
  includeReferences: boolean;
  captureArtifacts: boolean;
  translatableUnits: PreparedTranslatableJobUnit[];
  skippedResults: UnitResult[];
  referenceResolver?: RequestModeReferenceResolver;
}

export class WindowPartialSequentialBatchStrategy {
  private readonly dependencies: WindowPartialSequentialBatchStrategyDependencies;

  constructor(dependencies: WindowPartialSequentialBatchStrategyDependencies) {
    this.dependencies = dependencies;
  }

  async translate(input: WindowPartialSequentialBatchStrategyInput): Promise<PreparedWindowBatchResult> {
    if (!input.task.requestUnitKeys) {
      throw new Error('Window Partial task is missing requestUnitKeys.');
    }

    const requestKeys = new Set(input.task.requestUnitKeys);
    const requestUnits = input.translatableUnits.filter(({ jobUnit }) =>
      requestKeys.has(unitKey(jobUnit)),
    );
    const projectType = input.project.projectType ?? 'translation';
    const resolveReferences = input.referenceResolver ?? resolveRequestModeReferences;
    const resolvedUnits = await Promise.all(
      requestUnits.map(async ({ jobUnit, segment }) => {
        const references =
          projectType === 'translation'
            ? await resolveReferences({
                projectId: input.project.id,
                segment,
                tmModule: this.dependencies.tmModule,
                tbModule: this.dependencies.tbModule,
              })
            : emptyReferencesForUnit(jobUnit, segment);

        return { jobUnit, segment, references };
      }),
    );
    const resolvedBatchUnits = resolvedUnits.map((unit, index) => ({
      ...unit,
      responseId: requestResponseId(index),
    }));
    const current = resolvedBatchUnits.map(({ jobUnit, segment, references, responseId }) => ({
      responseId,
      documentId: jobUnit.documentId,
      unitId: jobUnit.unitId,
      rowNumber: jobUnit.rowNumber,
      segment,
      tm: references.tm,
      tb: references.tb,
      context: jobUnit.context,
    }));
    const readOnlyContextRows = buildWindowPartialReadOnlyContextRows({
      jobUnits: input.context.job.units,
      scanWindowUnits: input.task.scanWindowUnits ?? input.task.units,
      requestUnitKeys: input.task.requestUnitKeys,
      completedResults: input.context.completedResults,
      skippedResults: input.skippedResults,
    });
    const meta = current[0]?.segment.meta as
      | ({ sourceLanguage?: unknown; targetLanguage?: unknown })
      | undefined;
    const batch = await this.dependencies.mtModule.translateBatch({
      taskId: input.task.taskId,
      project: input.project,
      requestMode: 'window-partial',
      current,
      previousContext: [],
      nextContext: [],
      readOnlyContextRows,
      scanWindowCount: (input.task.scanWindowUnits ?? input.task.units).length,
      mtOptions: input.mtOptions,
      apiKey: input.mtConfig.apiKey,
      baseUrl: input.mtConfig.provider.baseUrl,
      model: input.mtConfig.model,
      reasoningEffort: input.mtConfig.reasoningEffort,
      provider: input.mtConfig.provider,
      tagPolicy: input.tagPolicy,
      srcLang: meta?.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta?.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
      ...(input.context.auditSink
        ? { audit: { jobId: input.context.job.id, sink: input.context.auditSink } }
        : {}),
    });
    const batchResultsByResponseId = new Map(
      batch.results.map((result) => [result.responseId, result]),
    );
    const results: UnitResult[] = [];
    const artifacts: ArtifactRecord[] | undefined = input.captureArtifacts ? [] : undefined;

    for (const { jobUnit, references, responseId } of resolvedBatchUnits) {
      const batchResult = batchResultsByResponseId.get(responseId);
      if (!batchResult) {
        throw new Error(`MT batch did not return a result for unit: ${jobUnit.unitId}`);
      }

      const result: UnitResult = {
        jobId: input.context.job.id,
        documentId: jobUnit.documentId,
        unitId: jobUnit.unitId,
        sourceHash: jobUnit.sourceHash,
        status: 'translated',
        source: jobUnit.source,
        target: serializeTokensToDisplayText(batchResult.targetTokens),
        references: input.includeReferences ? references.engineReferences : undefined,
        metadata: jobUnit.metadata,
      };
      results.push(result);
      artifacts?.push(
        toArtifactRecord(input.context.job.id, input.task.taskId, jobUnit, result, {
          tm: references.tm,
          tb: references.tb,
          prompt: batchResult.prompt ?? batch.prompt,
        }),
      );
    }

    return { results, artifacts };
  }
}
