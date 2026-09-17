import { expect, test } from '@playwright/test';
import type { DesktopApi } from '../src/shared/ipc';
import { closeEditorSmokeSession, createEditorSmokeSession } from './support/editorSmokeSession';

test('scrolls beyond the initial rows immediately after opening and reopening a task', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page, fileId } = session;
    const taskName = await page.evaluate(async (existingFileId) => {
      const api = (window as unknown as { api: DesktopApi }).api;
      const existingFile = await api.getFile(existingFileId);
      if (!existingFile) throw new Error('Missing smoke fixture file');
      const file = await api.createPastedSourceFile(existingFile.projectId, {
        sources: Array.from({ length: 200 }, (_, index) => `Scroll row ${index + 1}`),
      });
      return file.name;
    }, fileId);
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: taskName, exact: true }).click();
      await expect(page.getByText('Scroll row 1', { exact: true })).toBeVisible();
      await expect(page.locator('.cm-content')).toBeFocused();
      const scrollContainer = page.locator('.editor-scrollbar');
      await scrollContainer.hover();
      await page.mouse.wheel(0, 20000);
      await expect(page.getByText('Scroll row 200', { exact: true })).toBeInViewport();
      await page.mouse.wheel(0, -20000);
      await expect(page.getByText('Scroll row 1', { exact: true })).toBeInViewport();
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    }
  } finally {
    await closeEditorSmokeSession(session);
  }
});
