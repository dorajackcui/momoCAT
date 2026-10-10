// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ThemeProvider } from './ThemeProvider';
import { TypographyProvider } from './TypographyProvider';
import { AppearanceControls, AppearancePicker } from '../components/ui/AppearancePicker';
import { readTypography, TYPOGRAPHY_STORAGE_KEY } from './typography';
import type { ThemeScope } from './themePreferences';

beforeEach(() => localStorage.clear());
const example = (scope: ThemeScope) => (
  <ThemeProvider scope={scope}>
    <TypographyProvider scope={scope}>
      {scope === 'editor' ? <AppearancePicker /> : <AppearanceControls layout="settings" />}
    </TypographyProvider>
  </ThemeProvider>
);

it('restores CAT fonts across workspace navigation and remounts while ignoring retired workspace fonts', async () => {
  localStorage.setItem(
    'momocat.workspace.typography',
    JSON.stringify({ latin: 'inter', cjk: 'noto-serif', fontSize: 14 }),
  );
  const { rerender, unmount } = render(example('editor'));
  fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
  expect(await screen.findByRole('radio', { name: 'Noto Sans SC · 黑体' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Source Serif 4' })).toBeChecked();
  expect(screen.getByRole('radio', { name: '16 px' })).toBeChecked();
  expect(document.documentElement).toHaveAttribute('data-typography-scope', 'editor');
  expect(screen.queryAllByRole('combobox')).toHaveLength(0);
  expect(screen.getAllByRole('group')).toHaveLength(4);
  fireEvent.click(screen.getByRole('radio', { name: 'Noto Serif SC · 宋体' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Inter' }));
  fireEvent.click(screen.getByRole('radio', { name: '15 px' }));
  fireEvent.click(screen.getByRole('radio', { name: 'Nord' }));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'inter');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '15');
  rerender(example('workspace'));
  expect(document.documentElement).not.toHaveAttribute('data-typography-scope');
  expect(document.documentElement).not.toHaveAttribute('data-content-latin');
  expect(document.documentElement).not.toHaveAttribute('data-content-cjk');
  expect(document.documentElement).not.toHaveAttribute('data-content-size');
  expect(screen.getByRole('group', { name: 'Color scheme' })).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Fonts' })).not.toBeInTheDocument();
  for (const name of ['Chinese font', 'Western font', 'Font size'])
    expect(screen.queryByRole('group', { name })).not.toBeInTheDocument();
  unmount();
  expect(document.documentElement).not.toHaveAttribute('data-typography-scope');
  expect(document.documentElement).not.toHaveAttribute('data-content-latin');
  expect(document.documentElement).not.toHaveAttribute('data-content-size');
  render(example('editor'));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'inter');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '15');
});

it.each(['{invalid', JSON.stringify({ latin: 'missing', cjk: 'missing', fontSize: 18 })])(
  'recovers invalid font preferences: %s',
  (saved) => {
    localStorage.setItem(TYPOGRAPHY_STORAGE_KEY, saved);
    render(example('editor'));
    expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-serif');
    expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-sans');
    expect(document.documentElement).toHaveAttribute('data-content-size', '16');
  },
);

it('restores older choices with the default size and replaces the retired Western font', () => {
  localStorage.setItem(
    TYPOGRAPHY_STORAGE_KEY,
    JSON.stringify({ latin: 'noto-serif', cjk: 'noto-serif' }),
  );
  render(example('editor'));
  expect(document.documentElement).toHaveAttribute('data-content-latin', 'source-serif');
  expect(document.documentElement).toHaveAttribute('data-content-cjk', 'noto-serif');
  expect(document.documentElement).toHaveAttribute('data-content-size', '16');
});

it.each(['source-sans', 'libron'])('migrates saved CAT %s choices to Inter', (latin) => {
  localStorage.setItem(
    TYPOGRAPHY_STORAGE_KEY,
    JSON.stringify({ latin, cjk: 'noto-serif', fontSize: 14 }),
  );
  expect(readTypography()).toEqual({ latin: 'inter', cjk: 'noto-serif', fontSize: 14 });
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
    fireEvent.click(await screen.findByRole('radio', { name: 'Inter' }));
    fireEvent.click(screen.getByRole('radio', { name: '14 px' }));
    expect(document.documentElement).toHaveAttribute('data-content-latin', 'inter');
    expect(document.documentElement).toHaveAttribute('data-content-size', '14');
  } finally {
    read.mockRestore();
    write.mockRestore();
  }
});
