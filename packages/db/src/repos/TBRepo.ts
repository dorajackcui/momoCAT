import Database from 'better-sqlite3';
import type { TBEntry } from '@cat/core/models';
import { buildTermSearchFragments, normalizeTermForLookup } from '@cat/core/text';
import { randomUUID } from 'crypto';
import type { MountedTBRecord, ProjectTermEntryRecord, TBRecord } from '../types';

type TBEntryDbRow = TBEntry;

export class TBRepo {
  private stmtDeleteTbFtsByEntryId: Database.Statement;
  private stmtDeleteTbFtsByTbId: Database.Statement;
  private stmtInsertTbFts: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtDeleteTbFtsByEntryId = this.db.prepare('DELETE FROM tb_fts WHERE tbEntryId = ?');
    this.stmtDeleteTbFtsByTbId = this.db.prepare('DELETE FROM tb_fts WHERE tbId = ?');
    this.stmtInsertTbFts = this.db.prepare(
      'INSERT INTO tb_fts (tbId, srcText, tbEntryId) VALUES (?, ?, ?)',
    );
  }

  public listTermBases(): TBRecord[] {
    return this.db.prepare('SELECT * FROM term_bases ORDER BY updatedAt DESC').all() as TBRecord[];
  }

  public createTermBase(name: string, srcLang: string, tgtLang: string): string {
    const id = randomUUID();
    this.db
      .prepare(`
      INSERT INTO term_bases (id, name, srcLang, tgtLang)
      VALUES (?, ?, ?, ?)
    `)
      .run(id, name, srcLang, tgtLang);
    return id;
  }

  public deleteTermBase(id: string) {
    this.stmtDeleteTbFtsByTbId.run(id);
    this.db.prepare('DELETE FROM term_bases WHERE id = ?').run(id);
  }

  public getTermBase(tbId: string): TBRecord | undefined {
    return this.db.prepare('SELECT * FROM term_bases WHERE id = ?').get(tbId) as TBRecord | undefined;
  }

  public getTermBaseStats(tbId: string) {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM tb_entries WHERE tbId = ?').get(tbId) as {
      count: number;
    };
    return { entryCount: count.count };
  }

  public mountTermBaseToProject(projectId: number, tbId: string, priority: number = 10) {
    this.db
      .prepare(`
      INSERT INTO project_term_bases (projectId, tbId, priority, isEnabled)
      VALUES (?, ?, ?, 1)
      ON CONFLICT(projectId, tbId) DO UPDATE SET
        priority = excluded.priority,
        isEnabled = 1
    `)
      .run(projectId, tbId, priority);
  }

  public unmountTermBaseFromProject(projectId: number, tbId: string) {
    this.db.prepare('DELETE FROM project_term_bases WHERE projectId = ? AND tbId = ?').run(projectId, tbId);
  }

  public getProjectMountedTermBases(projectId: number): MountedTBRecord[] {
    return this.db
      .prepare(`
      SELECT term_bases.*, project_term_bases.priority, project_term_bases.isEnabled
      FROM project_term_bases
      JOIN term_bases ON project_term_bases.tbId = term_bases.id
      WHERE project_term_bases.projectId = ? AND project_term_bases.isEnabled = 1
      ORDER BY project_term_bases.priority ASC, term_bases.updatedAt DESC
    `)
      .all(projectId) as MountedTBRecord[];
  }

  public listTBEntries(tbId: string, limit: number = 500, offset: number = 0): TBEntry[] {
    const rows = this.db
      .prepare(`
      SELECT *
      FROM tb_entries
      WHERE tbId = ?
      ORDER BY srcTerm COLLATE NOCASE ASC
      LIMIT ? OFFSET ?
    `)
      .all(tbId, limit, offset) as TBEntryDbRow[];

    return rows.map((row) => ({ ...row })) as TBEntry[];
  }

  public listProjectTermEntries(projectId: number): Array<TBEntry & { tbName: string; priority: number }> {
    const rows = this.db
      .prepare(`
      SELECT tb_entries.*, term_bases.name as tbName, project_term_bases.priority
      FROM project_term_bases
      JOIN term_bases ON project_term_bases.tbId = term_bases.id
      JOIN tb_entries ON tb_entries.tbId = term_bases.id
      WHERE project_term_bases.projectId = ? AND project_term_bases.isEnabled = 1
      ORDER BY project_term_bases.priority ASC, length(tb_entries.srcTerm) DESC
      LIMIT 5000
    `)
      .all(projectId) as ProjectTermEntryRecord[];

    return rows.map((row) => ({ ...row }));
  }

  public searchProjectTermEntries(
    projectId: number,
    sourceText: string,
    options?: { srcLang?: string; limit?: number },
  ): Array<TBEntry & { tbName: string; priority: number }> {
    const mountedTbIds = this.getProjectMountedTermBases(projectId).map((tb) => tb.id);
    if (mountedTbIds.length === 0) return [];

    const fragments = buildTermSearchFragments(sourceText, {
      locale: options?.srcLang,
      maxFragments: 12,
    });
    if (fragments.length === 0) return [];

    const placeholders = mountedTbIds.map(() => '?').join(',');
    const limit = Math.max(1, Math.min(options?.limit ?? 200, 500));
    const ftsQuery = fragments
      .map((fragment) => `"${this.escapeFtsFragment(fragment)}"`)
      .join(' OR ');

    const rows = this.db
      .prepare(`
      SELECT tb_entries.*, term_bases.name as tbName, project_term_bases.priority
      FROM tb_fts
      JOIN tb_entries ON tb_fts.tbEntryId = tb_entries.id
      JOIN term_bases ON tb_entries.tbId = term_bases.id
      JOIN project_term_bases ON project_term_bases.tbId = term_bases.id
      WHERE project_term_bases.projectId = ?
        AND project_term_bases.isEnabled = 1
        AND tb_fts.tbId IN (${placeholders})
        AND tb_fts MATCH ?
      ORDER BY project_term_bases.priority ASC, length(tb_entries.srcTerm) DESC, tb_entries.usageCount DESC
      LIMIT ${limit}
    `)
      .all(projectId, ...mountedTbIds, ftsQuery) as ProjectTermEntryRecord[];

    return rows.map((row) => ({ ...row }));
  }

  public insertTBEntryIfAbsentBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string | undefined {
    const srcNorm = this.normalizeTerm(params.srcTerm, params.srcLang);
    const row = this.db
      .prepare(`
      INSERT INTO tb_entries (id, tbId, srcTerm, tgtTerm, srcNorm, note, usageCount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tbId, srcNorm) DO NOTHING
      RETURNING id
    `)
      .get(
        params.id,
        params.tbId,
        params.srcTerm.trim(),
        params.tgtTerm.trim(),
        srcNorm,
        params.note ?? null,
        params.usageCount ?? 0
      ) as { id: string } | undefined;

    if (row?.id) {
      this.db
        .prepare(`
        UPDATE term_bases
        SET updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
        WHERE id = ?
      `)
        .run(params.tbId);
      this.replaceTbFts(params.tbId, row.id, srcNorm);
    }

    return row?.id;
  }

  public upsertTBEntryBySrcTerm(params: {
    id: string;
    tbId: string;
    srcLang: string;
    srcTerm: string;
    tgtTerm: string;
    note?: string | null;
    usageCount?: number;
  }): string {
    const srcNorm = this.normalizeTerm(params.srcTerm, params.srcLang);
    const row = this.db
      .prepare(`
      INSERT INTO tb_entries (id, tbId, srcTerm, tgtTerm, srcNorm, note, usageCount)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tbId, srcNorm) DO UPDATE SET
        srcTerm = excluded.srcTerm,
        tgtTerm = excluded.tgtTerm,
        note = excluded.note,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = tb_entries.usageCount + 1
      RETURNING id
    `)
      .get(
        params.id,
        params.tbId,
        params.srcTerm.trim(),
        params.tgtTerm.trim(),
        srcNorm,
        params.note ?? null,
        params.usageCount ?? 0
      ) as { id: string } | undefined;

    if (!row?.id) {
      throw new Error('Failed to upsert TB entry');
    }

    this.db
      .prepare(`
      UPDATE term_bases
      SET updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `)
      .run(params.tbId);
    this.replaceTbFts(params.tbId, row.id, srcNorm);

    return row.id;
  }

  public incrementTBUsage(tbEntryId: string) {
    this.db
      .prepare(`
      UPDATE tb_entries
      SET usageCount = usageCount + 1,
          updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `)
      .run(tbEntryId);
  }

  private replaceTbFts(tbId: string, tbEntryId: string, srcText: string) {
    this.stmtDeleteTbFtsByEntryId.run(tbEntryId);
    this.stmtInsertTbFts.run(tbId, srcText, tbEntryId);
  }

  private normalizeTerm(value: string, locale?: string): string {
    return normalizeTermForLookup(value, { locale });
  }

  private escapeFtsFragment(value: string): string {
    return value.replace(/"/g, '""');
  }
}
