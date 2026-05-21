import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { serializeTokensToDisplayText } from '@cat/core/text';
import { runBounded } from '../../RequestScheduler';
import type { MTModule, ResolvedMTConfig } from '../../modules/MTModule';
import type {
  ExternalTranslationUnit,
  LocalizationEngineOptions,
  TranslateUnitResult,
  TranslateUnitsResult,
} from '../../types';
import type { RequestModeReferenceModules } from '../types';
import {
  emptyReferencesForUnit,
  resolveRequestModeReferences,
} from '../shared/references';
import { buildTranslateUnitsResult } from '../shared/results';

export interface LegacySingleUnitConcurrentStrategyDependencies
  extends RequestModeReferenceModules {
  mtModule: Pick<MTModule, 'translate'>;
}

export interface PreparedLegacyUnit {
  unit: ExternalTranslationUnit;
  segment: Segment;
}

export interface LegacySingleUnitConcurrentStrategyInput {
  project: Project;
  mtConfig: ResolvedMTConfig;
  mtOptions: NonNullable<LocalizationEngineOptions['mt']>;
  includeReferences: boolean;
  maxConcurrency?: number;
  units: PreparedLegacyUnit[];
}

export class LegacySingleUnitConcurrentStrategy {
  private readonly dependencies: LegacySingleUnitConcurrentStrategyDependencies;

  constructor(dependencies: LegacySingleUnitConcurrentStrategyDependencies) {
    this.dependencies = dependencies;
  }

  async translateUnits(
    input: LegacySingleUnitConcurrentStrategyInput,
  ): Promise<TranslateUnitsResult> {
    const scheduledResults = await runBounded(
      input.units,
      (prepared) => this.translatePreparedUnit(input, prepared),
      { maxConcurrency: input.maxConcurrency },
    );

    const results = scheduledResults.map((result, index): TranslateUnitResult => {
      if (result.status === 'fulfilled') {
        return result.value;
      }

      const unit = input.units[index].unit;
      return {
        id: unit.id,
        source: unit.source,
        target: unit.target,
        status: 'failed',
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        metadata: unit.metadata,
      };
    });

    return buildTranslateUnitsResult(results);
  }

  private async translatePreparedUnit(
    input: LegacySingleUnitConcurrentStrategyInput,
    prepared: PreparedLegacyUnit,
  ): Promise<TranslateUnitResult> {
    const projectType = input.project.projectType ?? 'translation';
    const references =
      projectType === 'translation'
        ? await resolveRequestModeReferences({
            projectId: input.project.id,
            segment: prepared.segment,
            tmModule: this.dependencies.tmModule,
            tbModule: this.dependencies.tbModule,
          })
        : emptyReferencesForUnit({ unitId: prepared.unit.id }, prepared.segment);
    const { targetTokens } = await this.dependencies.mtModule.translate({
      unitId: prepared.unit.id,
      project: input.project,
      segment: prepared.segment,
      tm: references.tm,
      tb: references.tb,
      mtOptions: input.mtOptions,
      apiKey: input.mtConfig.apiKey,
      baseUrl: input.mtConfig.provider.baseUrl,
      model: input.mtConfig.model,
      reasoningEffort: input.mtConfig.reasoningEffort,
      provider: input.mtConfig.provider,
      srcLang: prepared.unit.sourceLanguage ?? input.project.srcLang,
      tgtLang: prepared.unit.targetLanguage ?? input.project.tgtLang,
    });

    return {
      id: prepared.unit.id,
      source: prepared.unit.source,
      target: serializeTokensToDisplayText(targetTokens),
      status: 'translated',
      references: input.includeReferences ? references.engineReferences : undefined,
      metadata: prepared.unit.metadata,
    };
  }
}
