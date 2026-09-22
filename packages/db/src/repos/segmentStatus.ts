import type Database from 'better-sqlite3';
import { normalizeSegmentStatus, type Token } from '@cat/core/models';

// Older v15 rows remain readable without rewriting user data on startup.
// Confirmed status is explicit; unconfirmed status follows the target content.
export const SEGMENT_STATUS_SQL = `CASE
  WHEN s.segmentId IS NULL THEN 'empty'
  WHEN s.status = 'confirmed' THEN 'confirmed'
  ELSE segment_status(s.status, s.targetTokensJson)
END`;

export function registerSegmentStatusFunction(db: Database.Database): void {
  db.function('segment_status', { deterministic: true }, (status, targetTokensJson) =>
    normalizeSegmentStatus(status, JSON.parse(String(targetTokensJson)) as Token[]),
  );
}
