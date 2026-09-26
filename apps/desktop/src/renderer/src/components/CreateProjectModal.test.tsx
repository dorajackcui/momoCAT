// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CreateProjectModal } from './CreateProjectModal';

describe('one project creation entrypoint', () => {
  it('defaults to local creation without requiring an account', () => {
    const onConfirm = vi.fn();
    render(<CreateProjectModal isOpen onClose={vi.fn()} onConfirm={onConfirm} loading={false} />);
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Local draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(onConfirm).toHaveBeenCalledWith(
      'Local draft',
      expect.any(String),
      expect.any(String),
      'translation',
      'local',
    );
  });
  it('uses the same fields for a cloud project and requires sign-in only for that choice', () => {
    const onConfirm = vi.fn();
    const props = { isOpen: true, onClose: vi.fn(), onConfirm, loading: false };
    const { rerender } = render(
      <CreateProjectModal {...props} cloudStatus={{ configured: true, account: null }} />,
    );
    fireEvent.change(screen.getByLabelText('Project Name'), { target: { value: 'Cloud draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cloud', exact: true }));
    expect(screen.getByRole('button', { name: 'Create Project' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeVisible();
    rerender(
      <CreateProjectModal
        {...props}
        cloudStatus={{
          configured: true,
          account: { id: 'a', name: 'Alice', email: 'a@example.test' },
        }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create Project' }));
    expect(onConfirm).toHaveBeenCalledWith(
      'Cloud draft',
      expect.any(String),
      expect.any(String),
      'translation',
      'cloud',
    );
  });
});
