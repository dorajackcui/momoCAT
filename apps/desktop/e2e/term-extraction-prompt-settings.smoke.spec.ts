import { _electron as electron, expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { DesktopApi, SourceTerminologyPromptSettings } from '../src/shared/ipc';

const APP_ROOT = join(__dirname, '..');

test('manages and switches between named term extraction prompts', async () => {
  test.setTimeout(90_000);
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  const electronApp = await electron.launch({ cwd: APP_ROOT, args: ['.'], env: launchEnv });
  const page = await electronApp.firstWindow({ timeout: 60_000 });
  const promptName = `Smoke Prompt ${Date.now()}`;
  const updatedName = `${promptName} Updated`;
  let original: SourceTerminologyPromptSettings | undefined;

  try {
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    original = await page.evaluate(async () => {
      return (window as unknown as { api: DesktopApi }).api.getSourceTerminologyPromptSettings();
    });
    const defaultPrompt = original.prompts.find((prompt) => prompt.isBuiltin)?.prompt;
    expect(defaultPrompt).toBeTruthy();

    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const connectionsTab = page.getByRole('tab', { name: 'AI Connections', exact: true });
    const tabMetrics = await connectionsTab.evaluate((element) => {
      const style = window.getComputedStyle(element);
      return {
        height: element.getBoundingClientRect().height,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
        alignItems: style.alignItems,
      };
    });
    expect(tabMetrics.height).toBeGreaterThanOrEqual(32);
    expect(tabMetrics.alignItems).toBe('center');
    expect(tabMetrics.scrollHeight).toBeLessThanOrEqual(tabMetrics.clientHeight);

    await page.getByRole('tab', { name: 'Term Extraction', exact: true }).click();

    const editor = page.getByLabel('Term extraction selection prompt', { exact: true });
    await expect(editor).toHaveValue(original.prompt);

    const customPrompt = `Prefer named locations and named features. Smoke ${Date.now()}.`;
    await page.getByRole('button', { name: 'New Prompt', exact: true }).click();
    await page.getByLabel('Prompt Name', { exact: true }).fill(promptName);
    await editor.fill(customPrompt);
    await page.getByRole('button', { name: 'Save and Use', exact: true }).click();
    await expect(
      page.getByText(`"${promptName}" was saved and is now in use.`, { exact: true }),
    ).toBeVisible();

    const updatedPrompt = `${customPrompt} Prefer stable product names.`;
    await page.getByLabel('Prompt Name', { exact: true }).fill(updatedName);
    await editor.fill(updatedPrompt);
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    await expect(page.getByText(`"${updatedName}" was updated.`, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Use Default', exact: true }).click();
    await expect(
      page.getByText('"Default" is now used for term extraction.', { exact: true }),
    ).toBeVisible();
    await expect(editor).toHaveValue(defaultPrompt ?? '');

    await page.getByRole('button', { name: `Use ${updatedName}`, exact: true }).click();
    await expect(editor).toHaveValue(updatedPrompt);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          return (window as unknown as { api: DesktopApi }).api
            .getSourceTerminologyPromptSettings()
            .then((settings) => settings.prompt);
        }),
      )
      .toBe(updatedPrompt);

    await page.getByRole('button', { name: `Delete ${updatedName}`, exact: true }).click();
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();
    await expect(page.getByText(`"${updatedName}" was deleted.`, { exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: `Delete ${updatedName}`, exact: true }),
    ).toHaveCount(0);
  } finally {
    if (original) {
      await page
        .evaluate(
          async ({ originalActivePromptId, createdPromptNames }) => {
            const api = (window as unknown as { api: DesktopApi }).api;
            let current = await api.getSourceTerminologyPromptSettings();
            for (const prompt of current.prompts) {
              if (!prompt.isBuiltin && createdPromptNames.includes(prompt.name)) {
                current = await api.setSourceTerminologyPromptSettings({
                  action: 'delete',
                  promptId: prompt.id,
                });
              }
            }
            const originalStillExists = current.prompts.some(
              (prompt) => prompt.id === originalActivePromptId,
            );
            const fallbackPromptId = current.prompts.find((prompt) => prompt.isBuiltin)?.id;
            await api.setSourceTerminologyPromptSettings({
              action: 'activate',
              promptId: originalStillExists ? originalActivePromptId : (fallbackPromptId ?? ''),
            });
          },
          {
            originalActivePromptId: original.activePromptId,
            createdPromptNames: [promptName, updatedName],
          },
        )
        .catch(() => undefined);
    }
    await electronApp.close();
  }
});
