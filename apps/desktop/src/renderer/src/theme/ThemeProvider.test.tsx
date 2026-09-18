// @vitest-environment jsdom
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppearancePicker } from '../components/ui/AppearancePicker';
import { THEME_STORAGE_KEYS, type ThemeScope } from './themePreferences';
import { ThemeProvider } from './ThemeProvider';
import { TypographyProvider } from './TypographyProvider';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-color-theme');
});

function example(scope: ThemeScope) {
  return (
    <ThemeProvider scope={scope}>
      <TypographyProvider scope={scope}>
        <AppearancePicker />
      </TypographyProvider>
    </ThemeProvider>
  );
}

it('restores independent workspace and editor preferences across navigation and remounts', async () => {
  const { rerender, unmount } = render(example('editor'));
  const root = document.documentElement;
  expect(root).toHaveAttribute('data-color-theme', 'classic');
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  const colors = await screen.findByRole('group', { name: 'Color scheme' });
  expect(within(colors).getByRole('radio', { name: 'Classic' })).toBeChecked();
  expect(within(colors).getAllByRole('radio')).toHaveLength(2);
  fireEvent.click(within(colors).getByRole('radio', { name: 'Nord' }));
  expect(root).toHaveAttribute('data-color-theme', 'nord');
  expect(localStorage.getItem(THEME_STORAGE_KEYS.editor)).toBe('nord');

  rerender(example('workspace'));
  expect(root).toHaveAttribute('data-color-theme', 'classic');
  fireEvent.click(within(colors).getByRole('radio', { name: 'Nord' }));
  expect(localStorage.getItem(THEME_STORAGE_KEYS.workspace)).toBe('nord');
  rerender(example('editor'));
  expect(root).toHaveAttribute('data-color-theme', 'nord');
  fireEvent.click(within(colors).getByRole('radio', { name: 'Classic' }));
  unmount();
  expect(root).not.toHaveAttribute('data-color-theme');
  const reopened = render(example('workspace'));
  expect(root).toHaveAttribute('data-color-theme', 'nord');
  reopened.rerender(example('editor'));
  expect(root).toHaveAttribute('data-color-theme', 'classic');
});

it.each([
  ['charcoal', 'nord'],
  ['ivory', 'classic'],
  ['blue', 'classic'],
  ['flexoki', 'classic'],
  ['unknown', 'classic'],
])('restores the replacement for retired or unknown theme %s', (old, next) => {
  localStorage.setItem(THEME_STORAGE_KEYS.editor, old);
  render(example('editor'));
  expect(document.documentElement).toHaveAttribute('data-color-theme', next);
});

it('still lets the user switch colors when preference storage is unavailable', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Storage is blocked');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Storage is full');
  });
  try {
    render(example('editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    const colors = await screen.findByRole('group', { name: 'Color scheme' });
    fireEvent.click(within(colors).getByRole('radio', { name: 'Nord' }));
    expect(document.documentElement).toHaveAttribute('data-color-theme', 'nord');
    expect(within(colors).getByRole('radio', { name: 'Nord' })).toBeChecked();
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
