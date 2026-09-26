import { normalizeSegmentStatus, type SegmentStatus } from '@cat/core/models';
import {
  translateProjectSegment,
  testProjectText,
  type SegmentTranslationDependencies,
} from '@cat/localization';
import { resolveFileTagPolicy } from '../../../../shared/fileTagPolicy';
import type { ProjectRepository, SegmentRepository } from '../../ports';
import type { SegmentService } from '../../SegmentService';

interface SegmentWorkflowDeps extends SegmentTranslationDependencies {
  projectRepo: ProjectRepository;
  segmentRepo: SegmentRepository;
  segmentService: SegmentService;
}

interface SegmentWorkflowOptions {
  model?: string;
}
interface WithSegmentLock {
  <T>(segmentId: string, task: () => Promise<T>): Promise<T>;
}

export function runSegmentTranslation(
  segmentId: string,
  options: SegmentWorkflowOptions | undefined,
  deps: SegmentWorkflowDeps,
  withSegmentLock: WithSegmentLock,
) {
  return runSegmentOperation(segmentId, options, deps, withSegmentLock);
}

export function runSegmentRefinement(
  segmentId: string,
  instruction: string,
  options: SegmentWorkflowOptions | undefined,
  deps: SegmentWorkflowDeps,
  withSegmentLock: WithSegmentLock,
) {
  return runSegmentOperation(segmentId, options, deps, withSegmentLock, instruction);
}

async function runSegmentOperation(
  segmentId: string,
  options: SegmentWorkflowOptions | undefined,
  deps: SegmentWorkflowDeps,
  withSegmentLock: WithSegmentLock,
  instruction?: string,
): Promise<{ segmentId: string; status: SegmentStatus }> {
  return withSegmentLock(segmentId, async () => {
    const segment = deps.segmentRepo.getSegment(segmentId);
    if (!segment) throw new Error('Segment not found');
    const file = deps.projectRepo.getFile(segment.fileId);
    if (!file) throw new Error('File not found');
    const project = deps.projectRepo.getProject(file.projectId);
    if (!project) throw new Error('Project not found');
    const targetTokens = await translateProjectSegment(
      project,
      segment,
      resolveFileTagPolicy(file),
      deps,
      options?.model,
      instruction,
    );
    const status = normalizeSegmentStatus('draft', targetTokens);
    const updateResult = await deps.segmentService.updateSegment(
      segment.segmentId,
      targetTokens,
      status,
    );

    return {
      fileId: updateResult?.fileId ?? segment.fileId,
      segmentId: segment.segmentId,
      targetTokens,
      status,
      propagatedIds: updateResult?.propagatedIds ?? [],
      serverAppliedAt: updateResult?.serverAppliedAt ?? new Date().toISOString(),
    };
  });
}

export function runTestTranslation(
  projectId: number,
  sourceText: string,
  contextText: string | undefined,
  deps: Pick<
    SegmentWorkflowDeps,
    'projectRepo' | 'providerCatalogService' | 'aiRuntimeConfigProvider' | 'textTranslator'
  >,
) {
  return testProjectText(deps.projectRepo.getProject(projectId), sourceText, contextText, deps);
}

export function createSegmentOperationLock(): {
  withSegmentLock: WithSegmentLock;
} {
  const locks = new Set<string>();

  return {
    withSegmentLock: async <T>(segmentId: string, task: () => Promise<T>): Promise<T> => {
      if (locks.has(segmentId)) {
        throw new Error('AI request already in progress for this segment');
      }
      locks.add(segmentId);
      try {
        return await task();
      } finally {
        locks.delete(segmentId);
      }
    },
  };
}
