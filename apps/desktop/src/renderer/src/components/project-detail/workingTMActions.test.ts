import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkingTMExportDefaultPath,
  exportWorkingTMAction,
  resetWorkingTMAction,
  WORKING_TM_EXPORT_FILTERS,
} from './workingTMActions';

describe('Working TM actions', () => {
  it('builds a filesystem-safe default export name', () => {
    expect(buildWorkingTMExportDefaultPath(' Demo: EN/FR. ')).toBe('Demo_ EN_FR_working_tm.xlsx');
    expect(buildWorkingTMExportDefaultPath('...')).toBe('project_working_tm.xlsx');
  });

  it('exports only after an output path is selected', async () => {
    const saveFileDialog = vi.fn(async () => 'D:/exports/demo.xlsx');
    const exportWorkingTM = vi.fn(async () => 12);
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation());

    await expect(
      exportWorkingTMAction({
        projectId: 7,
        projectName: 'Demo',
        tmId: 'working-1',
        saveFileDialog,
        exportWorkingTM,
        runMutation,
      }),
    ).resolves.toBe(12);

    expect(saveFileDialog).toHaveBeenCalledWith('Demo_working_tm.xlsx', WORKING_TM_EXPORT_FILTERS);
    expect(exportWorkingTM).toHaveBeenCalledWith(7, 'working-1', 'D:/exports/demo.xlsx');
    expect(runMutation).toHaveBeenCalledTimes(1);
  });

  it('does nothing when export is cancelled', async () => {
    const exportWorkingTM = vi.fn();
    const runMutation = vi.fn();

    await expect(
      exportWorkingTMAction({
        projectId: 7,
        projectName: 'Demo',
        tmId: 'working-1',
        saveFileDialog: vi.fn(async () => null),
        exportWorkingTM,
        runMutation,
      }),
    ).resolves.toBeNull();

    expect(exportWorkingTM).not.toHaveBeenCalled();
    expect(runMutation).not.toHaveBeenCalled();
  });

  it('resets after a danger confirmation and refreshes the TM count', async () => {
    const confirm = vi.fn(async () => true);
    const resetWorkingTM = vi.fn(async () => 12);
    const reload = vi.fn(async () => {});
    const runMutation = vi.fn(async <T>(operation: () => Promise<T>) => operation());

    await expect(
      resetWorkingTMAction({
        projectId: 7,
        tmId: 'working-1',
        tmName: 'Demo Working TM',
        entryCount: 12,
        confirm,
        resetWorkingTM,
        reload,
        runMutation,
      }),
    ).resolves.toBe(12);

    expect(confirm).toHaveBeenCalledWith({
      title: 'Reset Working TM?',
      message:
        'This will remove all 12 entries from "Demo Working TM". Project files and translations will not be changed.',
      confirmLabel: 'Reset',
      confirmVariant: 'danger',
    });
    expect(resetWorkingTM).toHaveBeenCalledWith(7, 'working-1');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing when reset is cancelled', async () => {
    const resetWorkingTM = vi.fn();
    const reload = vi.fn();
    const runMutation = vi.fn();

    await expect(
      resetWorkingTMAction({
        projectId: 7,
        tmId: 'working-1',
        tmName: 'Demo Working TM',
        entryCount: 12,
        confirm: vi.fn(async () => false),
        resetWorkingTM,
        reload,
        runMutation,
      }),
    ).resolves.toBeNull();

    expect(resetWorkingTM).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
