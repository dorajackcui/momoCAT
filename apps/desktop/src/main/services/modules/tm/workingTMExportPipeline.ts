import { writeFile } from 'fs/promises';
import { serializeTokensToDisplayText } from '@cat/core/text';
import type { TMEntry } from '@cat/core/models';
import * as XLSX from 'xlsx';
import {
  serializeWorkingTMTokenMetadata,
  WORKING_TM_SOURCE_TOKENS_HEADER,
  WORKING_TM_TARGET_TOKENS_HEADER,
} from './workingTMWorkbookFormat';

const EXPORT_PAGE_SIZE = 1_000;

export interface WorkingTMExportDatabasePort {
  getTM(tmId: string): { id: string } | undefined;
  listTMEntries(tmId: string, limit?: number, offset?: number): Array<TMEntry & { tmId: string }>;
  runInTransaction<T>(fn: () => T): T;
}

export interface WorkingTMExportInput {
  tmId: string;
  outputPath: string;
}

export async function runWorkingTMExportPipeline(
  db: WorkingTMExportDatabasePort,
  input: WorkingTMExportInput,
): Promise<number> {
  if (!db.getTM(input.tmId)) throw new Error('Target TM not found');

  // updatedAt is mutable, so OFFSET paging is safe only while every page sees
  // the same SQLite snapshot. Workbook serialization happens after the read
  // transaction, but still inside the dedicated export worker.
  const { worksheet, exported } = db.runInTransaction(() => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Source', 'Target', WORKING_TM_SOURCE_TOKENS_HEADER, WORKING_TM_TARGET_TOKENS_HEADER],
    ]);
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const entries = db.listTMEntries(input.tmId, EXPORT_PAGE_SIZE, offset);
      if (entries.length === 0) break;

      XLSX.utils.sheet_add_aoa(
        sheet,
        entries.map((entry) => [
          serializeTokensToDisplayText(entry.sourceTokens),
          serializeTokensToDisplayText(entry.targetTokens),
          serializeWorkingTMTokenMetadata(entry.sourceTokens),
          serializeWorkingTMTokenMetadata(entry.targetTokens),
        ]),
        { origin: { r: offset + 1, c: 0 } },
      );
      offset += entries.length;
      hasMore = entries.length === EXPORT_PAGE_SIZE;
    }

    return { worksheet: sheet, exported: offset };
  });

  worksheet['!cols'] = [{ wch: 48 }, { wch: 48 }, { hidden: true }, { hidden: true }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Working TM');
  const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as
    | Buffer
    | Uint8Array
    | string;
  await writeFile(input.outputPath, typeof data === 'string' ? data : Buffer.from(data));
  return exported;
}
