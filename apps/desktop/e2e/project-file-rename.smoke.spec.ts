import { _electron as electron, expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DesktopApi } from '../src/shared/ipc';

const APP_ROOT = join(__dirname, '..');

test('renames an imported project file without changing its extension or contents', async () => {
  test.setTimeout(90_000);
  const tempDir = mkdtempSync(join(tmpdir(), 'momocat-file-rename-'));
  const exportPath = join(tempDir, 'renamed-export.csv');
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const stamp = Date.now();
  const projectName = `file-rename-smoke-${stamp}`;
  const renamedBase = `renamed-import-${stamp}`;
  const missingRenamedBase = `renamed-missing-import-${stamp}`;
  let projectId: number | undefined;

  const electronApp = await electron.launch({ cwd: APP_ROOT, args: ['.'], env: launchEnv });
  const page = await electronApp.firstWindow({ timeout: 60_000 });

  try {
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    const seeded = await page.evaluate(
      async ({ nextProjectName }) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const project = await api.createProject(nextProjectName, 'en', 'fr', 'translation');
        const file = await api.createPastedSourceFile(project.id, {
          sources: ['First source', 'Second source'],
          tagPolicy: 'default',
        });
        const missingFile = await api.createPastedSourceFile(project.id, {
          sources: ['Missing internal source'],
          tagPolicy: 'default',
        });
        return {
          projectId: project.id,
          fileId: file.id,
          fileName: file.name,
          updatedAt: file.updatedAt,
          missingFileId: missingFile.id,
          missingFileName: missingFile.name,
        };
      },
      { nextProjectName: projectName },
    );
    projectId = seeded.projectId;

    await page.reload();
    const projectCard = page.locator('.surface-card', { hasText: projectName }).first();
    await expect(projectCard).toBeVisible();
    await projectCard.getByRole('button', { name: 'Open' }).click();

    const originalHeading = page.getByRole('heading', { name: seeded.fileName, exact: true });
    await expect(originalHeading).toBeVisible();
    await originalHeading.hover();
    await page.getByRole('button', { name: `Rename ${seeded.fileName}`, exact: true }).click();

    const input = page.getByLabel('Rename file', { exact: true });
    const extension = seeded.fileName.slice(seeded.fileName.lastIndexOf('.'));
    await expect(input).toBeVisible();
    await expect(input.locator('..').getByText(extension, { exact: true })).toBeVisible();
    await input.fill(renamedBase);
    await page.getByRole('button', { name: 'Save file name' }).click();

    const renamedFileName = `${renamedBase}${extension}`;
    await expect(page.getByRole('heading', { name: renamedFileName, exact: true })).toBeVisible();

    const persisted = await page.evaluate(
      async ({ fileId, outputPath }) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const file = await api.getFile(fileId);
        const segments = await api.getSegments(fileId, 0, 10);
        await api.exportFile(fileId, outputPath);
        return { name: file?.name, updatedAt: file?.updatedAt, segmentCount: segments.length };
      },
      { fileId: seeded.fileId, outputPath: exportPath },
    );

    expect(persisted).toEqual({
      name: renamedFileName,
      updatedAt: seeded.updatedAt,
      segmentCount: 2,
    });
    expect(existsSync(exportPath)).toBe(true);

    const missingInternalPath = join(
      APP_ROOT,
      '..',
      '..',
      '.cat_data',
      'projects',
      String(seeded.projectId),
      `${seeded.missingFileId}_${seeded.missingFileName}`,
    );
    expect(existsSync(missingInternalPath)).toBe(true);
    rmSync(missingInternalPath, { force: true });

    const missingHeading = page.getByRole('heading', {
      name: seeded.missingFileName,
      exact: true,
    });
    await missingHeading.hover();
    await page
      .getByRole('button', { name: `Rename ${seeded.missingFileName}`, exact: true })
      .click();
    const missingInput = page.getByLabel('Rename file', { exact: true });
    const missingExtension = seeded.missingFileName.slice(seeded.missingFileName.lastIndexOf('.'));
    await missingInput.fill(`${missingRenamedBase}${missingExtension}`);
    await page.getByRole('button', { name: 'Save file name' }).click();

    const normalizedMissingName = `${missingRenamedBase}${missingExtension}`;
    await expect(
      page.getByRole('heading', { name: normalizedMissingName, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/internal source file is missing/i)).toBeVisible();
    await expect
      .poll(async () =>
        page.evaluate(async (fileId) => {
          const api = (window as unknown as { api: DesktopApi }).api;
          return (await api.getFile(fileId))?.name;
        }, seeded.missingFileId),
      )
      .toBe(normalizedMissingName);
  } finally {
    if (projectId !== undefined) {
      await page
        .evaluate(async (id) => {
          await (window as unknown as { api: DesktopApi }).api.deleteProject(id);
        }, projectId)
        .catch(() => undefined);
    }
    await electronApp.close();
    rmSync(tempDir, { recursive: true, force: true });
  }
});
