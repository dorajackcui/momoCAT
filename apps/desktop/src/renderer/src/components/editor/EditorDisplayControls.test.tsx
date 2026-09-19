// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ThemeProvider } from '../../theme/ThemeProvider';
import { TypographyProvider } from '../../theme/TypographyProvider';
import { EditorDisplayControls } from './EditorDisplayControls';

it('keeps the display toggle and appearance available independently of batch actions', async () => {
  const onToggle = vi.fn();
  const example = (enabled: boolean, canRunActions = true) => (
    <ThemeProvider scope="editor">
      <TypographyProvider scope="editor">
        <EditorDisplayControls
          canRunActions={canRunActions}
          showNonPrintingSymbols={enabled}
          onToggleNonPrintingSymbols={onToggle}
        />
      </TypographyProvider>
    </ThemeProvider>
  );
  const { rerender } = render(example(false));
  const group = within(screen.getByRole('group', { name: 'Display settings' }));
  const toggle = group.getByRole('button', { name: 'Toggle non-printing symbols' });
  expect(toggle).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledOnce();
  rerender(example(true));
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(toggle).toHaveAttribute('title', 'Hide non-printing symbols');
  rerender(example(true, false));
  expect(toggle).toBeDisabled();
  fireEvent.click(toggle);
  expect(onToggle).toHaveBeenCalledOnce();
  fireEvent.click(group.getByRole('button', { name: 'Editor appearance' }));
  expect(await screen.findByRole('group', { name: 'Color scheme' })).toBeVisible();
});
