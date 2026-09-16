// @vitest-environment jsdom
import { createRef } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { EditorRowTargetActions } from './EditorRowTargetActions';

function createProps() {
  return {
    tagMenuAnchorRef: createRef<HTMLButtonElement>(),
    isTagMenuOpen: false,
    hasRefinableTarget: false,
    isAIBusy: false,
    canAITranslate: true,
    canInsertTags: true,
    onAIRefine: vi.fn(),
    onAITranslate: vi.fn(),
    onFocusTarget: vi.fn(),
    onToggleTagInsertionUI: vi.fn(),
  };
}

it('offers only AI and tags, translating an empty target in one click', () => {
  const props = createProps();
  render(<EditorRowTargetActions {...props} />);
  expect(screen.getAllByRole('button')).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'AI translate this segment' }));
  expect(props.onAITranslate).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle tag insertion menu' }));
  expect(props.onToggleTagInsertionUI).toHaveBeenCalledOnce();
});

it('focuses the refinement prompt and submits only a nonempty, completed instruction', async () => {
  const props = { ...createProps(), hasRefinableTarget: true };
  render(<EditorRowTargetActions {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI refine this translation' }));
  const input = screen.getByRole('textbox', { name: 'AI refine instruction' });
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.change(input, { target: { value: '   ' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(props.onAIRefine).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Refine ↵' })).toBeDisabled();
  fireEvent.change(input, { target: { value: '  更简洁  ' } });
  fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
  expect(props.onAIRefine).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(props.onAIRefine).toHaveBeenCalledExactlyOnceWith('更简洁');
  expect(props.onAITranslate).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('discards a dismissed prompt and keeps retranslation explicitly available', async () => {
  const props = { ...createProps(), hasRefinableTarget: true };
  render(<EditorRowTargetActions {...props} />);
  const ai = screen.getByRole('button', { name: 'AI refine this translation' });
  fireEvent.click(ai);
  const input = screen.getByRole('textbox');
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.change(input, { target: { value: 'Discard this' } });
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(props.onFocusTarget).toHaveBeenCalledOnce();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(ai);
  expect(screen.getByRole('textbox')).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Retranslate' }));
  expect(props.onAITranslate).toHaveBeenCalledOnce();
  expect(props.onAIRefine).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('blocks both AI actions while busy, including a previously opened popover', () => {
  const props = { ...createProps(), hasRefinableTarget: true };
  const { rerender } = render(<EditorRowTargetActions {...props} />);
  fireEvent.click(screen.getByRole('button', { name: 'AI refine this translation' }));
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Shorter' } });
  rerender(<EditorRowTargetActions {...props} isAIBusy />);
  expect(screen.getByRole('textbox')).toBeDisabled();
  for (const name of ['AI refine this translation', 'Retranslate', 'Refine ↵']) {
    const button = screen.getByRole('button', { name });
    expect(button).toBeDisabled();
    fireEvent.click(button);
  }
  expect(props.onAIRefine).not.toHaveBeenCalled();
  expect(props.onAITranslate).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Toggle tag insertion menu' })).toBeEnabled();
});
