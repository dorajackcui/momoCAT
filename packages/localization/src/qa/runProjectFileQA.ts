import type { Segment, TBMatch } from '@cat/core/models';
import { DEFAULT_PROJECT_QA_SETTINGS, type FileQaReport } from '@cat/core/project';
import type { ProjectRepository, SegmentRepository } from '../ports';
import { runQA, type RunQAInput } from './runQA';

interface ProjectFileQAInput {
  fileId: number;
  projectRepo: Pick<ProjectRepository, 'getFile' | 'getProject'>;
  segmentRepo: Pick<SegmentRepository, 'getSegmentsPage' | 'updateSegmentQaIssues'>;
  resolveTermMatches: (projectId: number, segment: Segment) => Promise<TBMatch[]>;
  evaluate?: RunQAInput['evaluate'];
  transaction: <T>(work: () => T) => T;
  getRevision?: () => string;
}

/** Hosts schedule this workflow; no editor state or transport belongs here. */
export async function runProjectFileQA(input: ProjectFileQAInput): Promise<FileQaReport> {
  const { fileId, projectRepo, segmentRepo } = input;
  const revision = input.getRevision?.();
  const file = projectRepo.getFile(fileId);
  if (!file) throw new Error('File not found');
  const project = projectRepo.getProject(file.projectId);
  if (!project) throw new Error('Project not found');
  const readSegments = () => {
    const rows: Segment[] = [];
    for (let offset = 0; ; offset += 2000) {
      const page = segmentRepo.getSegmentsPage(fileId, offset, 2000);
      rows.push(...page);
      if (page.length < 2000) return rows;
    }
  };
  const segments = readSegments();
  const settings = project.qaSettings || DEFAULT_PROJECT_QA_SETTINGS;
  const report = await runQA({
    segments,
    settings,
    sourceLocale: project.srcLang,
    targetLocale: project.tgtLang,
    evaluate: input.evaluate,
    tagPolicy: file.importOptionsJson ? JSON.parse(file.importOptionsJson).tagPolicy : undefined,
    resolveTermMatches: (segment) => input.resolveTermMatches(project.id, segment),
  });
  const issuesBySegment = new Map<string, FileQaReport['issues']>();
  for (const issue of report.issues) {
    const list = issuesBySegment.get(issue.segmentId) ?? [];
    list.push(issue);
    issuesBySegment.set(issue.segmentId, list);
  }
  const stale = input.transaction(() => {
    const current = readSegments();
    const content = (rows: Segment[]) =>
      JSON.stringify(rows.map((row) => [row.segmentId, row.sourceTokens, row.targetTokens]));
    if (
      input.getRevision?.() !== revision ||
      !projectRepo.getFile(fileId) ||
      content(current) !== content(segments) ||
      JSON.stringify(
        projectRepo.getProject(project.id)?.qaSettings || DEFAULT_PROJECT_QA_SETTINGS,
      ) !== JSON.stringify(settings)
    )
      return true;
    for (const segment of current) {
      const issues = issuesBySegment.get(segment.segmentId) ?? [];
      if (JSON.stringify(segment.qaIssues) !== JSON.stringify(issues))
        segmentRepo.updateSegmentQaIssues(segment.segmentId, issues);
    }
    return false;
  });
  return { ...report, fileId, ...(stale ? { stale: true } : {}) };
}
