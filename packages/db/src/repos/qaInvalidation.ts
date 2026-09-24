import type Database from 'better-sqlite3';

export function invalidateProjectQA(db: Database.Database, projectId: number): void {
  db.prepare(
    `UPDATE segments SET qaIssuesJson = NULL WHERE qaIssuesJson IS NOT NULL
    AND fileId IN (SELECT id FROM files WHERE projectId = ?)`,
  ).run(projectId);
}

export function invalidateTermBaseQA(db: Database.Database, tbId: string): void {
  db.prepare(
    `UPDATE segments SET qaIssuesJson = NULL WHERE qaIssuesJson IS NOT NULL
    AND fileId IN (SELECT files.id FROM files JOIN project_term_bases mounts
      ON mounts.projectId = files.projectId WHERE mounts.tbId = ?)`,
  ).run(tbId);
}
