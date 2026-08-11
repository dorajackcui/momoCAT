import { writeFile } from 'fs/promises';
import { serializeTokensToDisplayText } from '@cat/core/text';
import * as XLSX from 'xlsx';
import type { TMRepository } from '../../ports';
import type { WorkingTMResetRunner } from './WorkingTMResetWorkerRunner';

const EXPORT_PAGE_SIZE = 1_000;

export class WorkingTMService {
  constructor(
    private readonly tmRepo: TMRepository,
    private readonly resetRunner: WorkingTMResetRunner,
  ) {}

  public async exportToExcel(projectId: number, tmId: string, outputPath: string): Promise<number> {
    this.assertMountedWorkingTM(projectId, tmId);
    if (!outputPath.trim()) {
      throw new Error('Working TM export path cannot be empty.');
    }

    const worksheet = XLSX.utils.aoa_to_sheet([['Source', 'Target']]);
    let exported = 0;
    let hasMore = true;

    while (hasMore) {
      const entries = this.tmRepo.listTMEntries(tmId, EXPORT_PAGE_SIZE, exported);
      if (entries.length === 0) break;

      XLSX.utils.sheet_add_aoa(
        worksheet,
        entries.map((entry) => [
          serializeTokensToDisplayText(entry.sourceTokens),
          serializeTokensToDisplayText(entry.targetTokens),
        ]),
        { origin: { r: exported + 1, c: 0 } },
      );
      exported += entries.length;
      hasMore = entries.length === EXPORT_PAGE_SIZE;

      if (hasMore) await new Promise<void>((resolve) => setImmediate(resolve));
    }

    worksheet['!cols'] = [{ wch: 48 }, { wch: 48 }];
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Working TM');
    const data = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }) as
      | Buffer
      | Uint8Array
      | string;
    await writeFile(outputPath, typeof data === 'string' ? data : Buffer.from(data));
    return exported;
  }

  public async reset(projectId: number, tmId: string): Promise<number> {
    this.assertMountedWorkingTM(projectId, tmId);
    return this.resetRunner.run(tmId);
  }

  private assertMountedWorkingTM(projectId: number, tmId: string): void {
    const mountedTM = this.tmRepo
      .getProjectMountedTMs(projectId)
      .find((tm) => tm.id === tmId && tm.type === 'working' && tm.permission === 'readwrite');

    if (!mountedTM) {
      throw new Error("The selected TM is not this project's writable Working TM.");
    }
  }
}
