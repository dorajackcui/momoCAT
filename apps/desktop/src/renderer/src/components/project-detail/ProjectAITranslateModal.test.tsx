// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAITranslateModal } from './ProjectAITranslateModal';

afterEach(cleanup);

describe('AI translation scope dialog', () => {
  it('defaults to filtered results and can switch to the entire file with overwrite', () => {
    const onConfirm = vi.fn();
    render(
      <ProjectAITranslateModal
        open
        fileName="names.xlsx"
        filteredSegmentCount={3}
        totalSegmentCount={80}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByLabelText('Translation Scope')).toHaveValue('filtered');
    expect(screen.getByText('Current filtered results (3 segments)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      targetBaseline: 'use-current-targets',
      scope: 'filtered',
    });
    fireEvent.change(screen.getByLabelText('Translation Scope'), { target: { value: 'file' } });
    fireEvent.change(screen.getByLabelText('Target Baseline'), {
      target: { value: 'ignore-current-targets' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    expect(onConfirm).toHaveBeenLastCalledWith({
      targetBaseline: 'ignore-current-targets',
      scope: 'file',
    });
  });

  it('blocks empty filtered results until the user explicitly chooses the entire file', () => {
    render(
      <ProjectAITranslateModal
        open
        fileName="names.xlsx"
        filteredSegmentCount={0}
        totalSegmentCount={80}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Start AI Translate' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Translation Scope'), { target: { value: 'file' } });
    expect(screen.getByRole('button', { name: 'Start AI Translate' })).toBeEnabled();
  });

  it('keeps the Files tab whole-file submission contract', () => {
    const onConfirm = vi.fn();
    render(
      <ProjectAITranslateModal
        open
        fileName="names.xlsx"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.queryByLabelText('Translation Scope')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    expect(onConfirm).toHaveBeenCalledWith({ targetBaseline: 'use-current-targets' });
  });
});
