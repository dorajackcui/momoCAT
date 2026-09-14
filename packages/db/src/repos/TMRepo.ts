import type Database from 'better-sqlite3';
import type { TMEntry } from '@cat/core/models';
import { randomUUID } from 'crypto';
import type {
  MountedTMRecord,
  TMConcordanceRecallOptions,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMSyncChangedRow,
  TMSyncDeletedRow,
  TMSyncDiffSummary,
  TMSyncStagedRow,
  TMType,
} from '../types';

import { TMEntryRepo } from './tm/TMEntryRepo';
import { TMFuzzyRecall, TM_RECALL_MAX_LIMIT } from './tm/TMFuzzyRecall';
import { TMConcordanceRecall } from './tm/TMConcordanceRecall';
import { TMSyncRepo } from './TMSyncRepo';
import type { TMFtsReplacementRow } from './tm/tmEntryRows';
import { diversifyConcordanceRows } from './tm/tmRecallDiversity';

const TM_CONCORDANCE_RESULT_LIMIT = 10;

/** Stable TM facade: catalog and mounts here, entry/index and recall workflows below. */
export class TMRepo {
  private readonly entryRepo: TMEntryRepo;
  private readonly fuzzyRecall: TMFuzzyRecall;
  private readonly concordanceRecall: TMConcordanceRecall;
  private readonly syncRepo: TMSyncRepo;

  constructor(private readonly db: Database.Database) {
    this.entryRepo = new TMEntryRepo(db);
    this.syncRepo = new TMSyncRepo(db, {
      deleteForEntry: (entryId) => this.entryRepo.deleteTMFtsForEntry(entryId),
      insertForEntry: (tmId, srcText, tgtText, entryId) =>
        this.entryRepo.insertTMFtsForEntry(tmId, srcText, tgtText, entryId),
    });
    const mountedTMs = (projectId: number) => this.getProjectMountedTMs(projectId);
    this.fuzzyRecall = new TMFuzzyRecall(db, mountedTMs);
    this.concordanceRecall = new TMConcordanceRecall(db, mountedTMs);
  }

  public upsertTMEntry(entry: TMEntry & { tmId: string }) {
    return this.entryRepo.upsertTMEntry(entry);
  }

  public insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined {
    return this.entryRepo.insertTMEntryIfAbsentBySrcHash(entry);
  }

  public upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    return this.entryRepo.upsertTMEntryBySrcHash(entry);
  }

  public insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    return this.entryRepo.insertTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    return this.entryRepo.replaceTMFts(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFtsBatch(rows: TMFtsReplacementRow[]) {
    return this.entryRepo.replaceTMFtsBatch(rows);
  }

  public findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    return this.entryRepo.findTMEntryByHash(tmId, srcHash);
  }

  public findTMEntryMetaByHash(
    tmId: string,
    srcHash: string,
  ): { id: string; usageCount: number; createdAt: string } | undefined {
    return this.entryRepo.findTMEntryMetaByHash(tmId, srcHash);
  }

  public listTMEntries(tmId: string, limit: number = 500, offset: number = 0): TMEntryRow[] {
    return this.entryRepo.listTMEntries(tmId, limit, offset);
  }

  public clearTMEntries(tmId: string): number {
    return this.entryRepo.clearTMEntries(tmId);
  }

  public optimizeTMFts(): void {
    return this.entryRepo.optimizeTMFts();
  }

  public searchTMFuzzyRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    return this.fuzzyRecall.searchTMFuzzyRecallCandidates(projectId, sourceText, tmIds, options);
  }

  public searchTMConcordanceRecallCandidates(
    projectId: number,
    queryText: string,
    tmIds?: string[],
    options: TMConcordanceRecallOptions = {},
  ): TMEntryRow[] {
    return this.concordanceRecall.searchTMConcordanceRecallCandidates(
      projectId,
      queryText,
      tmIds,
      options,
    );
  }

  public getProjectMountedTMs(projectId: number): MountedTMRecord[] {
    return this.db
      .prepare(
        `
      SELECT tms.*, project_tms.priority, project_tms.permission, project_tms.isEnabled
      FROM project_tms
      JOIN tms ON project_tms.tmId = tms.id
      WHERE project_tms.projectId = ? AND project_tms.isEnabled = 1
      ORDER BY project_tms.priority ASC
    `,
      )
      .all(projectId) as MountedTMRecord[];
  }

  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    return this.searchTMFuzzyRecallCandidates(projectId, sourceText, tmIds, options);
  }

  public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
    const candidates = this.searchTMRecallCandidates(projectId, query, tmIds, {
      scope: 'source-and-target',
      limit: TM_RECALL_MAX_LIMIT,
    });
    return diversifyConcordanceRows(query, candidates, TM_CONCORDANCE_RESULT_LIMIT);
  }

  public listTMs(type?: TMType): TMRecord[] {
    if (type) {
      return this.db
        .prepare('SELECT * FROM tms WHERE type = ? ORDER BY updatedAt DESC')
        .all(type) as TMRecord[];
    }
    return this.db.prepare('SELECT * FROM tms ORDER BY updatedAt DESC').all() as TMRecord[];
  }

  public createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string {
    const id = randomUUID();
    this.db
      .prepare(
        `
      INSERT INTO tms (id, name, srcLang, tgtLang, type)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(id, name, srcLang, tgtLang, type);
    return id;
  }

  public renameTM(id: string, name: string): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error('TM name cannot be empty.');
    }
    const result = this.db.prepare('UPDATE tms SET name = ? WHERE id = ?').run(trimmedName, id);
    if (result.changes === 0) {
      throw new Error('TM not found.');
    }
  }

  public deleteTM(id: string) {
    const deleteRows = () => {
      this.db.prepare('DELETE FROM tm_fts WHERE tmId = ?').run(id);
      this.db.prepare('DELETE FROM tms WHERE id = ?').run(id);
    };

    if (this.db.inTransaction) {
      deleteRows();
      return;
    }

    this.db.transaction(deleteRows)();
  }

  public mountTMToProject(
    projectId: number,
    tmId: string,
    priority: number = 10,
    permission: string = 'read',
  ) {
    this.db
      .prepare(
        `
      INSERT INTO project_tms (projectId, tmId, priority, permission, isEnabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(projectId, tmId) DO UPDATE SET
        priority = excluded.priority,
        permission = excluded.permission,
        isEnabled = 1
    `,
      )
      .run(projectId, tmId, priority, permission);
  }

  public unmountTMFromProject(projectId: number, tmId: string) {
    this.db
      .prepare('DELETE FROM project_tms WHERE projectId = ? AND tmId = ?')
      .run(projectId, tmId);
  }

  public getTMStats(tmId: string) {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) as count, MAX(updatedAt) as maxUpdatedAt FROM tm_entries WHERE tmId = ?',
      )
      .get(tmId) as {
      count: number;
      maxUpdatedAt: string | null;
    };
    return {
      entryCount: row.count,
      maxEntryUpdatedAt: row.maxUpdatedAt,
    };
  }

  public getTM(tmId: string): TMRecord | undefined {
    return this.db.prepare('SELECT * FROM tms WHERE id = ?').get(tmId) as TMRecord | undefined;
  }

  public clearTMSyncStagingForTM(tmId: string, exceptRunId?: string): void {
    this.syncRepo.clearStagingForTM(tmId, exceptRunId);
  }

  public clearTMSyncStagingRun(runId: string): void {
    this.syncRepo.clearStagingRun(runId);
  }

  // Sync callers own bounded transactions. File order is preserved by staging,
  // so duplicate source hashes keep the last row across and within batches.
  public stageTMSyncRows(runId: string, tmId: string, rows: TMSyncStagedRow[]): void {
    this.syncRepo.stageRows(runId, tmId, rows);
  }

  public countTMSyncStagedRows(runId: string): number {
    return this.syncRepo.countStagedRows(runId);
  }

  public getTMSyncDiffSummary(
    runId: string,
    tmId: string,
    lastSyncedAt?: string,
  ): TMSyncDiffSummary {
    return this.syncRepo.getDiffSummary(runId, tmId, lastSyncedAt);
  }

  public listTMSyncNewRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
  ): TMSyncStagedRow[] {
    return this.syncRepo.listNewRows(runId, tmId, afterSrcHash, limit);
  }

  public listTMSyncChangedRows(
    runId: string,
    tmId: string,
    afterSrcHash: string,
    limit: number,
    lastSyncedAt?: string,
  ): TMSyncChangedRow[] {
    return this.syncRepo.listChangedRows(runId, tmId, afterSrcHash, limit, lastSyncedAt);
  }

  public listTMSyncDeletedEntries(
    runId: string,
    tmId: string,
    afterId: string,
    limit: number,
    lastSyncedAt?: string,
  ): TMSyncDeletedRow[] {
    return this.syncRepo.listDeletedEntries(runId, tmId, afterId, limit, lastSyncedAt);
  }

  public applyTMSyncInserts(tmId: string, rows: Array<TMSyncStagedRow & { id: string }>): number {
    return this.syncRepo.applyInserts(tmId, rows);
  }

  public applyTMSyncUpdates(
    tmId: string,
    rows: Array<{
      entryId: string;
      sourceTokensJson: string;
      targetTokensJson: string;
      srcText: string;
      tgtText: string;
    }>,
  ): number {
    return this.syncRepo.applyUpdates(tmId, rows);
  }

  public deleteTMEntriesWithFts(entryIds: string[]): number {
    return this.syncRepo.deleteEntriesWithFts(entryIds);
  }
}
