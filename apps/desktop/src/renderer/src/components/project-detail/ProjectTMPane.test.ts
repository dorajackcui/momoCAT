import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MountedTM } from '../../../../shared/ipc';
import { ProjectTMPane } from './ProjectTMPane';

function renderWorkingTM(
  entryCount: number,
  state: { loading?: boolean; error?: string | null } = {},
): string {
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
      loadState: { loading: state.loading ?? false, loaded: true, error: state.error ?? null },
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
        loadState: { loading: true, loaded: false, error: null },
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
        loadState: { loading: false, loaded: false, error: 'Database busy' },
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

  it('keeps valid TM content visible during refreshes and refresh failures', () => {
    const refreshing = renderWorkingTM(3, { loading: true });
    expect(refreshing).toContain('Demo Working TM');
    expect(refreshing).not.toContain('Loading translation memories');

    const failedRefresh = renderWorkingTM(3, { error: 'Database busy' });
    expect(failedRefresh).toContain('Demo Working TM');
    expect(failedRefresh).toContain('Could not refresh translation memories: Database busy');
    expect(failedRefresh).toContain('Retry');
  });

  it('keeps a successfully loaded empty state visible during refresh', () => {
    const html = renderToStaticMarkup(
      React.createElement(ProjectTMPane, {
        mountedTMs: [],
        allMainTMs: [],
        loadState: { loading: true, loaded: true, error: null },
        onRetry: vi.fn(),
        onMountTM: vi.fn(),
        onUnmountTM: vi.fn(),
        onExportWorkingTM: vi.fn(),
        onResetWorkingTM: vi.fn(),
      }),
    );

    expect(html).toContain('No Working TM is mounted');
    expect(html).toContain('No Main TMs mounted');
    expect(html).not.toContain('Loading translation memories');
  });
});
