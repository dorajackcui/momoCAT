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
    const tagRule = page.getByRole('checkbox', { name: /Tag Integrity/ });
    await tagRule.uncheck();
    await page.getByRole('tab', { name: 'Tasks', exact: true }).click();
    await expect(page.getByRole('button', { name: 'QA', exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Translation Memory', exact: true }).click();
    await page.getByRole('tab', { name: 'Settings', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: testInfo.outputPath('qa-settings.png'), animations: 'disabled' });
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('form', { name: 'QA settings' }).getByRole('status')).toHaveText(
      'Saved',
    );
    await page.getByRole('tab', { name: 'AI', exact: true }).click();
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
    await page.getByRole('button', { name: 'Discard', exact: true }).click();
    await expect(tagRule).not.toBeChecked();
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});
