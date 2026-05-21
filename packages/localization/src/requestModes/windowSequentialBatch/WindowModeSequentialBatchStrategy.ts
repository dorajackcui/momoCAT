import type { Project } from '@cat/core/project';
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
import { buildWindowModeContext, mergeCompletedResults } from '../shared/contextWindowBuilder';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from '../shared/references';
import { toArtifactRecord } from '../shared/results';
import { batchResponseId } from '../shared/unitIdentity';

export interface WindowModeSequentialBatchStrategyDependencies
  extends RequestModeReferenceModules {
  mtModule: Pick<MTModule, 'translateBatch'>;
}

export interface WindowModeSequentialBatchStrategyInput {
  task: TranslationTask;
  context: TaskExecutionContext;
  project: Project;
  mtConfig: ResolvedMTConfig;
  mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
  includeReferences: boolean;
  captureArtifacts: boolean;
  translatableUnits: PreparedTranslatableJobUnit[];
  skippedResults: UnitResult[];
}

export class WindowModeSequentialBatchStrategy {
  private readonly dependencies: WindowModeSequentialBatchStrategyDependencies;

  constructor(dependencies: WindowModeSequentialBatchStrategyDependencies) {
    this.dependencies = dependencies;
  }

  async translate(input: WindowModeSequentialBatchStrategyInput): Promise<PreparedWindowBatchResult> {
    const projectType = input.project.projectType ?? 'translation';
    const resolvedUnits = await Promise.all(
      input.translatableUnits.map(async ({ jobUnit, segment }) => {
        const references =
          projectType === 'translation'
            ? await resolveRequestModeReferences({
                projectId: input.project.id,
                segment,
                tmModule: this.dependencies.tmModule,
                tbModule: this.dependencies.tbModule,
              })
            : emptyReferencesForUnit(jobUnit, segment);

        return { jobUnit, segment, references };
      }),
    );
    const current = resolvedUnits.map(({ jobUnit, segment, references }) => ({
      responseId: batchResponseId(jobUnit),
      documentId: jobUnit.documentId,
      unitId: jobUnit.unitId,
      segment,
      tm: references.tm,
      tb: references.tb,
      context: jobUnit.context,
    }));
    const completedResults = mergeCompletedResults(
      input.context.completedResults,
      input.skippedResults,
    );
    const { previousContext, nextContext } = buildWindowModeContext({
      task: input.task,
      jobUnits: input.context.job.units,
      currentUnits: resolvedUnits.map((unit) => unit.jobUnit),
      completedResults,
    });
    const meta = current[0]?.segment.meta as
      | ({ sourceLanguage?: unknown; targetLanguage?: unknown })
      | undefined;
    const batch = await this.dependencies.mtModule.translateBatch({
      taskId: input.task.taskId,
      project: input.project,
      current,
      previousContext,
      nextContext,
      mtOptions: input.mtOptions,
      apiKey: input.mtConfig.apiKey,
      baseUrl: input.mtConfig.provider.baseUrl,
      model: input.mtConfig.model,
      reasoningEffort: input.mtConfig.reasoningEffort,
      provider: input.mtConfig.provider,
      srcLang: meta?.sourceLanguage ? String(meta.sourceLanguage) : input.project.srcLang,
      tgtLang: meta?.targetLanguage ? String(meta.targetLanguage) : input.project.tgtLang,
    });
    const batchResultsByResponseId = new Map(
      batch.results.map((result) => [result.responseId, result]),
    );
    const results: UnitResult[] = [];
    const artifacts: ArtifactRecord[] | undefined = input.captureArtifacts ? [] : undefined;

    for (const { jobUnit, references } of resolvedUnits) {
      const batchResult = batchResultsByResponseId.get(batchResponseId(jobUnit));
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
          prompt: batch.prompt,
        }),
      );
    }

    return { results, artifacts };
  }
}
