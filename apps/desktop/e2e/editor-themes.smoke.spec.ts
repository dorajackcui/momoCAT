import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { DesktopApi } from '../src/shared/ipc';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import { prepareEditorReadingScene } from './support/editorReadingScene';
import { closeEditorSmokeSession, createEditorSmokeSession } from './support/editorSmokeSession';

function luminance(rgb: string): number {
  const channels = rgb
    .trim()
    .split(/\s+/)
    .map(Number)
    .map((value) => {
      const s = value / 255;
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('shares control and typography tokens across workspace and CAT with independent appearance choices', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, projectName } = session;
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'sand');
    await expect(page.locator('.workspace-sidebar')).toHaveCSS(
      'background-color',
      'rgb(249, 249, 248)',
    );
    await expect(page.getByRole('button', { name: '+ Add File', exact: true })).toHaveCSS(
      'background-color',
      'rgb(183, 88, 56)',
    );
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: test.info().outputPath('sand-workspace.png'),
      animations: 'disabled',
    });

    // One design-token change reaches text buttons, icon buttons and editor controls.
    await page.evaluate(() => {
      document.documentElement.style.setProperty('--control-size-sm', '34px');
      document.documentElement.style.setProperty('--font-size-xs', '13px');
    });
    const match = page.getByRole('button', { name: 'Match', exact: true });
    await expect(match).toHaveCSS('height', '34px');
    await expect(match).toHaveCSS('font-size', '13px');
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    const appearance = page.getByRole('button', { name: 'Editor appearance', exact: true });
    await expect(appearance).toHaveCSS('height', '34px');
    await expect(appearance).toHaveCSS('font-size', '13px');
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'classic');
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--control-size-sm');
      document.documentElement.style.removeProperty('--font-size-xs');
    });
    await expect(appearance).toHaveCSS('height', '28px');
    await appearance.click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Nord', { exact: true })
      .click();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(page.getByRole('radio', { name: 'Sand', exact: true })).toBeChecked();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Classic', { exact: true })
      .click();
    for (const [group, label] of [
      ['Chinese font', 'Noto Serif SC · 宋体'],
      ['Western font', 'Source Sans 3'],
      ['Font size', '14 px'],
    ])
      await page.getByRole('group', { name: group }).getByText(label, { exact: true }).click();
    await page.evaluate(() =>
      (window as unknown as { api: DesktopApi }).api.createTM('Typography preview', 'en', 'zh'),
    );
    await session.electronApp.evaluate(({ ipcMain }, channel) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (_event, tmId) => ({
        tmId,
        rows: [
          {
            id: 'type-preview',
            source: 'Reading text',
            target: '阅读正文',
            updatedAt: '2026-09-19T00:00:00Z',
            usageCount: 1,
          },
        ],
      }));
    }, IPC_CHANNELS.tm.preview);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'classic');
    await page.getByRole('button', { name: 'Translation memory', exact: true }).click();
    await page.getByRole('button', { name: 'Preview Typography preview', exact: true }).click();
    const source = page.getByRole('cell', { name: 'Reading text', exact: true });
    await expect(source).toHaveCSS('font-size', '14px');
    await expect(source).toHaveCSS('font-family', /Source Sans 3 Variable.*Noto Serif SC Variable/);
    await expect(page.getByRole('cell', { name: '阅读正文', exact: true })).toHaveCSS(
      'font-size',
      '14px',
    );
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'nord');
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('coordinates complete palettes across CAT and portals while preserving editing and preferences', async () => {
  const testInfo = test.info();
  const session = await createEditorSmokeSession();
  try {
    const { page, projectName } = session;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
    const row = page.locator('div.group.grid').nth(1);
    await row.click();
    const target = row.locator('.cm-content');
    await target.fill('Needle theme draft');
    await target.press('Home');
    await target.press('ArrowRight');
    const originalEditor = await target.elementHandle();
    const button = page.getByRole('button', { name: 'Editor appearance', exact: true });
    await button.click();
    const popup = page.getByRole('dialog', { name: 'Editor appearance', exact: true });
    const colors = popup.getByRole('group', { name: 'Color scheme' });
    await expect(colors.getByRole('radio')).toHaveCount(3);
    await expect(colors.getByRole('radio', { name: 'Classic' })).toBeChecked();
    await expect(page.locator('.workspace-editor')).toHaveCSS(
      'background-color',
      'rgb(235, 224, 216)',
    );

    await button.click();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('classic.png'), animations: 'disabled' });
    await button.click();

    // Official reading colors, with momoCAT's semantic surfaces.
    for (const palette of [
      {
        id: 'sand',
        label: 'Sand',
        background: 'rgb(253, 253, 252)',
        text: 'rgb(33, 32, 28)',
      },
      {
        id: 'classic',
        label: 'Classic',
        background: 'rgb(235, 224, 216)',
        text: 'rgb(30, 30, 30)',
      },
      {
        id: 'nord',
        label: 'Nord',
        background: 'rgb(46, 52, 64)',
        text: 'rgb(216, 222, 233)',
      },
    ]) {
      await colors.getByText(palette.label, { exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', palette.id);
      await expect(row.locator('.editor-source-text')).toHaveCSS('color', palette.text);
      await expect(row.locator('.editor-cell-bg').first()).toHaveCSS(
        'background-color',
        palette.background,
      );
      await expect(target).toHaveCSS('color', palette.text);
      await expect(page.locator('.workspace-editor')).toHaveCSS(
        'background-color',
        palette.background,
      );
      await expect(popup).toHaveCSS('background-color', palette.background);
      const selection = await target.evaluate((el) => {
        const style = getComputedStyle(el, '::selection');
        return [style.backgroundColor, style.color];
      });
      expect(selection[0]).not.toBe('rgba(0, 0, 0, 0)');
      expect(selection[1]).not.toBe(selection[0]);
      await expect(page.locator('.workspace-editor header')).toHaveCSS(
        'background-color',
        palette.background,
      );
      await expect(
        page.getByRole('tablist', { name: 'Editor references' }).locator('..'),
      ).toHaveCSS('background-color', palette.background);
      await expect(page.locator('html')).toHaveCSS(
        'color-scheme',
        palette.id === 'nord' ? 'dark' : 'light',
      );
      const tokens = await page.locator('html').evaluate((element) => {
        const style = getComputedStyle(element);
        const names = [
          'text',
          'text-muted',
          'text-faint',
          'surface',
          'editor-text',
          'surface-chrome',
          'surface-panel',
          'muted',
          'brand',
          'brand-solid',
          'success',
          'warning',
          'danger',
          'info',
          'brand-soft',
          'success-soft',
          'warning-soft',
          'danger-soft',
          'info-soft',
          'brand-contrast',
          'success-contrast',
          'warning-contrast',
          'danger-contrast',
          'info-contrast',
          'highlight',
          'highlight-text',
          'selection',
          'selection-text',
          'match-term',
          'match-term-contrast',
          'match-concordance',
          'match-concordance-contrast',
        ];
        return Object.fromEntries(
          names.map((name) => [name, style.getPropertyValue(`--color-${name}`)]),
        );
      });
      const pairs = [
        ['text', 'surface'],
        ['text-muted', 'surface'],
        ['text-faint', 'surface'],
        ['text-faint', 'muted'],
        ['text-muted', 'surface-chrome'],
        ['text-faint', 'surface-chrome'],
        ['text-muted', 'surface-panel'],
        ['text-faint', 'surface-panel'],
        ['highlight-text', 'highlight'],
        ['selection-text', 'selection'],
        ['match-concordance-contrast', 'match-concordance'],
        ...['brand', 'success', 'warning', 'danger', 'info'].flatMap((tone) => [
          [tone, `${tone}-soft`],
          [`${tone}-contrast`, tone === 'brand' ? 'brand-solid' : tone],
        ]),
      ];
      for (const [foreground, background] of pairs) {
        expect(
          contrast(tokens[foreground], tokens[background]),
          `${palette.id}: ${foreground}/${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      await expect(target).toHaveText('Needle theme draft');
      expect(await originalEditor!.evaluate((element) => element.isConnected)).toBe(true);
      await button.click();
      await page.screenshot({
        path: testInfo.outputPath(`${palette.id}.png`),
        animations: 'disabled',
      });
      await button.click();
    }
    await colors.getByText('Classic', { exact: true }).click();
    await expect(page.locator('.workspace-editor')).toHaveCSS(
      'background-color',
      'rgb(235, 224, 216)',
    );
    await expect(target).toHaveCSS('color', 'rgb(30, 30, 30)');
    await colors.getByText('Nord', { exact: true }).click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByRole('radio', { checked: true })
      .press('Escape');
    await expect(popup).toBeHidden();
    await expect(button).toBeFocused();
    await target.focus();
    await page.keyboard.insertText('X');
    await expect(target).toHaveText('NXeedle theme draft');
    await target.press(`${modifier}+z`);
    await expect(target).toHaveText('Needle theme draft');

    // Keyboard choice, popup dismissal and a separately portalled modal inherit the theme.
    await button.click();
    await colors.getByRole('radio', { name: 'Nord' }).press('ArrowLeft');
    await expect(colors.getByRole('radio', { name: 'Classic' })).toBeChecked();
    await colors.getByRole('radio', { name: 'Classic' }).press('Escape');
    await page.getByRole('button', { name: 'AI batch translate' }).click();
    await expect(page.locator('.modal-card')).toHaveCSS('background-color', 'rgb(235, 224, 216)');
    await page.keyboard.press('Escape');

    // Search highlights in both the static source and live editor use valid themed colors.
    await page.getByPlaceholder('Filter source text').fill('Needle');
    await page.getByPlaceholder('Filter target text').fill('Needle');
    await expect(page.locator('.editor-search-highlight').first()).toHaveCSS(
      'background-color',
      'rgb(239, 221, 177)',
    );
    await expect(page.locator('.cm-target-highlight').first()).toHaveCSS(
      'color',
      'rgb(60, 44, 18)',
    );
    // The shared CSS also wins over CodeMirror's whitespace decoration styles.
    await page.getByRole('button', { name: 'Toggle non-printing symbols' }).click();
    await page.getByPlaceholder('Filter target text').fill('Needle theme');
    const highlightedEditor = page.locator('.cm-content');
    await expect(highlightedEditor.locator('.cm-np-space').first()).toBeVisible();
    await expect(highlightedEditor.locator('.cm-target-highlight').first()).toBeVisible();
    for (const highlight of await highlightedEditor.locator('.cm-target-highlight').all()) {
      await expect(highlight).toHaveCSS('background-color', 'rgb(239, 221, 177)');
      await expect(highlight).toHaveCSS('color', 'rgb(60, 44, 18)');
      await expect(highlight).toHaveCSS('font-weight', '400');
    }
    await page.getByRole('button', { name: 'Toggle non-printing symbols' }).click();
    await page.getByPlaceholder('Filter source text').fill('');
    await page.getByPlaceholder('Filter target text').fill('');

    await button.click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Nord', { exact: true })
      .click();
    await page.getByRole('button', { name: 'Back to Project' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'sand');
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'nord');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'sand');
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'nord');
    await button.click();
    await expect(colors.getByRole('radio', { name: 'Nord' })).toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('offers editor appearance in review projects without batch actions', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, tempDir } = session;
    await page.evaluate(
      async (fixturePath) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const project = await api.createProject('Theme review fixture', 'en', 'zh', 'review');
        await api.addFileToProject(project.id!, fixturePath, {
          hasHeader: true,
          sourceCol: 0,
          targetCol: 1,
        });
      },
      join(tempDir, 'cm6-smoke-fixture.xlsx'),
    );
    await page.reload();
    await page.getByRole('button', { name: 'Theme review fixture', exact: true }).click();
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'AI batch translate' })).toHaveCount(0);
    await expect(
      page
        .getByRole('group', { name: 'Display settings' })
        .getByRole('button', { name: 'Toggle non-printing symbols' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Editor appearance' }).click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Nord', { exact: true })
      .click();
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'nord');
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('coordinates status, QA, reference badges and search in complete reading scenes', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page } = session;
    await prepareEditorReadingScene(session);
    const translationTools = page.getByRole('group', { name: 'Translation tools' });
    await expect(
      translationTools.getByRole('button', { name: 'AI batch translate' }),
    ).toBeVisible();
    await expect(translationTools.getByRole('button', { name: 'Run batch QA' })).toBeVisible();
    const search = page.getByRole('group', { name: 'Source and target filters' });
    await expect(search.getByRole('textbox')).toHaveCount(2);
    await expect(page.getByRole('progressbar', { name: 'Confirmed segments' })).toBeVisible();
    await page.getByPlaceholder('Filter source text').fill('window');
    await page.getByPlaceholder('Filter target text').fill('窗');
    await page.locator('.editor-source-text').nth(2).click();
    await expect(page.locator('.bg-match-exact')).toBeVisible();
    await expect(page.locator('.bg-match-fuzzy')).toBeVisible();
    await expect(page.locator('.bg-match-term')).toBeVisible();
    await expect(page.locator('.bg-match-concordance')).toBeVisible();
    await expect(page.getByText('Number mismatch: 15 → 5')).toBeVisible();
    await expect(page.getByText('Check final punctuation')).toBeVisible();
    for (const theme of ['Classic', 'Nord']) {
      await page.getByRole('button', { name: 'Editor appearance' }).click();
      await page
        .getByRole('group', { name: 'Color scheme' })
        .getByText(theme, { exact: true })
        .click();
      await page
        .getByRole('group', { name: 'Color scheme' })
        .getByRole('radio', { checked: true })
        .press('Escape');
      for (const role of ['new', 'draft', 'translated', 'reviewed', 'confirmed']) {
        const marker = page.locator(`.bg-status-${role}`).first();
        await expect(marker).toBeVisible();
        const colors = await marker.evaluate((element, role) => {
          const token = getComputedStyle(document.documentElement)
            .getPropertyValue(`--color-status-${role}`)
            .trim()
            .split(/\s+/)
            .join(', ');
          return { actual: getComputedStyle(element).backgroundColor, expected: `rgb(${token})` };
        }, role);
        expect(colors.actual).toBe(colors.expected);
      }
      await expect(page.locator('.editor-search-highlight').first()).toBeVisible();
      await expect(page.locator('.cm-target-highlight').first()).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: test.info().outputPath(`${theme.toLowerCase()}-reading.png`),
        animations: 'disabled',
      });
    }
  } finally {
    await closeEditorSmokeSession(session);
  }
});
