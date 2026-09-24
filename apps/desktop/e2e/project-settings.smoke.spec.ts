import { expect, test } from '@playwright/test';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';

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
    await expect(page.getByLabel('Custom Prompt', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Open settings', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    const prompt = page.getByLabel('Custom Prompt', { exact: true });
    await prompt.fill('Use concise language and preserve the original tone.');
    await expect(page.locator('#project-ai-effective-prompt')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Test Prompt', exact: true })).toBeHidden();
    await page.evaluate(() => document.fonts.ready);
    for (const width of [1200, 900]) {
      await page.setViewportSize({ width, height: 800 });
      const collapsed = await prompt.boundingBox();
      for (const label of ['Prompt preview', 'Test prompt']) {
        const disclosure = page.locator('summary').filter({ hasText: label });
        await disclosure.click();
        const expanded = await prompt.boundingBox();
        expect(expanded!.x).toBe(collapsed!.x);
        expect(expanded!.width).toBe(collapsed!.width);
        await disclosure.click();
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
    expect(await page.getByRole('form', { name: 'QA settings' }).boundingBox()).toEqual(qaBounds);
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
    await page.getByRole('tab', { name: 'Translation Memory', exact: true }).click();
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('qa-settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('form', { name: 'QA settings' }).getByRole('status')).toHaveText(
      'Saved',
    );
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(prompt).toHaveValue('Use concise language and preserve the original tone.');
    await page.screenshot({ path: testInfo.outputPath('ai-settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('form', { name: 'AI settings' }).getByRole('status')).toHaveText(
      'Saved',
    );
    await page.reload();
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('button', { name: projectName, exact: true })
      .click();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(prompt).toHaveValue('Use concise language and preserve the original tone.');
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
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
