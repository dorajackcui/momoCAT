import { describe, expect, it, vi } from 'vitest';
import type {
  FileSourceTerminologyPrecheckResult,
  ProjectFileRecord,
} from '../../../../shared/ipc';
import { INSPECT_OUTPUT_FILTERS } from './fileInspectAction';
import {
  buildSourceTerminologyPrecheckDefaultPath,
  runSourceTerminologyPrecheckAction,
} from './sourceTerminologyPrecheckAction';

const file = {
  id: 7,
  projectId: 1,
  name: 'demo.xlsx',
} as ProjectFileRecord;

describe('source terminology precheck action', () => {
  it('builds a source term workbook path', () => {
    expect(buildSourceTerminologyPrecheckDefaultPath('demo.xlsx')).toBe('demo_source_terms.xlsx');
  });

  it('runs the precheck and reports unique source candidates', async () => {
    const result: FileSourceTerminologyPrecheckResult = {
      outputPath: 'D:/out/demo_source_terms.xlsx',
      summary: { total: 3, ready: 3, error: 0, uniqueTerms: 5 },
    };
    const saveFileDialog = vi.fn(async () => result.outputPath);
    const precheckSourceTerminology = vi.fn(async () => result);
    const success = vi.fn();

    const actual = await runSourceTerminologyPrecheckAction(file, {
      saveFileDialog,
      precheckSourceTerminology,
      runMutation: async (fn) => fn(),
      success,
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(saveFileDialog).toHaveBeenCalledWith('demo_source_terms.xlsx', INSPECT_OUTPUT_FILTERS);
    expect(precheckSourceTerminology).toHaveBeenCalledWith(7, result.outputPath);
    expect(success).toHaveBeenCalledWith(
      'Source term precheck exported: 3/3 rows ready, 5 unique candidates.',
    );
    expect(actual).toBe(result);
  });

  it('does not call the prechecker when the save dialog is cancelled', async () => {
    const precheckSourceTerminology = vi.fn();
    const actual = await runSourceTerminologyPrecheckAction(file, {
      saveFileDialog: vi.fn(async () => null),
      precheckSourceTerminology,
      runMutation: async (fn) => fn(),
      success: vi.fn(),
      info: vi.fn(),
      error: vi.fn(),
    });

    expect(precheckSourceTerminology).not.toHaveBeenCalled();
    expect(actual).toBeNull();
  });
});
