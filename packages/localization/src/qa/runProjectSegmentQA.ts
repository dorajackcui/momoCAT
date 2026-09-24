import type { Segment, TBMatch } from '@cat/core/models';
import { normalizeQASettings } from '@cat/core/project';
import { evaluateSegmentQa } from '@cat/core/qa';
import type { ProjectRepository, SegmentRepository } from '../ports';

/** Check a saved row and persist into the same result source as document QA. */
export async function runProjectSegmentQA(input: {
  segmentId: string;
  projectRepo: Pick<ProjectRepository, 'getFile' | 'getProject'>;
  segmentRepo: Pick<SegmentRepository, 'getSegment' | 'updateSegmentQaIssues'>;
  resolveTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;
  getRevision: () => string;
  transaction: <T>(work: () => T) => T;
}) {
  const revision = input.getRevision();
  const segment = input.segmentRepo.getSegment(input.segmentId);
  if (!segment) throw new Error('Segment not found');
  const file = input.projectRepo.getFile(segment.fileId);
  const project = file && input.projectRepo.getProject(file.projectId);
  if (!file || !project) throw new Error('Project file not found');
  const settings = normalizeQASettings(project.qaSettings);
  if (!settings.instantQaOnConfirm) return null;
  const termMatches = settings.enabledRuleIds.includes('terminology-consistency')
    ? await input.resolveTermMatches(project.id, segment)
    : [];
  const issues = evaluateSegmentQa(segment, {
    settings,
    termMatches,
    targetLocale: project.tgtLang,
    tagPolicy: file.importOptionsJson ? JSON.parse(file.importOptionsJson).tagPolicy : undefined,
  });
  // Existing results remain valid until a content/configuration/resource mutation clears them.
  // Preserve document evidence generically, without maintaining a second rule-id registry.
  const qaIssues = [
    ...new Map(
      [...(segment.qaIssues ?? []), ...issues].map((issue) => [
        JSON.stringify([issue.ruleId, issue.message, issue.groupId]),
        issue,
      ]),
    ).values(),
  ];
  const stale = input.transaction(() => {
    if (input.getRevision() !== revision) return true;
    input.segmentRepo.updateSegmentQaIssues(segment.segmentId, qaIssues);
    return false;
  });
  return { segment: { ...segment, qaIssues }, stale };
}
