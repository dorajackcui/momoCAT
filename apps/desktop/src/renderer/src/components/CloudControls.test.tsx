// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { CloudStatus } from '../../../shared/cloud';
import { CloudSyncControl } from './CloudControls';

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

function show(status: CloudStatus | null, disabled = false) {
  const onSync = vi.fn();
  const onResolveConflict = vi.fn();
  const result = render(
    <CloudSyncControl
      status={status}
      onSync={onSync}
      onResolveConflict={onResolveConflict}
      disabled={disabled}
    />,
  );
  return { ...result, onSync, onResolveConflict };
}

describe('cloud sync control', () => {
  it('offers one compact sync action without a project banner', () => {
    const { onSync } = show(base);
    const button = screen.getByRole('button', { name: 'Sync with cloud' });
    expect(button).toHaveAccessibleDescription('Ready to sync');
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByText('Product')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(onSync).toHaveBeenCalledOnce();
  });

  it.each([
    { ...base, pending: true },
    { ...base, pending: false, pendingElsewhere: true },
    { ...base, pending: false, project: { ...base.project!, pending: true } },
  ])('reports pending work anywhere in the account', (status) => {
    show(status);
    expect(screen.getByRole('button', { name: 'Sync with cloud' })).toHaveAccessibleDescription(
      'Unsynced changes',
    );
  });

  it('keeps last success in the tooltip and blocks duplicate sync', () => {
    const lastSyncedAt = '2026-09-30T01:00:00.000Z';
    const { onSync } = show({ ...base, syncing: true, lastSyncedAt });
    const button = screen.getByRole('button', { name: 'Sync with cloud' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute(
      'title',
      `Sync with cloud · Syncing…. Last sync ${new Date(lastSyncedAt).toLocaleString()}`,
    );
    fireEvent.click(button);
    expect(onSync).not.toHaveBeenCalled();
  });

  it('opens accessible failure details and retries only by explicit action', () => {
    const { onSync } = show({ ...base, error: 'Network unavailable', pending: true });
    const button = screen.getByRole('button', { name: 'Sync with cloud' });
    expect(button).toHaveAccessibleDescription('Sync failed');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Sync failed' });
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(onSync).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Retry sync' }));
    expect(onSync).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('explains a conflict before explicit local-copy recovery', () => {
    const { onResolveConflict, onSync } = show({ ...base, conflict: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    const dialog = screen.getByRole('dialog', { name: 'Sync conflict' });
    expect(within(dialog).getByText(/Your local work is preserved/)).toBeVisible();
    expect(onResolveConflict).not.toHaveBeenCalled();
    expect(onSync).not.toHaveBeenCalled();
    expect(within(dialog).queryByRole('button', { name: 'Retry sync' })).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save local copy and get latest' }));
    expect(onResolveConflict).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lets users dismiss conflict details without changing their work', () => {
    const { onSync, onResolveConflict } = show({ ...base, conflict: true });
    fireEvent.click(screen.getByRole('button', { name: 'Sync with cloud' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onSync).not.toHaveBeenCalled();
    expect(onResolveConflict).not.toHaveBeenCalled();
  });

  it('stays available in local and independent resource views after sign-in', () => {
    show({ ...base, context: undefined, project: undefined, pendingElsewhere: true });
    expect(screen.getByRole('button', { name: 'Sync with cloud' })).toBeEnabled();
  });

  it('does not appear before sign-in', () => {
    const { rerender } = show(null);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(
      <CloudSyncControl
        status={{ ...base, account: null }}
        onSync={vi.fn()}
        onResolveConflict={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('respects an active-operation navigation guard', () => {
    const { onSync } = show(base, true);
    const button = screen.getByRole('button', { name: 'Sync with cloud' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSync).not.toHaveBeenCalled();
  });
});
