import type { Segment, TBEntry, TBMatch } from '@cat/core/models';
import {
  findTermPositionsInText,
  serializeTokensToSearchText,
  suppressNestedTermMatches,
} from '@cat/core/text';
import { ProjectRepository, TBRepository } from './ports';

type ProjectTBEntry = TBEntry & {
  tbName: string;
  priority: number;
};

export class TBService {
  private static readonly TB_CANDIDATE_LIMIT = 200;

  private projectRepo: ProjectRepository;
  private db: TBRepository;

  constructor(projectRepo: ProjectRepository, db: TBRepository) {
    this.projectRepo = projectRepo;
    this.db = db;
  }

  public async findMatches(projectId: number, segment: Segment): Promise<TBMatch[]> {
    const sourceText = serializeTokensToSearchText(segment.sourceTokens);
    if (!sourceText.trim()) return [];

    const project = this.projectRepo.getProject(projectId);
    if (!project) return [];

    const searchEntries = this.db.searchProjectTermEntries(projectId, sourceText, {
      srcLang: project.srcLang,
      limit: TBService.TB_CANDIDATE_LIMIT,
    }) as ProjectTBEntry[];
    const entries =
      searchEntries.length > 0
        ? searchEntries
        : (this.db.listProjectTermEntries(projectId) as ProjectTBEntry[]);
    if (entries.length === 0) return [];

    const matches: TBMatch[] = [];
    const seenSrcNorm = new Set<string>();

    for (const entry of entries) {
      if (seenSrcNorm.has(entry.srcNorm)) continue;
      const positions = findTermPositionsInText(sourceText, entry.srcTerm, {
        locale: project.srcLang,
      });
      if (positions.length === 0) continue;

      matches.push({
        ...entry,
        positions,
      });
      seenSrcNorm.add(entry.srcNorm);
    }

    return suppressNestedTermMatches(
      matches.sort((a, b) => {
        if (b.srcTerm.length !== a.srcTerm.length) return b.srcTerm.length - a.srcTerm.length;
        return a.priority - b.priority;
      }),
    );
  }
}
