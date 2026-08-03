import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectFileRecord } from '../../../../shared/ipc';
import {
  ProjectReferenceActionsModal,
  runProjectReferenceAction,
} from './ProjectReferenceActionsModal';

describe('ProjectReferenceActionsModal', () => {
  it('offers source term extraction and the existing reference export', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectReferenceActionsModal, {
        file: { id: 7, name: 'demo.xlsx' } as ProjectFileRecord,
        onClose: vi.fn(),
        onPrecheckSourceTerms: vi.fn(),
        onExportReferences: vi.fn(),
      }),
    );

    expect(html).toContain('TM/TB Tools');
    expect(html).toContain('Extract Source Terms');
    expect(html).toContain('Export TM/TB References');
    expect(html).toContain('type="radio"');
    expect(html).toContain('Confirm');
    expect(html).toContain('demo.xlsx');
  });

  it('executes only the selected operation after confirmation', () => {
    const file = { id: 7, name: 'demo.xlsx' } as ProjectFileRecord;
    const onPrecheckSourceTerms = vi.fn();
    const onExportReferences = vi.fn();
    const callbacks = { onPrecheckSourceTerms, onExportReferences };

    runProjectReferenceAction('precheck', file, callbacks);
    expect(onPrecheckSourceTerms).toHaveBeenCalledWith(file);
    expect(onExportReferences).not.toHaveBeenCalled();

    onPrecheckSourceTerms.mockClear();
    runProjectReferenceAction('export', file, callbacks);
    expect(onExportReferences).toHaveBeenCalledWith(file);
    expect(onPrecheckSourceTerms).not.toHaveBeenCalled();
  });
});
