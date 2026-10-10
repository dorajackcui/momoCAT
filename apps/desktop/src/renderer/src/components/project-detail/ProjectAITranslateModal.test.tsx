// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectAITranslateModal } from './ProjectAITranslateModal';

afterEach(cleanup);

describe('AI translation scope dialog', () => {
  it('retains Tips after a failed start and only clears them after a successful start', async () => {
    const onConfirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(
      <ProjectAITranslateModal
        open
        fileName="names.xlsx"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const tips = screen.getByRole('textbox', { name: 'AI translation tips' });
    fireEvent.change(tips, { target: { value: 'Keep names concise.' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
    expect(tips).toHaveValue('Keep names concise.');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
    expect(tips).toHaveValue('');
    expect(onConfirm).toHaveBeenNthCalledWith(2, {
      targetBaseline: 'use-current-targets',
      tips: 'Keep names concise.',
    });
  });

  it('blocks repeated submissions and draft edits until the start request settles', async () => {
    let finish!: (started: boolean) => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <ProjectAITranslateModal
        open
        fileName="names.xlsx"
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    const tips = screen.getByRole('textbox', { name: 'AI translation tips' });
    fireEvent.change(tips, { target: { value: 'Keep names concise.' } });
    const start = screen.getByRole('button', { name: 'Start AI Translate' });
    fireEvent.click(start);
    fireEvent.click(start);
    fireEvent.keyDown(tips, { key: 'Enter', ctrlKey: true });
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(start).toBeDisabled();
    expect(tips).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    await act(async () => {
      finish(false);
    });
    expect(start).toBeEnabled();
    expect(tips).toBeEnabled();
    expect(tips).toHaveValue('Keep names concise.');
  });

  it('retains a cancelled draft, submits trimmed multiline Tips, and clears them for the next run', async () => {
    const onConfirm = vi.fn().mockReturnValue(true);
    const onClose = vi.fn();
    const props = {
      fileName: 'names.xlsx',
      filteredSegmentCount: 3,
      totalSegmentCount: 80,
      onClose,
      onConfirm,
    };
    const { rerender } = render(<ProjectAITranslateModal {...props} open />);
    fireEvent.change(screen.getByRole('textbox', { name: 'AI translation tips' }), {
      target: { value: '  Use short verbs.\nKeep product names.  ' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI translation tips' }), {
      key: 'Enter',
    });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<ProjectAITranslateModal {...props} open={false} />);
    rerender(<ProjectAITranslateModal {...props} open />);
    expect(screen.getByRole('textbox', { name: 'AI translation tips' })).toHaveValue(
      '  Use short verbs.\nKeep product names.  ',
    );
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI translation tips' }), {
        key: 'Enter',
        ctrlKey: true,
      });
    });
    expect(onConfirm).toHaveBeenLastCalledWith({
      targetBaseline: 'use-current-targets',
      scope: 'filtered',
      tips: 'Use short verbs.\nKeep product names.',
    });
    expect(screen.getByRole('textbox', { name: 'AI translation tips' })).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox', { name: 'AI translation tips' }), {
      target: { value: ' \n ' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
    expect(onConfirm).toHaveBeenLastCalledWith({
      targetBaseline: 'use-current-targets',
      scope: 'filtered',
    });
  });

  it('does not submit during IME composition or for an empty scope', () => {
    const onConfirm = vi.fn();
    const props = { fileName: 'names.xlsx', totalSegmentCount: 80, onClose: vi.fn(), onConfirm };
    const { rerender } = render(
      <ProjectAITranslateModal {...props} open filteredSegmentCount={3} />,
    );
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI translation tips' }), {
      key: 'Enter',
      metaKey: true,
      isComposing: true,
    });
    expect(onConfirm).not.toHaveBeenCalled();
    rerender(<ProjectAITranslateModal {...props} open filteredSegmentCount={0} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'AI translation tips' }), {
      key: 'Enter',
      metaKey: true,
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('defaults to filtered results and can switch to the entire file with overwrite', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
    expect(onConfirm).toHaveBeenLastCalledWith({
      targetBaseline: 'use-current-targets',
      scope: 'filtered',
    });
    fireEvent.change(screen.getByLabelText('Translation Scope'), { target: { value: 'file' } });
    fireEvent.change(screen.getByLabelText('Target Baseline'), {
      target: { value: 'ignore-current-targets' },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
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

  it('keeps the Files tab whole-file submission contract', async () => {
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
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Start AI Translate' }));
    });
    expect(onConfirm).toHaveBeenCalledWith({ targetBaseline: 'use-current-targets' });
  });
});
