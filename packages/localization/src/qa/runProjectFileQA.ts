import type { Segment, TBMatch } from '@cat/core/models';
import { DEFAULT_PROJECT_QA_SETTINGS, type FileQaReport } from '@cat/core/project';
import type { ProjectRepository, SegmentRepository } from '../ports';
import { resolveStoredFileTagPolicy } from '../tagPolicy';
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
  const tagPolicy = resolveStoredFileTagPolicy(file);
  const importOptionsJson = file.importOptionsJson;
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
  const content = (rows: Segment[]) =>
    JSON.stringify(rows.map((row) => [row.segmentId, row.sourceTokens, row.targetTokens]));
  const originalContent = content(segments);
  const originalSettings = JSON.stringify(settings);
  const report = await runQA({
    segments,
    settings,
    sourceLocale: project.srcLang,
    targetLocale: project.tgtLang,
    evaluate: input.evaluate,
    tagPolicy,
    resolveTermMatches: (segment) => input.resolveTermMatches(project.id, segment),
  });
  const issuesBySegment = new Map<string, FileQaReport['issues']>();
  for (const issue of report.issues) {
    const list = issuesBySegment.get(issue.segmentId) ?? [];
    list.push(issue);
    issuesBySegment.set(issue.segmentId, list);
  }
  const stale = input.transaction(() => {
    // Reject changed revisions before doing a full reread under the write lock.
    if (input.getRevision?.() !== revision) return true;
    const currentFile = projectRepo.getFile(fileId);
    const currentProject = projectRepo.getProject(project.id);
    if (
      !currentFile ||
      currentFile.importOptionsJson !== importOptionsJson ||
      !currentProject ||
      currentProject.srcLang !== project.srcLang ||
      currentProject.tgtLang !== project.tgtLang ||
      JSON.stringify(currentProject.qaSettings || DEFAULT_PROJECT_QA_SETTINGS) !== originalSettings
    )
      return true;
    const current = readSegments();
    if (content(current) !== originalContent) return true;
    for (const segment of current) {
      const issues = issuesBySegment.get(segment.segmentId) ?? [];
      if (JSON.stringify(segment.qaIssues) !== JSON.stringify(issues))
        segmentRepo.updateSegmentQaIssues(segment.segmentId, issues);
    }
    return false;
  });
  return { ...report, fileId, ...(stale ? { stale: true } : {}) };
}
