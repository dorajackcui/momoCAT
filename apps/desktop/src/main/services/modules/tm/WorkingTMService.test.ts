import { describe, expect, it, vi } from 'vitest';
import type { TMRepository } from '../../ports';
import { WorkingTMService } from './WorkingTMService';
import type { WorkingTMExportRunner } from './WorkingTMExportWorkerRunner';
import type { WorkingTMResetRunner } from './WorkingTMResetWorkerRunner';

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
  } as unknown as TMRepository;
  const exportRunner = {
    run: vi.fn(async () => entries.length),
  } as WorkingTMExportRunner;
  const resetRunner = {
    run: vi.fn(async () => entries.length),
  } as WorkingTMResetRunner;

  return {
    service: new WorkingTMService(tmRepo, exportRunner, resetRunner),
    exportRunner,
    resetRunner,
  };
}

describe('WorkingTMService', () => {
  it('delegates the complete export to the background runner', async () => {
    const { service, exportRunner } = createHarness();

    await expect(service.exportToExcel(7, 'tm-1', 'working-tm.xlsx')).resolves.toBe(1);

    expect(exportRunner.run).toHaveBeenCalledWith('tm-1', 'working-tm.xlsx');
  });

  it('resets only a mounted writable Working TM in the background runner', async () => {
    const { service, resetRunner } = createHarness();

    await expect(service.reset(7, 'tm-1')).resolves.toBe(1);
    expect(resetRunner.run).toHaveBeenCalledWith('tm-1');
  });

  it('rejects Main TMs', async () => {
    const { service, exportRunner, resetRunner } = createHarness('main');

    await expect(service.reset(7, 'tm-1')).rejects.toThrow(
      "The selected TM is not this project's writable Working TM.",
    );
    await expect(service.exportToExcel(7, 'tm-1', 'ignored.xlsx')).rejects.toThrow(
      "The selected TM is not this project's writable Working TM.",
    );
    expect(exportRunner.run).not.toHaveBeenCalled();
    expect(resetRunner.run).not.toHaveBeenCalled();
  });
});
