import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MountedTM } from '../../../../shared/ipc';
import { ProjectTMPane } from './ProjectTMPane';

function renderWorkingTM(entryCount: number): string {
  const workingTM = {
    id: 'working-1',
    name: 'Demo Working TM',
    srcLang: 'en',
    tgtLang: 'fr',
    type: 'working',
    createdAt: '',
    updatedAt: '',
    priority: 0,
    permission: 'readwrite',
    isEnabled: 1,
    entryCount,
  } as MountedTM;

  return renderToStaticMarkup(
    React.createElement(ProjectTMPane, {
      mountedTMs: [workingTM],
      allMainTMs: [],
      loading: false,
      error: null,
      onRetry: vi.fn(),
      onMountTM: vi.fn(),
      onUnmountTM: vi.fn(),
      onExportWorkingTM: vi.fn(),
      onResetWorkingTM: vi.fn(),
    }),
  );
}

describe('ProjectTMPane', () => {
  it('keeps Working TM management limited to Export and Reset', () => {
    const html = renderWorkingTM(3);

    expect(html).toContain('Export');
    expect(html).toContain('Reset');
    expect(html).not.toContain('Import');
    expect(html).not.toContain('Rename');
  });

  it('disables both actions for an empty Working TM', () => {
    const html = renderWorkingTM(0);

    expect(html.match(/<button[^>]*disabled=""[^>]*>/g)).toHaveLength(2);
  });

  it('shows a visible loading state before TM data arrives', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectTMPane, {
        mountedTMs: [],
        allMainTMs: [],
        loading: true,
        error: null,
        onRetry: vi.fn(),
        onMountTM: vi.fn(),
        onUnmountTM: vi.fn(),
        onExportWorkingTM: vi.fn(),
        onResetWorkingTM: vi.fn(),
      }),
    );

    expect(html).toContain('Loading translation memories');
    expect(html).not.toContain('No Main TMs mounted');
  });

  it('shows a retry action when TM loading fails', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectTMPane, {
        mountedTMs: [],
        allMainTMs: [],
        loading: false,
        error: 'Database busy',
        onRetry: vi.fn(),
        onMountTM: vi.fn(),
        onUnmountTM: vi.fn(),
        onExportWorkingTM: vi.fn(),
        onResetWorkingTM: vi.fn(),
      }),
    );

    expect(html).toContain('Could not load translation memories: Database busy');
    expect(html).toContain('Retry');
  });
});
