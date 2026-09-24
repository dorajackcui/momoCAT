import { CATDatabase } from '@cat/db';
import type { Segment } from '@cat/core/models';
import { normalizeQASettings, QA_RULE_GROUPS, type SegmentQaRuleId } from '@cat/core/project';
import { SqliteProjectRepository } from '../adapters/sqlite/SqliteProjectRepository';
import { SqliteTBRepository } from '../adapters/sqlite/SqliteTBRepository';
import { TBService } from '../services/TBService';
import { parseExternalSpreadsheet } from '../modules/FileModule';
import { createTransientSegment } from '../transientSegment';
import { runQA } from '../qa/runQA';

export interface QAFileCommandConfig {
  dbPath: string;
  projectId: number;
  fileId?: number;
  inputPath?: string;
  enabledRuleIds?: string[];
  tagPolicy?: 'default' | 'none';
}

export const QA_CHECK_NAMES = QA_RULE_GROUPS.map((group) => group.id);

export async function runQAFileCommand(config: QAFileCommandConfig) {
  if (Boolean(config.fileId) === Boolean(config.inputPath))
    throw new Error('Specify exactly one of --file-id or --input.');
  if (config.enabledRuleIds?.some((id) => !QA_CHECK_NAMES.includes(id as SegmentQaRuleId)))
    throw new Error('Unknown QA check.');
  const db = new CATDatabase(config.dbPath, { readonly: true, fileMustExist: true });
  try {
    const project = db.getProject(config.projectId);
    if (!project) throw new Error('Project not found');
    const segments: Segment[] = [];
    let tagPolicy = config.tagPolicy;
    if (config.fileId) {
      const file = db.getFile(config.fileId);
      if (!file || file.projectId !== project.id)
        throw new Error('File does not belong to this project.');
      if (file.importOptionsJson) tagPolicy = JSON.parse(file.importOptionsJson).tagPolicy;
      for (let offset = 0; ; offset += 1000) {
        const page = db.getSegmentsPage(file.id, offset, 1000);
        segments.push(...page);
        if (page.length < 1000) break;
      }
    } else {
      const parsed = await parseExternalSpreadsheet({ inputPath: config.inputPath! });
      for (const [index, row] of parsed.artifact.rows.entries()) {
        if (!row.source && !row.target) continue;
        const segment = createTransientSegment(
          {
            id: `${parsed.inputPath}#${parsed.sheetName}#${row.unitId}`,
            source: row.source,
            target: row.target,
            rowNumber: row.rowNumber,
          },
          index,
          {},
          { tagPolicy },
        );
        segment.meta.rowRef = row.rowNumber;
        segments.push(segment);
      }
    }
    const settings = normalizeQASettings(project.qaSettings);
    if (config.enabledRuleIds) settings.enabledRuleIds = config.enabledRuleIds as SegmentQaRuleId[];
    const tb = new TBService(new SqliteProjectRepository(db), new SqliteTBRepository(db));
    return await runQA({
      segments,
      settings,
      sourceLocale: project.srcLang,
      targetLocale: project.tgtLang,
      tagPolicy,
      resolveTermMatches: (segment) => tb.findMatches(project.id, segment),
    });
  } finally {
    db.close();
  }
}
