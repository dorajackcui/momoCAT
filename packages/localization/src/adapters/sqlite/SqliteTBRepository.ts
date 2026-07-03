import { CATDatabase } from '@cat/db';
import type { TBRepository } from '../../ports';

export class SqliteTBRepository implements TBRepository {
  constructor(private readonly db: CATDatabase) {}

  listTermBases() {
    return this.db.listTermBases();
  }

  createTermBase(name: string, srcLang: string, tgtLang: string): string {
    return this.db.createTermBase(name, srcLang, tgtLang);
  }

  deleteTermBase(id: string): void {
    this.db.deleteTermBase(id);
  }

  getTermBase(tbId: string) {
    return this.db.getTermBase(tbId);
  }

  getTermBaseStats(tbId: string): { entryCount: number; maxEntryUpdatedAt?: string | null } {
    return this.db.getTermBaseStats(tbId);
  }

  getTBDataVersion(): number {
    return this.db.getTBDataVersion();
  }

  getProjectMountedTermBases(projectId: number) {
    return this.db.getProjectMountedTermBases(projectId);
  }

  mountTermBaseToProject(projectId: number, tbId: string, priority?: number): void {
    this.db.mountTermBaseToProject(projectId, tbId, priority);
  }

  unmountTermBaseFromProject(projectId: number, tbId: string): void {
    this.db.unmountTermBaseFromProject(projectId, tbId);
  }

  listProjectTermEntries(projectId: number) {
    return this.db.listProjectTermEntries(projectId);
  }

  searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ) {
    return this.db.searchProjectTermEntries(projectId, sourceText, options);
  }

  upsertTBEntryBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string {
    return this.db.upsertTBEntryBySrcTerm(params);
  }

  insertTBEntryIfAbsentBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string | undefined {
    return this.db.insertTBEntryIfAbsentBySrcTerm(params);
  }
}
