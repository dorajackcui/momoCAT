import { CATDatabase } from '@cat/db';
import type { TMEntry } from '@cat/core/models';
import {
  MountedTMRecord,
  TMConcordanceRecallOptions,
  TMFtsReplacement,
  TMRecallOptions,
  TMRecord,
  TMRepository,
} from '../ports';

export class SqliteTMRepository implements TMRepository {
  constructor(private readonly db: CATDatabase) {}

  upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    return this.db.upsertTMEntryBySrcHash(entry);
  }

  insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined {
    return this.db.insertTMEntryIfAbsentBySrcHash(entry);
  }

  applyTMSyncUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number {
    return this.db.applyTMSyncUpdates(tmId, rows);
  }

  insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void {
    this.db.insertTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string): void {
    this.db.replaceTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  replaceTMFtsBatch(rows: TMFtsReplacement[]): void {
    this.db.replaceTMFtsBatch(rows);
  }

  findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    return this.db.findTMEntryByHash(tmId, srcHash);
  }

  searchConcordance(
    projectId: number,
    query: string,
    tmIds?: string[],
  ): Array<TMEntry & { tmId: string }> {
    return this.db.searchConcordance(projectId, query, tmIds) as Array<TMEntry & { tmId: string }>;
  }

  searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): Array<TMEntry & { tmId: string }> {
    return this.db.searchTMRecallCandidates(projectId, sourceText, tmIds, options) as Array<
      TMEntry & { tmId: string }
    >;
  }

  searchTMFuzzyRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options?: TMRecallOptions,
  ): Array<TMEntry & { tmId: string }> {
    return this.db.searchTMFuzzyRecallCandidates(projectId, sourceText, tmIds, options) as Array<
      TMEntry & { tmId: string }
    >;
  }

  searchTMConcordanceRecallCandidates(
    projectId: number,
    queryText: string,
    tmIds?: string[],
    options?: TMConcordanceRecallOptions,
  ): Array<TMEntry & { tmId: string }> {
    return this.db.searchTMConcordanceRecallCandidates(
      projectId,
      queryText,
      tmIds,
      options,
    ) as Array<TMEntry & { tmId: string }>;
  }

  listTMs(type?: 'working' | 'main'): TMRecord[] {
    return this.db.listTMs(type);
  }

  listTMEntries(tmId: string, limit?: number, offset?: number): Array<TMEntry & { tmId: string }> {
    return this.db.listTMEntries(tmId, limit, offset) as Array<TMEntry & { tmId: string }>;
  }

  createTM(name: string, srcLang: string, tgtLang: string, type: 'working' | 'main'): string {
    return this.db.createTM(name, srcLang, tgtLang, type);
  }

  renameTM(id: string, name: string): void {
    this.db.renameTM(id, name);
  }

  deleteTM(id: string): void {
    this.db.deleteTM(id);
  }

  getTM(tmId: string): TMRecord | undefined {
    return this.db.getTM(tmId);
  }

  getTMStats(tmId: string): { entryCount: number; maxEntryUpdatedAt?: string | null } {
    return this.db.getTMStats(tmId);
  }

  getProjectMountedTMs(projectId: number): MountedTMRecord[] {
    return this.db.getProjectMountedTMs(projectId);
  }

  mountTMToProject(projectId: number, tmId: string, priority?: number, permission?: string): void {
    this.db.mountTMToProject(projectId, tmId, priority, permission);
  }

  unmountTMFromProject(projectId: number, tmId: string): void {
    this.db.unmountTMFromProject(projectId, tmId);
  }
}
