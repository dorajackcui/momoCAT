// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CloudStatus } from '../../../shared/cloud';
import { CloudBanner } from './CloudControls';

const base: CloudStatus = {
  configured: true,
  account: { id: 'account', name: 'Translator', email: 'translator@example.test' },
  context: 'cloud',
  project: {
    id: 'cloud-project',
    projectId: 1,
    name: 'Product',
    revision: 1,
    pending: false,
    writable: true,
  },
};

function show(status: CloudStatus) {
  const onSync = vi.fn();
  const onResolveConflict = vi.fn();
  render(<CloudBanner status={status} onSync={onSync} onResolveConflict={onResolveConflict} />);
  return { onSync, onResolveConflict };
}

describe('cloud sync control', () => {
  it('offers one sync action and reports unsynced changes', () => {
    const { onSync } = show({ ...base, pending: true });
    expect(screen.getByText('Unsynced changes')).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    expect(onSync).toHaveBeenCalledOnce();
    expect(screen.queryByText('Save to cloud')).not.toBeInTheDocument();
    expect(screen.queryByText('Get latest')).not.toBeInTheDocument();
  });

  it('blocks duplicate sync and displays the last success time', () => {
    show({ ...base, syncing: true, lastSyncedAt: '2026-09-30T01:00:00.000Z' });
    expect(screen.getByText('Syncing…')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync with cloud' })).toBeDisabled();
    expect(screen.getByTitle('2026-09-30T01:00:00.000Z')).toBeVisible();
  });

  it('keeps failure visible and allows retry', () => {
    const { onSync } = show({ ...base, error: 'Network unavailable', pending: true });
    expect(screen.getByText('Sync failed')).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    expect(onSync).toHaveBeenCalledOnce();
  });

  it('offers explicit local-copy recovery only when there is a conflict', () => {
    const { onResolveConflict } = show({ ...base, conflict: true });
    expect(screen.getByText('Sync conflict')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Save local copy and get latest' }));
    expect(onResolveConflict).toHaveBeenCalledOnce();
  });

  it('supports independent resource management without an open project', () => {
    show({ ...base, project: undefined, resourceKind: 'tb', pending: true });
    expect(screen.getByText('Cloud term bases')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Sync with cloud' })).toBeEnabled();
  });
});
