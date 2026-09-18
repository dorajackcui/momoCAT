import { expect, test } from '@playwright/test';
import { closeEditorSmokeSession, createEditorSmokeSession } from './support/editorSmokeSession';

test('loads local fonts and preserves editing while switching scripts and 14/16px sizes', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, projectName } = session;
    const remoteFonts: string[] = [];
    page.on('request', (request) => {
      if (request.resourceType() === 'font' && /^https?:/.test(request.url()))
        remoteFonts.push(request.url());
    });
    const row = page.locator('div.group.grid').nth(1);
    await row.click();
    const target = row.locator('.cm-content');
    await target.fill('中文翻译 café œuvre');
    await target.press('Home');
    await target.press('ArrowRight');
    const originalEditor = await target.elementHandle();
    const button = page.getByRole('button', { name: 'Editor appearance' });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    await button.click();
    const chinese = page.getByRole('group', { name: 'Chinese font' });
    const western = page.getByRole('group', { name: 'Western font' });
    const size = page.getByRole('group', { name: 'Font size' });
    await expect(size.getByRole('radio', { name: '16 px' })).toBeChecked();
    await expect(western.getByRole('radio')).toHaveCount(2);
    await expect(
      page.getByRole('dialog', { name: 'Editor appearance' }).getByRole('group'),
    ).toHaveCount(4);
    for (const choice of [
      {
        cjk: 'noto-serif',
        latin: 'source-sans',
        family: 'Source Sans 3 Variable',
        chineseFamily: 'Noto Serif SC',
        fontSize: '16',
      },
      {
        cjk: 'noto-sans',
        latin: 'source-serif',
        family: 'Source Serif 4 Variable',
        chineseFamily: 'Noto Sans SC',
        fontSize: '14',
      },
    ]) {
      await chinese
        .getByText(`${choice.chineseFamily} · ${choice.cjk === 'noto-serif' ? '宋体' : '黑体'}`, {
          exact: true,
        })
        .click();
      await western.getByText(choice.family.replace(' Variable', ''), { exact: true }).click();
      await size.getByText(`${choice.fontSize} px`, { exact: true }).click();
      const loaded = await page.evaluate(async (family) => {
        const latin = await document.fonts.load(`400 16px "${family}"`, 'café œuvre');
        const cjk = await document.fonts.load(
          `400 16px "${getComputedStyle(document.documentElement).getPropertyValue('--font-content-cjk').trim().replaceAll("'", '')}"`,
          '中文翻译',
        );
        await document.fonts.ready;
        return latin.length > 0 && cjk.length > 0;
      }, choice.family);
      expect(loaded).toBe(true);
      const { root } = await cdp.send('DOM.getDocument');
      const { nodeId } = await cdp.send('DOM.querySelector', {
        nodeId: root.nodeId,
        selector: '.cm-line',
      });
      const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
      for (const family of [choice.chineseFamily, choice.family.replace(' Variable', '')]) {
        expect(
          fonts.some(
            (font: { familyName: string; isCustomFont: boolean }) =>
              font.isCustomFont && font.familyName.includes(family),
          ),
          `Rendered font: ${family}`,
        ).toBe(true);
      }
      await expect(target).toHaveCSS('font-weight', '400');
      await expect(target).toHaveCSS('font-size', `${choice.fontSize}px`);
      await expect(row.locator('.editor-source-text')).toHaveCSS(
        'font-size',
        `${choice.fontSize}px`,
      );
      await expect(page.locator('.editor-target-preview').first()).toHaveCSS(
        'font-size',
        `${choice.fontSize}px`,
      );
      await expect(target).toHaveText('中文翻译 café œuvre');
      expect(await originalEditor!.evaluate((el) => el.isConnected)).toBe(true);
    }
    await western.getByRole('radio', { checked: true }).press('Escape');
    await expect(button).toBeFocused();
    await target.focus();
    await page.keyboard.insertText('X');
    await expect(target).toHaveText('中X文翻译 café œuvre');
    await target.press(`${process.platform === 'darwin' ? 'Meta' : 'Control'}+z`);
    await expect(target).toHaveText('中文翻译 café œuvre');
    await page.getByRole('button', { name: 'Editor appearance' }).click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Nord', { exact: true })
      .click();
    await page.getByRole('radio', { name: 'Nord' }).press('Escape');
    await button.click();
    await expect(chinese.getByRole('radio', { name: 'Noto Sans SC · 黑体' })).toBeChecked();
    await expect(western.getByRole('radio', { name: 'Source Serif 4' })).toBeChecked();
    await expect(size.getByRole('radio', { name: '14 px' })).toBeChecked();
    for (const theme of ['Classic', 'Nord']) {
      await page
        .getByRole('group', { name: 'Color scheme' })
        .getByText(theme, { exact: true })
        .click();
      await expect(size.getByRole('radio', { name: '14 px' })).toBeChecked();
      await page.getByRole('dialog', { name: 'Editor appearance' }).screenshot({
        path: test.info().outputPath(`appearance-${theme.toLowerCase()}.png`),
        animations: 'disabled',
      });
    }
    await page.getByRole('button', { name: 'Back to Project' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-content-size', '16');
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await button.click();
    await expect(western.getByRole('radio', { name: 'Source Serif 4' })).toBeChecked();
    await expect(size.getByRole('radio', { name: '14 px' })).toBeChecked();
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
    await button.click();
    await expect(size.getByRole('radio', { name: '14 px' })).toBeChecked();
    expect(remoteFonts).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});
