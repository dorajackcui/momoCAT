import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const APP_ROOT = join(__dirname, '..');

interface SmokeSession {
  electronApp: Awaited<ReturnType<typeof electron.launch>>;
  page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>;
  tempDir: string;
  fileId: number;
}

function createFixtureSpreadsheet(tempDir: string): string {
  const fixturePath = join(tempDir, 'cm6-smoke-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Source', 'Target', 'Context'],
    ['Hello <b>World</b>', '', 'ctx-1'],
    ['Needle source', 'Needle target', 'ctx-2'],
    ['Space and tab\tsegment', 'A B', 'ctx-3'],
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Segments');
  XLSX.writeFile(workbook, fixturePath);
  return fixturePath;
}

async function createSmokeSession(): Promise<SmokeSession> {
  const tempDir = mkdtempSync(join(tmpdir(), 'simple-cat-cm6-smoke-'));
  const fixturePath = createFixtureSpreadsheet(tempDir);
  const projectName = `cm6-smoke-${Date.now()}`;
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const electronApp = await electron.launch({
    cwd: APP_ROOT,
    args: ['.'],
    env: launchEnv,
  });
  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();

  const seeded = await page.evaluate(
    async ({ nextProjectName, nextFixturePath }) => {
      const api = (window as unknown as { api: any }).api;
      const project = await api.createProject(nextProjectName, 'en', 'zh', 'translation');
      const file = await api.addFileToProject(project.id, nextFixturePath, {
        hasHeader: true,
        sourceCol: 0,
        targetCol: 1,
        contextCol: 2,
      });
      return {
        projectName: project.name as string,
        fileName: file.name as string,
        fileId: file.id as number,
      };
    },
    {
      nextProjectName: projectName,
      nextFixturePath: fixturePath,
    },
  );

  await page.reload();

  const projectCard = page.locator('.surface-card', { hasText: seeded.projectName }).first();
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole('button', { name: 'Open' }).click();

  const fileTitle = page.getByText(seeded.fileName, { exact: true }).first();
  await expect(fileTitle).toBeVisible();
  await fileTitle.click();

  await expect(page.getByPlaceholder('Filter target text')).toBeVisible();

  return {
    electronApp,
    page,
    tempDir,
    fileId: seeded.fileId,
  };
}

async function closeSmokeSession(session: SmokeSession): Promise<void> {
  await session.electronApp.close();
  rmSync(session.tempDir, { recursive: true, force: true });
}

test.describe('CodeMirror editor engine smoke', () => {
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
