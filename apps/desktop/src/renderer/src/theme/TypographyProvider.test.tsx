// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { TypographyProvider } from './TypographyProvider';
import { AppearancePicker } from '../components/ui/AppearancePicker';
import { TYPOGRAPHY_STORAGE_KEYS } from './typography';
import type { ThemeScope } from './themePreferences';

beforeEach(() => localStorage.clear());
const example = (scope: ThemeScope) => (
  <ThemeProvider scope={scope}>
    <TypographyProvider scope={scope}>
      <AppearancePicker />
    </TypographyProvider>
  </ThemeProvider>
);

it('keeps scripts, palettes and workspace preferences independent across remounts', async () => {
  const { rerender, unmount } = render(example('editor'));
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  expect(await screen.findByRole('radio', { name: 'Noto Sans SC · 黑体' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Source Serif 4' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '16 px' })).toBeChecked();
  expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  expect(screen.getAllByRole('group')).toHaveLength(4);
  fireEvent.click(screen.getByRole('radio', { name: 'Noto Serif SC · 宋体' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Source Sans 3' }));
  fireEvent.click(screen.getByRole('radio', { name: '14 px' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Nord' }));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-sans');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '14');
  rerender(example('workspace'));
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-sans');
  expect(document.documentElement).toHaveAttribute('data-content-size', '16');
  unmount();
  expect(document.documentElement).not.toHaveAttribute('data-content-latin');
  expect(document.documentElement).not.toHaveAttribute('data-content-size');
  render(example('editor'));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-sans');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '14');
});

it.each(['{invalid', JSON.stringify({ latin: 'missing', cjk: 'missing', fontSize: 18 })])(
  'recovers invalid font preferences: %s',
  (saved) => {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEYS.editor, saved);
    render(example('editor'));
    expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-serif');
    expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-sans');
    expect(document.documentElement).toHaveAttribute('data-content-size', '16');
  },
);

it('restores older choices with the default size and replaces the retired Western font', () => {
  localStorage.setItem(
    TYPOGRAPHY_STORAGE_KEYS.editor,
    JSON.stringify({ latin: 'noto-serif', cjk: 'noto-serif' }),
  );
  render(example('editor'));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-serif');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '16');
});

it('allows font changes when storage fails', async () => {
  const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('full');
  });
  try {
    render(example('editor'));
    fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Source Sans 3' }));
    fireEvent.click(screen.getByRole('radio', { name: '14 px' }));
    expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-sans');
    expect(document.documentElement).toHaveAttribute('data-content-size', '14');
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
