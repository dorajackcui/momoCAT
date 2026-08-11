import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TMRepository, TransactionManager } from '../../ports';
import { TMImportService } from './TMImportService';
import {
  serializeWorkingTMTokenMetadata,
  WORKING_TM_SOURCE_TOKENS_HEADER,
  WORKING_TM_TARGET_TOKENS_HEADER,
} from './workingTMWorkbookFormat';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('TMImportService', () => {
  it('keeps Working TM token metadata out of the column-selection preview', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'momocat-tm-preview-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, 'working-tm.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ['Source', 'Target', WORKING_TM_SOURCE_TOKENS_HEADER, WORKING_TM_TARGET_TOKENS_HEADER],
        [
          'Literal {1}',
          'Texte {1}',
          serializeWorkingTMTokenMetadata([{ type: 'text', content: 'Literal {1}' }]),
          serializeWorkingTMTokenMetadata([{ type: 'text', content: 'Texte {1}' }]),
        ],
      ]),
      'Working TM',
    );
    XLSX.writeFile(workbook, filePath);
    const service = new TMImportService(
      {} as TMRepository,
      {} as TransactionManager,
      'unused.db',
      vi.fn(),
    );

    await expect(service.getTMImportPreview(filePath)).resolves.toEqual([
      ['Source', 'Target'],
      ['Literal {1}', 'Texte {1}'],
    ]);
  });
});
