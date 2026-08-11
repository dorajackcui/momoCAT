import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import * as XLSX from 'xlsx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TMRepository } from '../../ports';
import { WorkingTMService } from './WorkingTMService';
import type { WorkingTMResetRunner } from './WorkingTMResetWorkerRunner';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

function createHarness(type: 'working' | 'main' = 'working') {
  const entries = [
    {
      id: 'entry-1',
      tmId: 'tm-1',
      projectId: 7,
      srcLang: 'en',
      tgtLang: 'fr',
      srcHash: 'hash-1',
      matchKey: 'hello',
      tagsSignature: '',
      sourceTokens: [
        { type: 'text' as const, content: 'Hello ' },
        { type: 'tag' as const, content: '{1}' },
      ],
      targetTokens: [{ type: 'text' as const, content: 'Bonjour {1}' }],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
      usageCount: 2,
    },
  ];
  const tmRepo = {
    getProjectMountedTMs: vi.fn(() => [
      {
        id: 'tm-1',
        name: 'Project Working TM',
        srcLang: 'en',
        tgtLang: 'fr',
        type,
        createdAt: '',
        updatedAt: '',
        priority: 0,
        permission: type === 'working' ? 'readwrite' : 'read',
        isEnabled: 1,
      },
    ]),
    listTMEntries: vi.fn((_tmId: string, limit: number, offset: number) =>
      entries.slice(offset, offset + limit),
    ),
  } as unknown as TMRepository;
  const resetRunner = {
    run: vi.fn(async () => entries.length),
  } as WorkingTMResetRunner;

  return { service: new WorkingTMService(tmRepo, resetRunner), tmRepo, resetRunner };
}

describe('WorkingTMService', () => {
  it('exports a simple two-column workbook with display token text', async () => {
    const { service, tmRepo } = createHarness();
    const directory = await mkdtemp(join(tmpdir(), 'momocat-working-tm-'));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, 'working-tm.xlsx');

    await expect(service.exportToExcel(7, 'tm-1', outputPath)).resolves.toBe(1);

    const workbook = XLSX.readFile(outputPath);
    const rows = XLSX.utils.sheet_to_json<string[]>(workbook.Sheets['Working TM'], {
      header: 1,
      raw: false,
    });
    expect(rows).toEqual([
      ['Source', 'Target'],
      ['Hello {1}', 'Bonjour {1}'],
    ]);
    expect(tmRepo.listTMEntries).toHaveBeenCalledWith('tm-1', 1_000, 0);
  });

  it('resets only a mounted writable Working TM in the background runner', async () => {
    const { service, resetRunner } = createHarness();

    await expect(service.reset(7, 'tm-1')).resolves.toBe(1);
    expect(resetRunner.run).toHaveBeenCalledWith('tm-1');
  });

  it('rejects Main TMs', async () => {
    const { service, resetRunner } = createHarness('main');

    await expect(service.reset(7, 'tm-1')).rejects.toThrow(
      "The selected TM is not this project's writable Working TM.",
    );
    await expect(service.exportToExcel(7, 'tm-1', 'ignored.xlsx')).rejects.toThrow(
      "The selected TM is not this project's writable Working TM.",
    );
    expect(resetRunner.run).not.toHaveBeenCalled();
  });
});
