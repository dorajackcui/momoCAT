import { expect, test } from '@playwright/test';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import { version } from '../package.json';
import {
  closeEditorSmokeSession as closeSmokeSession,
  createEditorSmokeSession as createSmokeSession,
} from './support/editorSmokeSession';

test.describe('CodeMirror editor engine smoke', () => {
  test('keeps task actions and direct project navigation visible outside CAT', async () => {
    const session = await createSmokeSession();
    try {
      const { page, projectName } = session;
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      const actions = ['Match', 'TM/TB', 'Translate', 'QA', 'Commit', 'Export File', 'Delete File'];
      for (const name of actions)
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      const taskRow = page.locator('.workspace-task-row');
      expect(
        await taskRow
          .locator('.workspace-task-actions button')
          .evaluateAll((buttons) =>
            buttons.map(
              (button) => button.getAttribute('aria-label') || button.textContent?.trim(),
            ),
          ),
      ).toEqual(actions);
      await taskRow.getByRole('button', { name: 'Rename cm6-smoke-fixture.xlsx' }).click();
      await expect(page.getByRole('textbox', { name: 'Rename file' })).toBeVisible();
      await page.getByRole('textbox', { name: 'Rename file' }).click();
      await page.getByRole('button', { name: 'Cancel file rename' }).click();
      await taskRow.getByRole('button', { name: 'Translate', exact: true }).click();
      await expect(page.getByText('AI Translate Options', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(taskRow).toBeVisible();
      const trigger = page.getByRole('button', { name: /^Actions for cm6-smoke-/ });
      const before = await trigger.boundingBox();
      await trigger.click();
      const menu = page.getByRole('menu', { name: /cm6-smoke-.* actions/ });
      await expect(menu).toBeVisible();
      expect(await trigger.boundingBox()).toEqual(before);
      expect(await menu.evaluate((element) => element.closest('.workspace-sidebar') === null)).toBe(
        true,
      );
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
      await trigger.click();
      await page.getByRole('menuitem', { name: 'Pin project' }).click();
      await expect(
        page
          .getByRole('group', { name: 'Pinned projects' })
          .getByRole('button', { name: projectName, exact: true }),
      ).toBeVisible();
      const projectLink = page
        .getByRole('navigation', { name: 'Projects', exact: true })
        .getByRole('button', { name: /^cm6-smoke-/ });
      await projectLink.click();
      const fileInfo = taskRow.locator(':scope > div').first();
      const infoBounds = await fileInfo.boundingBox();
      expect(infoBounds).not.toBeNull();
      await fileInfo.click({ position: { x: infoBounds!.width - 4, y: infoBounds!.height - 2 } });
      await expect(page.getByRole('complementary', { name: 'Workspace navigation' })).toBeHidden();
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      await expect(projectLink).toBeVisible();
      await expect(
        page.getByRole('button', { name: /Collapse sidebar|Expand sidebar|Switch project/ }),
      ).toHaveCount(0);
      await page.setViewportSize({ width: 640, height: 720 });
      await expect(projectLink).toBeVisible();
      for (const name of actions)
        await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
      await taskRow.click({ position: { x: 2, y: 2 } });
      await expect(page.getByPlaceholder('Filter target text')).toBeVisible();
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('hides navigation in CAT, saves on return, and restores the selected segment and filters', async () => {
    const session = await createSmokeSession();
    try {
      const { page, fileId, projectName } = session;
      await expect(page.getByRole('complementary', { name: 'Workspace navigation' })).toBeHidden();
      await page.getByPlaceholder('Filter source text').fill('Needle');
      const row = page.locator('div.group.grid');
      await expect(row).toHaveCount(1);
      await row.click();
      const target = row.locator('.editor-target-editor-host .cm-content');
      await target.fill('Saved on return');
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      await expect(page.getByRole('complementary', { name: 'Workspace navigation' })).toBeVisible();
      await page.getByRole('button', { name: 'Translation memory', exact: true }).click();
      await expect(
        page.getByRole('heading', { name: 'Translation memory', exact: true }),
      ).toBeVisible();
      const savedTarget = await page.evaluate(async (id) => {
        const segments = await (window as unknown as { api: any }).api.getSegments(id, 0, 1000);
        return segments[1].targetTokens
          .map((token: { content?: string }) => token.content ?? '')
          .join('');
      }, fileId);
      expect(savedTarget).toBe('Saved on return');
      await page
        .getByRole('navigation', { name: 'Projects', exact: true })
        .getByRole('button', { name: projectName, exact: true })
        .click();
      await page.getByRole('button', { name: 'cm6-smoke-fixture.xlsx', exact: true }).click();
      await expect(page.getByPlaceholder('Filter source text')).toHaveValue('Needle');
      await expect(page.locator('.editor-target-editor-host .cm-content')).toHaveText(
        'Saved on return',
      );
      await page.getByPlaceholder('Filter source text').fill('');
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
      const updates = page.getByRole('region', { name: 'Software updates' });
      await expect(updates).toHaveCount(0);
      await page.getByRole('tab', { name: 'Updates', exact: true }).click();
      await expect(
        updates.getByText(`Current version: v${version}`, { exact: true }),
      ).toBeVisible();
      await expect(updates.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
      await page.getByRole('tab', { name: 'Proxy', exact: true }).click();
      await expect(updates).toHaveCount(0);
      await page.getByRole('tab', { name: 'Updates', exact: true }).click();
      await expect(updates).toBeVisible();
      await page
        .getByRole('navigation', { name: 'Projects', exact: true })
        .getByRole('button', { name: projectName, exact: true })
        .click();
      await page.getByRole('button', { name: 'cm6-smoke-fixture.xlsx', exact: true }).click();
      await expect(page.locator('div.group.grid').nth(1).locator('.cm-content')).toBeVisible();
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('keeps CAT open after a failed save on return without losing the draft', async () => {
    const session = await createSmokeSession();
    try {
      const { page } = session;
      await session.electronApp.evaluate(({ ipcMain }, channel) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(
          channel,
          () =>
            new Promise((_resolve, reject) => {
              (globalThis as unknown as { rejectSmokeSave: () => void }).rejectSmokeSave = () =>
                reject(new Error('Smoke test save failure'));
            }),
        );
      }, IPC_CHANNELS.segment.update);
      const target = page.locator('.editor-target-editor-host .cm-content').first();
      await target.fill('Retained draft');
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      const workspace = page.locator('main[aria-label="Workspace"]');
      await expect(workspace).toHaveAttribute('inert', '');
      await target.evaluate((element: HTMLElement) => element.focus());
      await page.keyboard.insertText('This edit must be blocked');
      await expect(target).toHaveText('Retained draft');
      await expect
        .poll(() =>
          session.electronApp.evaluate(
            () =>
              typeof (globalThis as unknown as { rejectSmokeSave?: () => void }).rejectSmokeSave,
          ),
        )
        .toBe('function');
      await session.electronApp.evaluate(() => {
        (globalThis as unknown as { rejectSmokeSave: () => void }).rejectSmokeSave();
      });
      await expect(
        page.getByText(/Failed to save pending segment edits before leaving the editor/),
      ).toBeVisible();
      await expect(page.getByPlaceholder('Filter target text')).toBeVisible();
      await expect(target).toHaveText('Retained draft');
      await expect(workspace).not.toHaveAttribute('inert');
      await target.fill('Retained draft, still editable');
      await expect(target).toHaveText('Retained draft, still editable');
      await expect(page.getByRole('complementary', { name: 'Workspace navigation' })).toBeHidden();
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('opens toolbar AI translation on the context-filtered scope and resets it on reopening', async () => {
    const session = await createSmokeSession();
    try {
      const { page } = session;
      await page.getByRole('button', { name: 'Search target text; switch to context' }).click();
      await page.getByPlaceholder('Filter context').fill('ctx-2');
      await expect(page.locator('div.group.grid')).toHaveCount(1);
      await page.getByRole('button', { name: 'AI batch translate', exact: true }).click();
      await expect(page.getByLabel('Translation Scope')).toHaveValue('filtered');
      await expect(page.getByLabel('Translation Scope')).toContainText(
        'Current filtered results (1 segment)',
      );
      await page.getByLabel('Translation Scope').selectOption('file');
      await expect(page.getByLabel('Translation Scope')).toHaveValue('file');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByRole('button', { name: 'AI batch translate', exact: true }).click();
      await expect(page.getByLabel('Translation Scope')).toHaveValue('filtered');
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByPlaceholder('Filter context').fill('no matching context');
      await expect(page.locator('div.group.grid')).toHaveCount(0);
      await page.getByRole('button', { name: 'AI batch translate', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Start AI Translate' })).toBeDisabled();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByPlaceholder('Filter context').fill('');
      await expect(page.locator('div.group.grid')).toHaveCount(3);
      await page.getByRole('button', { name: 'AI batch translate', exact: true }).click();
      await expect(page.getByText('Entire file (3 segments)', { exact: true })).toBeVisible();
      await expect(page.getByLabel('Translation Scope')).toHaveCount(0);
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('keeps segment height stable when activation mounts CodeMirror', async () => {
    const session = await createSmokeSession();

    try {
      const { page } = session;
      const rows = page.locator('div.group.grid');
      await expect(rows).toHaveCount(3);

      const secondRow = rows.nth(1);
      const inactiveHeight = await secondRow.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(inactiveHeight).toBeGreaterThanOrEqual(92);

      await secondRow.click();
      await expect(secondRow.locator('.editor-target-editor-host .cm-content')).toBeVisible();
      await page.evaluate(
        () =>
          new Promise<void>((resolve) => {
            requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
          }),
      );

      const activeHeight = await secondRow.evaluate(
        (element) => element.getBoundingClientRect().height,
      );
      expect(Math.abs(activeHeight - inactiveHeight)).toBeLessThanOrEqual(0.5);
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('inserts source tags from the menu and Windows number-row shortcut', async () => {
    const session = await createSmokeSession();

    try {
      const { page } = session;
      const firstRow = page.locator('div.group.grid').first();
      await firstRow.click();

      const targetEditor = firstRow.locator('.editor-target-editor-host .cm-content');
      await expect(targetEditor).toBeVisible();
      await targetEditor.fill('AB');
      await page.keyboard.press('Home');
      await page.keyboard.press('ArrowRight');

      await firstRow.getByRole('button', { name: 'Toggle tag insertion menu' }).click();
      const insertionMenu = page.getByRole('menu', { name: 'Tag insertion menu' });
      await expect(insertionMenu).toBeVisible();
      await insertionMenu.getByRole('menuitem', { name: 'Insert tag 1: <b>' }).click();
      await expect(targetEditor).toHaveText('A{1>B');
      await expect(targetEditor).toBeFocused();
      await page.keyboard.press('Control+z');
      await expect(targetEditor).toHaveText('AB');
      await page.keyboard.press('Control+y');
      await expect(targetEditor).toHaveText('A{1>B');
      await page.keyboard.insertText('X');
      await expect(targetEditor).toHaveText('A{1>XB');

      const tagTrigger = firstRow.getByRole('button', { name: 'Toggle tag insertion menu' });
      await tagTrigger.click();
      await page.keyboard.press('Escape');
      await expect(insertionMenu).toBeHidden();
      await expect(tagTrigger).toBeFocused();
      await expect(targetEditor).toHaveText('A{1>XB');

      await targetEditor.focus();
      await page.keyboard.press('Control+a');
      await page.keyboard.press('Backspace');
      await targetEditor.dispatchEvent('keydown', {
        key: '!',
        code: 'Digit1',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });
      await expect(targetEditor).toContainText('{1>');
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('keeps target filters stable and switches to context search', async () => {
    const session = await createSmokeSession();

    try {
      const { page } = session;
      const rows = page.locator('div.group.grid');
      const targetFilter = page.getByPlaceholder('Filter target text');

      await targetFilter.fill('Needle target');
      await expect.poll(() => rows.count()).toBe(1);

      const filteredRow = rows.first();
      await filteredRow.click();
      const targetEditor = filteredRow.locator('.editor-target-editor-host .cm-content');
      await expect(targetEditor).toBeVisible();
      await targetEditor.focus();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.insertText('pomme');

      await expect(targetEditor).toContainText('pomme');
      await page.waitForTimeout(300);
      await expect(rows).toHaveCount(1);

      await targetFilter.fill('Needle target!');
      await expect.poll(() => rows.count()).toBe(0);
      await targetFilter.fill('pomme');
      await expect.poll(() => rows.count()).toBe(1);

      await page.getByRole('button', { name: 'Search target text; switch to context' }).click();
      const contextFilter = page.getByPlaceholder('Filter context');
      await contextFilter.fill('ctx-2');
      await expect.poll(() => rows.count()).toBe(1);
      await expect(rows.first().locator('mark.cm-target-highlight')).toHaveText('ctx-2');
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('carries an inactive target preview selection into the activated editor', async () => {
    const session = await createSmokeSession();

    try {
      const { page } = session;
      const secondRow = page.locator('div.group.grid').nth(1);
      const targetPreview = secondRow.locator('.editor-target-preview');
      const previewBox = await targetPreview.boundingBox();
      if (!previewBox) throw new Error('Expected inactive target preview bounds');

      await page.mouse.move(previewBox.x + 4, previewBox.y + previewBox.height / 2);
      await page.mouse.down();
      await page.mouse.move(
        previewBox.x + previewBox.width * 0.8,
        previewBox.y + previewBox.height / 2,
        {
          steps: 5,
        },
      );
      await page.mouse.up();

      const targetEditor = secondRow.locator('.editor-target-editor-host .cm-content');
      await expect(targetEditor).toBeVisible();
      await expect(targetEditor).toBeFocused();
      await expect
        .poll(() =>
          targetEditor.evaluate((content) => {
            const selection = content.ownerDocument.getSelection();
            if (
              !selection ||
              selection.isCollapsed ||
              !selection.anchorNode ||
              !selection.focusNode ||
              !content.contains(selection.anchorNode) ||
              !content.contains(selection.focusNode)
            ) {
              return 0;
            }
            return selection.toString().length;
          }),
        )
        .toBeGreaterThan(2);
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('non-printing symbols + filter stability + external update shortcuts', async () => {
    const session = await createSmokeSession();

    try {
      const { page, fileId } = session;

      const rowLocator = page.locator('div.group.grid');
      await expect(rowLocator).toHaveCount(3);

      // 1) Enable non-printing symbols and ensure space/tab/newline markers render without legacy ghost layers.
      await page.getByRole('button', { name: 'Toggle non-printing symbols' }).click();
      const firstEditorContent = page.locator('.editor-target-editor-host .cm-content').first();
      await firstEditorContent.click();
      await page.keyboard.type('A B\tC');
      await page.keyboard.press('Enter');
      await page.keyboard.type('D');

      // Temporarily unmount the active EditorView, then verify the retained
      // state restores both selection and pre-switch undo history.
      await rowLocator.nth(1).click();
      await rowLocator.nth(0).click();
      await firstEditorContent.focus();
      await expect(firstEditorContent).toBeFocused();
      await page.keyboard.insertText('X');
      await expect(firstEditorContent).toContainText('DX');
      await page.keyboard.press('Control+z');
      await expect(firstEditorContent).not.toContainText('DX');
      await page.keyboard.press('Control+z');
      await expect(firstEditorContent).not.toContainText('D');
      await page.keyboard.press('Control+a');
      await page.keyboard.insertText('A B\tC\nD');

      const firstEditor = page.locator('.editor-target-editor-host .cm-editor').first();
      await expect(firstEditor.locator('.cm-np-space').first()).toBeVisible();
      await expect(firstEditor.locator('.cm-np-tab').first()).toBeVisible();
      await expect(firstEditor.locator('.cm-np-newline').first()).toBeVisible();
      await expect(
        page.locator('.editor-target-overlay-text, .editor-target-textarea, .editor-target-mirror'),
      ).toHaveCount(0);

      // 2) Verify target filter is stable in both non-printing off/on modes.
      const targetFilter = page.getByPlaceholder('Filter target text');
      await targetFilter.fill('Needle target');
      await expect.poll(() => rowLocator.count()).toBe(1);
      await expect(page.locator('.cm-target-highlight').first()).toBeVisible();
      await page.waitForTimeout(400);
      await expect(rowLocator).toHaveCount(1);

      await targetFilter.fill('');
      await expect.poll(() => rowLocator.count()).toBe(3);

      await page.getByRole('button', { name: 'Toggle non-printing symbols' }).click();
      await targetFilter.fill('Needle target');
      await expect.poll(() => rowLocator.count()).toBe(1);
      await page.waitForTimeout(400);
      await expect(rowLocator).toHaveCount(1);
      await targetFilter.fill('');
      await expect.poll(() => rowLocator.count()).toBe(3);

      // 3) Simulate external write (TM/TB/AI-style) and validate shortcut actions.
      const firstSegmentId = await page.evaluate(async (nextFileId) => {
        const api = (window as unknown as { api: any }).api;
        const segments = await api.getSegments(nextFileId, 0, 10);
        const first = segments[0];
        await api.updateSegment(
          first.segmentId,
          [{ type: 'text', content: 'TM pushed content' }],
          'translated',
        );
        return first.segmentId as string;
      }, fileId);

      await expect(firstEditorContent).toContainText('TM pushed content');
      await targetFilter.fill('pushed');
      await expect.poll(() => rowLocator.count()).toBe(1);
      await expect(page.locator('.cm-target-highlight').first()).toBeVisible();
      await targetFilter.fill('');

      const insertAllTagsShortcut =
        process.platform === 'darwin' ? 'Meta+Shift+0' : 'Control+Shift+0';
      const confirmShortcut = 'Control+Enter';

      await firstEditorContent.click();
      await page.keyboard.press(insertAllTagsShortcut);
      await expect(firstEditorContent).toContainText('{1>');
      await expect(firstEditorContent).toContainText('<2}');

      await page.keyboard.press(confirmShortcut);
      await expect
        .poll(
          () =>
            page.evaluate(
              async ({ nextFileId, nextSegmentId }) => {
                const api = (window as unknown as { api: any }).api;
                const segments = await api.getSegments(nextFileId, 0, 20);
                return segments.find(
                  (segment: { segmentId: string }) => segment.segmentId === nextSegmentId,
                )?.status;
              },
              { nextFileId: fileId, nextSegmentId: firstSegmentId },
            ),
          {
            message: 'first segment should be confirmed after shortcut confirm',
            timeout: 30_000,
          },
        )
        .toBe('confirmed');

      // Programmatic activation changes must finalize the previous editing
      // session so its later IPC update can drain while the row is inactive.
      await page.evaluate(
        async ({ nextSegmentId }) => {
          const api = (window as unknown as { api: any }).api;
          await api.updateSegment(
            nextSegmentId,
            [{ type: 'text', content: 'post-confirm remote' }],
            'translated',
          );
        },
        { nextSegmentId: firstSegmentId },
      );
      await expect(rowLocator.nth(0)).toContainText('post-confirm remote');

      // An inactive external sync must not leave a suppression guard that
      // swallows the first real edit after reactivation.
      await rowLocator.nth(0).click();
      await firstEditorContent.focus();
      await page.keyboard.insertText('Z');
      await expect
        .poll(
          () =>
            page.evaluate(
              async ({ nextFileId, nextSegmentId }) => {
                const api = (window as unknown as { api: any }).api;
                const segments = await api.getSegments(nextFileId, 0, 20);
                const segment = segments.find(
                  (item: { segmentId: string }) => item.segmentId === nextSegmentId,
                );
                return (segment?.targetTokens ?? [])
                  .map((token: { content: string }) => token.content)
                  .join('');
              },
              { nextFileId: fileId, nextSegmentId: firstSegmentId },
            ),
          { timeout: 10_000 },
        )
        .toContain('Z');
    } finally {
      await closeSmokeSession(session);
    }
  });
});
