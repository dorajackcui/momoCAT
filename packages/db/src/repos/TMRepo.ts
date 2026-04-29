import Database from 'better-sqlite3';
import type { TMEntry, Token } from '@cat/core/models';
import { randomUUID } from 'crypto';
import type {
  MountedTMRecord,
  TMEntryRow,
  TMRecallOptions,
  TMRecord,
  TMType,
} from '../types';

type TMEntryDbRow = Omit<TMEntryRow, 'sourceTokens' | 'targetTokens'> & {
  sourceTokensJson: string;
  targetTokensJson: string;
};

export class TMRepo {
  private stmtUpsertTMEntry: Database.Statement;
  private stmtInsertTMEntryIfAbsentBySrcHash: Database.Statement;
  private stmtUpsertTMEntryBySrcHash: Database.Statement;
  private stmtDeleteTMFtsByEntryId: Database.Statement;
  private stmtInsertTMFts: Database.Statement;
  private stmtFindTMEntryByHash: Database.Statement;
  private stmtFindTMEntryMetaByHash: Database.Statement;

  constructor(private readonly db: Database.Database) {
    this.stmtUpsertTMEntry = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        targetTokensJson = excluded.targetTokensJson,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = usageCount + 1
    `);

    this.stmtInsertTMEntryIfAbsentBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO NOTHING
      RETURNING id
    `);

    this.stmtUpsertTMEntryBySrcHash = this.db.prepare(`
      INSERT INTO tm_entries (
        id, tmId, srcHash, matchKey, tagsSignature,
        sourceTokensJson, targetTokensJson, originSegmentId, usageCount
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tmId, srcHash) DO UPDATE SET
        matchKey = excluded.matchKey,
        tagsSignature = excluded.tagsSignature,
        sourceTokensJson = excluded.sourceTokensJson,
        targetTokensJson = excluded.targetTokensJson,
        originSegmentId = excluded.originSegmentId,
        updatedAt = (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        usageCount = tm_entries.usageCount + 1
      RETURNING id
    `);

    this.stmtDeleteTMFtsByEntryId = this.db.prepare('DELETE FROM tm_fts WHERE tmEntryId = ?');
    this.stmtInsertTMFts = this.db.prepare(
      'INSERT INTO tm_fts (tmId, srcText, tgtText, tmEntryId) VALUES (?, ?, ?, ?)'
    );
    this.stmtFindTMEntryByHash = this.db.prepare('SELECT * FROM tm_entries WHERE tmId = ? AND srcHash = ?');
    this.stmtFindTMEntryMetaByHash = this.db.prepare(
      'SELECT id, usageCount, createdAt FROM tm_entries WHERE tmId = ? AND srcHash = ?'
    );
  }

  public upsertTMEntry(entry: TMEntry & { tmId: string }) {
    this.stmtUpsertTMEntry.run(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    );

    const srcText = entry.sourceTokens.map((token: Token) => token.content).join('');
    const tgtText = entry.targetTokens.map((token: Token) => token.content).join('');

    this.stmtDeleteTMFtsByEntryId.run(entry.id);
    this.stmtInsertTMFts.run(entry.tmId, srcText, tgtText, entry.id);
  }

  public insertTMEntryIfAbsentBySrcHash(entry: TMEntry & { tmId: string }): string | undefined {
    const row = this.stmtInsertTMEntryIfAbsentBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    ) as { id: string } | undefined;

    return row?.id;
  }

  public upsertTMEntryBySrcHash(entry: TMEntry & { tmId: string }): string {
    const row = this.stmtUpsertTMEntryBySrcHash.get(
      entry.id,
      entry.tmId,
      entry.srcHash,
      entry.matchKey,
      entry.tagsSignature,
      JSON.stringify(entry.sourceTokens),
      JSON.stringify(entry.targetTokens),
      entry.originSegmentId,
      entry.usageCount
    ) as { id: string } | undefined;

    if (!row?.id) {
      throw new Error('Failed to upsert TM entry by srcHash');
    }

    return row.id;
  }

  public insertTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
  }

  public replaceTMFts(tmId: string, srcText: string, tgtText: string, tmEntryId: string) {
    this.stmtDeleteTMFtsByEntryId.run(tmEntryId);
    this.stmtInsertTMFts.run(tmId, srcText, tgtText, tmEntryId);
  }

  public findTMEntryByHash(tmId: string, srcHash: string): TMEntry | undefined {
    const row = this.stmtFindTMEntryByHash.get(tmId, srcHash) as TMEntryDbRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson)
    };
  }

  public findTMEntryMetaByHash(
    tmId: string,
    srcHash: string
  ): { id: string; usageCount: number; createdAt: string } | undefined {
    const row = this.stmtFindTMEntryMetaByHash.get(tmId, srcHash) as
      | { id: string; usageCount: number; createdAt: string }
      | undefined;
    return row;
  }

  public getProjectMountedTMs(projectId: number): MountedTMRecord[] {
    return this.db
      .prepare(`
      SELECT tms.*, project_tms.priority, project_tms.permission, project_tms.isEnabled
      FROM project_tms
      JOIN tms ON project_tms.tmId = tms.id
      WHERE project_tms.projectId = ? AND project_tms.isEnabled = 1
      ORDER BY project_tms.priority ASC
    `)
      .all(projectId) as MountedTMRecord[];
  }

  public searchTMRecallCandidates(
    projectId: number,
    sourceText: string,
    tmIds?: string[],
    options: TMRecallOptions = {},
  ): TMEntryRow[] {
    const limit = options.limit ?? 50;
    return this.searchConcordance(projectId, sourceText, tmIds).slice(0, limit);
  }

  public searchConcordance(projectId: number, query: string, tmIds?: string[]): TMEntryRow[] {
    const maxResults = 10;
    const resolvedTmIds = tmIds ?? this.getProjectMountedTMs(projectId).map((tm) => tm.id);
    if (resolvedTmIds.length === 0) {
      return [];
    }

    const placeholders = resolvedTmIds.map(() => '?').join(',');

    const terms = this.extractSearchTerms(query);
    const ftsTerms = terms.filter((t) => t.length >= 3);
    const shortTerms = terms.filter((t) => t.length >= 2 && t.length < 3);

    const mergedRows: TMEntryDbRow[] = [];
    const seenIds = new Set<string>();

    if (ftsTerms.length > 0) {
      const ftsQuery = ftsTerms.map((t) => `"${t.replace(/"/g, '""')}"`).join(' OR ');

      const rows = this.db
        .prepare(`
        SELECT tm_entries.*
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND tm_fts MATCH ?
        ORDER BY rank
        LIMIT ${maxResults}
      `)
        .all(...resolvedTmIds, ftsQuery) as TMEntryDbRow[];

      for (const row of rows) {
        seenIds.add(row.id);
        mergedRows.push(row);
      }
    }

    if (mergedRows.length < maxResults && shortTerms.length > 0) {
      const remaining = maxResults - mergedRows.length;
      const likeClauses = shortTerms
        .map(() => '(tm_fts.srcText LIKE ? ESCAPE \'/\' OR tm_fts.tgtText LIKE ? ESCAPE \'/\')')
        .join(' OR ');
      const likeParams = shortTerms.flatMap((term) => {
        const escaped = `%${this.escapeLikePattern(term)}%`;
        return [escaped, escaped] as const;
      });

      const likeRows = this.db
        .prepare(`
        SELECT tm_entries.*
        FROM tm_fts
        JOIN tm_entries ON tm_fts.tmEntryId = tm_entries.id
        WHERE tm_fts.tmId IN (${placeholders}) AND (${likeClauses})
        ORDER BY tm_entries.usageCount DESC, tm_entries.updatedAt DESC
        LIMIT ${remaining}
      `)
        .all(...resolvedTmIds, ...likeParams) as TMEntryDbRow[];

      for (const row of likeRows) {
        if (seenIds.has(row.id)) continue;
        seenIds.add(row.id);
        mergedRows.push(row);
        if (mergedRows.length >= maxResults) break;
      }
    }

    return mergedRows.map((row) => ({
      ...row,
      sourceTokens: JSON.parse(row.sourceTokensJson),
      targetTokens: JSON.parse(row.targetTokensJson),
    }));
  }

  private extractSearchTerms(query: string): string[] {
    return query
      .replace(/["()]/g, ' ')
      .replace(/\b(?:AND|OR|NOT)\b/gi, ' ')
      .replace(/[^\w\s\u4e00-\u9fa5]/g, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);
  }

  private escapeLikePattern(value: string): string {
    return value.replace(/([/%_])/g, '/$1');
  }

  public listTMs(type?: TMType): TMRecord[] {
    if (type) {
      return this.db.prepare('SELECT * FROM tms WHERE type = ? ORDER BY updatedAt DESC').all(type) as TMRecord[];
    }
    return this.db.prepare('SELECT * FROM tms ORDER BY updatedAt DESC').all() as TMRecord[];
  }

  public createTM(name: string, srcLang: string, tgtLang: string, type: TMType): string {
    const id = randomUUID();
    this.db
      .prepare(`
      INSERT INTO tms (id, name, srcLang, tgtLang, type)
      VALUES (?, ?, ?, ?, ?)
    `)
      .run(id, name, srcLang, tgtLang, type);
    return id;
  }

  public deleteTM(id: string) {
    this.db.prepare('DELETE FROM tms WHERE id = ?').run(id);
  }

  public mountTMToProject(projectId: number, tmId: string, priority: number = 10, permission: string = 'read') {
    this.db
      .prepare(`
      INSERT INTO project_tms (projectId, tmId, priority, permission, isEnabled)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(projectId, tmId) DO UPDATE SET
        priority = excluded.priority,
        permission = excluded.permission,
        isEnabled = 1
    `)
      .run(projectId, tmId, priority, permission);
  }

  public unmountTMFromProject(projectId: number, tmId: string) {
    this.db.prepare('DELETE FROM project_tms WHERE projectId = ? AND tmId = ?').run(projectId, tmId);
  }

  public getTMStats(tmId: string) {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM tm_entries WHERE tmId = ?').get(tmId) as {
      count: number;
    };
    return { entryCount: count.count };
  }

  public getTM(tmId: string): TMRecord | undefined {
    return this.db.prepare('SELECT * FROM tms WHERE id = ?').get(tmId) as TMRecord | undefined;
  }
}
