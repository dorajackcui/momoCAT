import { expect, test } from '@playwright/test';
import {
  closeEditorSmokeSession as closeSmokeSession,
  createEditorSmokeSession as createSmokeSession,
} from './support/editorSmokeSession';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';

test.describe('Editor repeat propagation', () => {
  test('resynchronizes every repeat when the first occurrence is confirmed again', async () => {
    const session = await createSmokeSession([
      ['Repeat', '', 'A'],
      ['Repeat', '', 'B'],
      ['Repeat', '', 'C'],
    ]);
    try {
      const { page, fileId } = session;
      const rows = page.locator('.editor-row');
      const target = (index: number) =>
        rows.nth(index).locator('.cm-content, .editor-target-preview');
      const edit = async (index: number, value: string) => {
        await rows.nth(index).locator('.editor-source-text').click();
        const editor = rows.nth(index).locator('.cm-content');
        await editor.fill(value);
        return editor;
      };

      await (await edit(0, 'Shared translation')).press(`${modifier}+Enter`);
      await expect(page.locator('[data-segment-status="confirmed"]')).toHaveCount(3);
      await expect(target(1)).toHaveText('Shared translation');
      await expect(target(2)).toHaveText('Shared translation');

      await (await edit(1, 'Only B')).press(`${modifier}+Enter`);
      await expect(target(0)).toHaveText('Shared translation');
      await expect(target(2)).toHaveText('Shared translation');
      await edit(2, 'Only C');
      const firstEditor = await edit(0, 'Revised translation');
      await expect(target(1)).toHaveText('Only B');
      await expect(target(2)).toHaveText('Only C');
      await firstEditor.press(`${modifier}+Enter`);
      await expect(page.locator('[data-segment-status="confirmed"]')).toHaveCount(3);
      for (const index of [0, 1, 2]) await expect(target(index)).toHaveText('Revised translation');

      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      expect(
        await page.evaluate(async (id) => {
          const api = (window as unknown as { api: import('../src/shared/ipc').DesktopApi }).api;
          return (await api.getSegments(id, 0, 10)).map((segment) => ({
            target: segment.targetTokens.map((token) => token.content).join(''),
            status: segment.status,
          }));
        }, fileId),
      ).toEqual(
        Array.from({ length: 3 }, () => ({ target: 'Revised translation', status: 'confirmed' })),
      );
    } finally {
      await closeSmokeSession(session);
    }
  });
});
