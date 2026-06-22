import type { Segment } from '@cat/core/models';
import type { Project } from '@cat/core/project';
import { parseDisplayTextToTokens } from '@cat/core/tag';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type {
  LocalizationEngine,
  TranslateProjectSegmentsInput,
  TranslateUnitResult,
} from '@cat/localization';
import type { AIBatchTargetBaseline } from '../../../../shared/ipc';
import { SegmentService } from '../../SegmentService';
import { getAIProgressVerb } from './aiProgressVerb';
import { logAIBatchDebug } from './aiBatchDebug';
import { SegmentPagingIterator } from './SegmentPagingIterator';

export interface LocalizationFileTranslationParams {
  fileId: number;
  fileName: string;
  project: Project;
  targetBaseline: AIBatchTargetBaseline;
  providerId?: string | null;
  localizationEngine: Pick<LocalizationEngine, 'translateProjectSegments'>;
  segmentPagingIterator: SegmentPagingIterator;
  segmentService: SegmentService;
  onProgress?: (data: { current: number; total: number; message?: string }) => void;
  translationAuditFlush?: () => Promise<void> | void;
}

export async function runLocalizationFileTranslation(
  params: LocalizationFileTranslationParams,
): Promise<{ translated: number; skipped: number; failed: number; total: number }> {
  const segments = Array.from(params.segmentPagingIterator.iterateFileSegments(params.fileId));
  const segmentsById = new Map(segments.map((segment) => [segment.segmentId, segment]));
  const units = segments.map(mapSegmentToLocalizationUnit);
  const providerId = params.providerId?.trim();

  logAIBatchDebug({
    event: 'localization_file_start',
    mode: 'localization',
    requestMode: 'window-partial',
    fileId: params.fileId,
    projectId: params.project.id,
    projectType: params.project.projectType || 'translation',
    targetBaseline: params.targetBaseline,
    totalSegments: segments.length,
    providerId,
  });

  let summary: Awaited<ReturnType<LocalizationEngine['translateProjectSegments']>>;
  let translationFailed = false;
  try {
    summary = await params.localizationEngine.translateProjectSegments({
      projectId: params.project.id,
      documentId: `file-${params.fileId}:${params.fileName}`,
      units,
      options: {
        mode: 'standard',
        requestMode: 'window-partial',
        targetBaseline: params.targetBaseline,
        ...(providerId ? { mt: { providerId } } : {}),
      },
      onResult: async (unitResult) => {
        await applyLocalizationUnitResult(unitResult, segmentsById, params.segmentService);
      },
      onProgress: (progress) => {
        params.onProgress?.({
          current: progress.current,
          total: progress.total,
          message: `${getAIProgressVerb(params.project.projectType || 'translation')} segment ${progress.current} of ${progress.total}`,
        });
      },
    });
  } catch (error) {
    translationFailed = true;
    throw error;
  } finally {
    if (translationFailed) {
      try {
        await params.translationAuditFlush?.();
      } catch {
        // Preserve the original translation failure if audit flushing also fails.
      }
    } else {
      await params.translationAuditFlush?.();
    }
  }

  const reused = summary.summary.reused ?? 0;
  const result = {
    translated: summary.summary.translated + reused,
    skipped: summary.summary.skipped,
    failed: summary.summary.failed,
    total: segments.length,
  };

  logAIBatchDebug({
    event: 'localization_file_complete',
    mode: 'localization',
    requestMode: 'window-partial',
    fileId: params.fileId,
    projectId: params.project.id,
    translated: result.translated,
    skipped: result.skipped,
    failed: result.failed,
    total: result.total,
  });

  return result;
}

function mapSegmentToLocalizationUnit(
  segment: Segment,
): TranslateProjectSegmentsInput['units'][number] {
  const context = segment.meta?.context ? String(segment.meta.context).trim() : '';
  const target = serializeTokensToDisplayText(segment.targetTokens);

  return {
    id: segment.segmentId,
    source: serializeTokensToDisplayText(segment.sourceTokens),
    target,
    ...(context ? { context } : {}),
    rowNumber: segment.orderIndex + 1,
    ...(segment.status === 'confirmed' ? { locked: true } : {}),
    metadata: {
      segmentId: segment.segmentId,
      orderIndex: segment.orderIndex,
      status: segment.status,
    },
  };
}

async function applyLocalizationUnitResult(
  unitResult: TranslateUnitResult,
  segmentsById: Map<string, Segment>,
  segmentService: SegmentService,
): Promise<void> {
  if (unitResult.status !== 'translated' && unitResult.status !== 'reused') {
    return;
  }

  const segment = segmentsById.get(unitResult.id);
  if (!segment) {
    return;
  }

  await segmentService.updateSegment(
    segment.segmentId,
    parseDisplayTextToTokens(unitResult.target),
    'translated',
  );
}
