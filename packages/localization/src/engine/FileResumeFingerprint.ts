import { createHash } from 'crypto';
import type { MTModule } from '../modules/MTModule';
import type { ProjectRecord, TBRepository, TMRepository } from '../ports';
import { tagPolicyFingerprintValue } from '../tagPolicy';
import type { LocalizationEngineConstructorOptions, TranslateFileInput } from '../types';
import {
  mergeMTOptions,
  resolveLocalizationMode,
  resolveWindowTargetBaseline,
} from './localizationEngineOptions';

export async function buildFileTranslationResumeFingerprint(params: {
  input: TranslateFileInput;
  project: ProjectRecord;
  options: LocalizationEngineConstructorOptions;
  mtModule: Pick<MTModule, 'resolvePromptConfig'>;
  tmRepo: Pick<TMRepository, 'getProjectMountedTMs' | 'getTMStats'>;
  tbRepo: Pick<TBRepository, 'getProjectMountedTermBases' | 'getTermBaseStats'>;
}): Promise<string> {
  const { input, project, options, mtModule, tmRepo, tbRepo } = params;
  const targetBaseline = resolveWindowTargetBaseline(input.options, options);
  const mode = resolveLocalizationMode(input.options?.mode, options);
  const mtOptions = mergeMTOptions(options.mt, input.options?.mt);
  const mtConfig = await mtModule.resolvePromptConfig(
    project,
    mtOptions,
    input.options?.providerOverride,
  );
  const mountedTMs = tmRepo
    .getProjectMountedTMs(project.id)
    .map((tm) => {
      const stats = tmRepo.getTMStats(tm.id);
      return {
        id: tm.id,
        srcLang: tm.srcLang,
        tgtLang: tm.tgtLang,
        type: tm.type,
        priority: tm.priority,
        permission: tm.permission,
        isEnabled: tm.isEnabled,
        updatedAt: tm.updatedAt,
        entryCount: stats.entryCount,
        maxEntryUpdatedAt: stats.maxEntryUpdatedAt,
      };
    })
    .sort(compareResourceFingerprint);
  const mountedTBs = tbRepo
    .getProjectMountedTermBases(project.id)
    .map((tb) => {
      const stats = tbRepo.getTermBaseStats(tb.id);
      return {
        id: tb.id,
        srcLang: tb.srcLang,
        tgtLang: tb.tgtLang,
        priority: tb.priority,
        isEnabled: tb.isEnabled,
        updatedAt: tb.updatedAt,
        entryCount: stats.entryCount,
        maxEntryUpdatedAt: stats.maxEntryUpdatedAt,
      };
    })
    .sort(compareResourceFingerprint);

  return hashCanonicalPayload([
    ['project.id', project.id],
    ['project.srcLang', project.srcLang],
    ['project.tgtLang', project.tgtLang],
    ['project.type', project.projectType ?? 'translation'],
    ['targetBaseline', targetBaseline],
    ['mode', mode],
    ['requestMode', input.options?.requestMode ?? 'window-partial'],
    ['tagPolicy', tagPolicyFingerprintValue(input.options?.tagPolicy)],
    ['provider.id', mtConfig.provider.id],
    ['provider.kind', mtConfig.provider.kind],
    ['provider.protocol', mtConfig.provider.protocol],
    ['provider.baseUrl', mtConfig.provider.baseUrl],
    ['model', mtConfig.model],
    ['reasoningEffort', mtConfig.reasoningEffort],
    ['temperature', mtOptions.temperature],
    ['projectPrompt', mtOptions.systemPrompt ?? project.aiPrompt ?? ''],
    ['mountedTMs', mountedTMs],
    ['mountedTBs', mountedTBs],
  ]);
}

function hashCanonicalPayload(entries: Array<[string, unknown]>): string {
  const payload = entries.filter(([, value]) => value !== undefined);
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function compareResourceFingerprint(
  left: { id: string; priority: number },
  right: { id: string; priority: number },
): number {
  return left.priority - right.priority || left.id.localeCompare(right.id);
}
