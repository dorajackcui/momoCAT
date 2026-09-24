import { expect, test } from '@playwright/test';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';

test('project configuration panels align and resource rows retain mounting actions', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, fileId } = session;
    const resources = await page.evaluate(async (id) => {
      const api = (window as any).api;
      const file = await api.getFile(id);
      const name =
        'Product terminology — interface labels, help messages and release documentation';
      return {
        tm: await api.createTM('Product translations', 'en', 'zh', 'main'),
        tb: await api.createTB(name, 'en', 'zh'),
        name,
        projectId: file.projectId,
      };
    }, fileId);
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByRole('tab', { name: 'Translation memory', exact: true }).click();
    await page
      .getByRole('combobox', { name: 'Mount translation memory' })
      .selectOption(resources.tm);
    await expect(page.getByRole('heading', { name: 'Product translations' })).toBeVisible();
    await page.getByRole('tab', { name: 'Term bases', exact: true }).click();
    await page.getByRole('combobox', { name: 'Mount term base' }).selectOption(resources.tb);
    await expect(page.getByRole('heading', { name: resources.name, exact: true })).toBeVisible();
    for (const width of [1440, 900]) {
      await page.setViewportSize({ width, height: 900 });
      let baseline: { x: number; width: number } | undefined;
      for (const [tab, slug] of [
        ['AI provider', 'ai'],
        ['QA', 'qa'],
        ['Translation memory', 'tm'],
        ['Term bases', 'tb'],
      ]) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        const content = page.getByRole('tabpanel').locator(':scope > :first-child');
        const bounds = await content.boundingBox();
        expect(bounds).not.toBeNull();
        if (!baseline) baseline = { x: bounds!.x, width: bounds!.width };
        expect(bounds!.x).toBe(baseline.x);
        expect(bounds!.width).toBe(baseline.width);
        expect(
          await content.evaluate((element) => element.scrollWidth <= element.clientWidth),
        ).toBe(true);
        if (slug === 'tm' || slug === 'tb') {
          const unmount = page.getByRole('button', {
            name: `Unmount ${slug === 'tm' ? 'Product translations' : resources.name} from project`,
            exact: true,
          });
          await expect(unmount).toHaveAttribute('data-tone', 'danger');
          const dangerColor = await unmount.evaluate(
            (element) =>
              `rgb(${getComputedStyle(element).getPropertyValue('--color-danger').trim().split(/\s+/).join(', ')})`,
          );
          await expect(unmount).toHaveCSS('color', dangerColor);
          const card = unmount.locator('xpath=ancestor::li');
          const buttonBounds = await unmount.boundingBox();
          const cardBounds = await card.boundingBox();
          expect(buttonBounds!.y + buttonBounds!.height / 2).toBeCloseTo(
            cardBounds!.y + cardBounds!.height / 2,
            0,
          );
        }
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: test.info().outputPath(`${slug}-${width}.png`),
          animations: 'disabled',
        });
      }
    }
    await page
      .getByRole('button', { name: `Unmount ${resources.name} from project`, exact: true })
      .click();
    await expect(
      page.getByText('No term base mounted to this project yet.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Translation memory', exact: true }).click();
    await page.getByRole('button', { name: 'Unmount Product translations from project' }).click();
    await expect(
      page.getByText('No Main TMs mounted to this project yet.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('region', { name: 'Working TM', exact: true })).toBeVisible();
    const mounted = await page.evaluate(async (id) => {
      const api = (window as any).api;
      return {
        tms: (await api.getProjectMountedTMs(id)).filter((tm: any) => tm.type === 'main'),
        tbs: await api.getProjectMountedTBs(id),
      };
    }, resources.projectId);
    expect(mounted).toEqual({ tms: [], tbs: [] });
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('shares project settings while preserving independent AI and QA drafts and persisted values', async () => {
  const testInfo = test.info();
  const session = await createEditorSmokeSession();
  try {
    const { page, projectName } = session;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await expect(page.getByRole('button', { name: 'QA Settings', exact: true })).toHaveCount(0);
    await expect(page.getByLabel('Custom prompt', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'AI provider', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const prompt = page.getByLabel('Custom prompt', { exact: true });
    await prompt.fill('Use concise language and preserve the original tone.');
    await expect(page.locator('#project-ai-effective-prompt')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Test prompt', exact: true })).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1200, 900]) {
      await page.setViewportSize({ width, height: 800 });
      const collapsed = await prompt.boundingBox();
      for (const label of ['Prompt preview', 'Test prompt']) {
        const disclosure = page.locator('summary').filter({ hasText: label });
        const summaryBounds = await disclosure.boundingBox();
        const arrowBounds = await disclosure.locator('svg').boundingBox();
        expect(arrowBounds!.x + arrowBounds!.width).toBeCloseTo(
          summaryBounds!.x + summaryBounds!.width,
          0,
        );
        await disclosure.press('Enter');
        const expanded = await prompt.boundingBox();
        expect(expanded!.x).toBe(collapsed!.x);
        expect(expanded!.width).toBe(collapsed!.width);
        await disclosure.press('Space');
        const restored = await prompt.boundingBox();
        expect(restored!.x).toBe(collapsed!.x);
        expect(restored!.width).toBe(collapsed!.width);
      }
    }
    await page.setViewportSize({ width: 1200, height: 800 });
    const aiBounds = await page.getByRole('form', { name: 'AI settings' }).boundingBox();
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    const qaBounds = await page.getByRole('form', { name: 'QA settings' }).boundingBox();
    expect(qaBounds!.x).toBe(aiBounds!.x);
    expect(qaBounds!.width).toBe(aiBounds!.width);
    expect(qaBounds!.height).toBeLessThan(600);
    const instantQA = page.getByRole('switch', { name: 'Instant QA after Confirm', exact: true });
    await expect(instantQA).toBeChecked();
    await instantQA.press('Space');
    await expect(instantQA).not.toBeChecked();
    const qaDirtyBounds = await page.getByRole('form', { name: 'QA settings' }).boundingBox();
    await expect(page.getByRole('checkbox', { name: 'Missing tags' })).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('qa-settings-compact.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Terminology options', exact: true }).click();
    await expect(
      page.getByRole('dialog', { name: 'Terminology options', exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('qa-terminology-options.png'),
      animations: 'disabled',
    });
    await page.getByRole('checkbox', { name: '【 】', exact: true }).uncheck();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Terminology options', exact: true }),
    ).toBeFocused();
    expect(await page.getByRole('form', { name: 'QA settings' }).boundingBox()).toEqual(
      qaDirtyBounds,
    );
    await page.getByRole('button', { name: 'Substring consistency options', exact: true }).click();
    const heading = await page
      .getByRole('heading', { name: 'Substring consistency options', exact: true })
      .boundingBox();
    const close = await page.getByRole('button', { name: 'Close', exact: true }).boundingBox();
    expect(heading!.x + heading!.width).toBeLessThan(close!.x);
    await page.getByRole('spinbutton', { name: 'Minimum CJK letters', exact: true }).fill('4');
    await page.screenshot({
      path: testInfo.outputPath('qa-substring-options.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Substring consistency', exact: true }),
    ).not.toBeChecked();
    await page.getByRole('button', { name: 'Target text options', exact: true }).click();
    await page.screenshot({
      path: testInfo.outputPath('qa-text-options.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    const tagOptions = page.getByRole('button', { name: 'Standard tags options', exact: true });
    await tagOptions.click();
    await expect(
      page.getByRole('dialog', { name: 'Terminology options', exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }),
    ).toHaveCount(0);
    const tagRule = page.getByRole('checkbox', { name: /Standard tags/ });
    const ignoredTags = page.getByRole('textbox', {
      name: 'Ignored tags (exact text, one per line)',
    });
    await ignoredTags.fill('<b>');
    await ignoredTags.press('End');
    await ignoredTags.press('Enter');
    await ignoredTags.pressSequentially('</b>');
    await expect(ignoredTags).toHaveValue('<b>\n</b>');
    await page.getByRole('checkbox', { name: '[color=…] tags', exact: true }).uncheck();
    await page.screenshot({
      path: testInfo.outputPath('qa-tag-options.png'),
      animations: 'disabled',
    });
    await expect(page.getByRole('checkbox', { name: '[color=…] tags' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect(tagOptions).toBeFocused();
    await tagRule.uncheck();
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('button', { name: 'QA', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Translation memory', exact: true }).click();
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    await expect(instantQA).not.toBeChecked();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('qa-settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page
        .getByRole('form', { name: 'QA settings' })
        .getByRole('button', { name: 'Save', exact: true }),
    ).toBeHidden();
    await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
    await expect(prompt).toHaveValue('Use concise language and preserve the original tone.');
    await page.screenshot({ path: testInfo.outputPath('ai-settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page
        .getByRole('form', { name: 'AI settings' })
        .getByRole('button', { name: 'Save', exact: true }),
    ).toBeHidden();
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page.getByRole('tab', { name: 'AI provider', exact: true }).click();
    await expect(prompt).toHaveValue('Use concise language and preserve the original tone.');
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    await expect(instantQA).not.toBeChecked();
    await tagRule.check();
    await tagOptions.click();
    await expect(ignoredTags).toHaveValue('<b>\n</b>');
    await expect(page.getByRole('checkbox', { name: '[color=…] tags' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Terminology options', exact: true }).click();
    await expect(page.getByRole('checkbox', { name: '【 】', exact: true })).not.toBeChecked();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('global settings retain tab order and fit all three themes at wide and narrow widths', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, electronApp } = session;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await electronApp.evaluate(({ ipcMain }, channels) => {
      const connection = {
        id: 'connection:preview',
        name: 'Preview connection',
        baseUrl: 'https://example.invalid/v1',
        protocol: 'openai-compatible',
        kind: 'openai-compatible',
        apiKeyLast4: '1234',
        discoveredModels: ['preview-model'],
        createdAt: '',
        updatedAt: '',
      };
      ipcMain.removeHandler(channels.listConnections);
      ipcMain.handle(channels.listConnections, () => [connection]);
      ipcMain.removeHandler(channels.listProviders);
      ipcMain.handle(channels.listProviders, () => [
        {
          id: 'provider:preview',
          name: 'Preview provider',
          baseUrl: connection.baseUrl,
          protocol: 'openai-compatible',
          model: 'preview-model',
          kind: 'configured',
          connectionId: connection.id,
          connectionName: connection.name,
          apiKeyLast4: '1234',
          createdAt: '',
          updatedAt: '',
        },
      ]);
    }, IPC_CHANNELS.ai);
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const tabNames = ['AI Connections', 'Proxy', 'Term Extraction', 'Appearance', 'Updates'];
    await expect(page.getByRole('tab')).toHaveText(tabNames);
    for (const theme of ['Sand', 'Classic', 'Nord']) {
      await page.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await page
        .getByRole('group', { name: 'Color scheme' })
        .getByText(theme, { exact: true })
        .click();
      await expect(page.locator('html')).toHaveAttribute('data-color-theme', theme.toLowerCase());
      for (const width of [1440, 900]) {
        await page.setViewportSize({ width, height: 900 });
        for (const tab of tabNames) {
          await page.getByRole('tab', { name: tab, exact: true }).click();
          if (tab === 'AI Connections') {
            await expect(page.getByText('Preview provider', { exact: true })).toBeVisible();
            const use = page.getByRole('button', { name: 'Use connection', exact: true });
            await use.click();
            await expect(
              page.getByRole('textbox', { name: 'Connection name', exact: true }),
            ).toHaveValue('Preview connection');
          }
          if (tab === 'Term Extraction') {
            await expect(page.getByLabel('Term extraction selection prompt')).not.toHaveValue('');
          }
          const panel = page.getByRole('tabpanel');
          expect(
            await panel.evaluate((element) => element.scrollWidth <= element.clientWidth),
          ).toBe(true);
          const cards = panel.locator('.workspace-settings-section, .workspace-config-section');
          expect(await cards.count()).toBeGreaterThan(0);
          for (const card of await cards.all()) {
            expect(
              await card.evaluate((element) => element.scrollWidth <= element.clientWidth),
            ).toBe(true);
          }
          await page.evaluate(() => document.fonts.ready);
          await page.screenshot({
            path: test
              .info()
              .outputPath(
                `${theme.toLowerCase()}-${tab.toLowerCase().replaceAll(' ', '-')}-${width}.png`,
              ),
            animations: 'disabled',
          });
        }
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});
