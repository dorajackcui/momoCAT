import { _electron as electron, expect } from '@playwright/test';
import type { ProjectQASettings } from '@cat/core/project';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as XLSX from 'xlsx';

const APP_ROOT = join(__dirname, '..', '..');

export interface EditorSmokeSession {
  electronApp: Awaited<ReturnType<typeof electron.launch>>;
  page: Awaited<ReturnType<Awaited<ReturnType<typeof electron.launch>>['firstWindow']>>;
  tempDir: string;
  fileId: number;
  projectName: string;
}

function createFixtureSpreadsheet(tempDir: string, rows?: string[][]): string {
  const fixturePath = join(tempDir, 'cm6-smoke-fixture.xlsx');
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet([
    ['Source', 'Target', 'Context'],
    ...(rows ?? [
      ['Hello <b>World</b>', '', 'ctx-1'],
      ['Needle source', 'Needle target', 'ctx-2'],
      ['Space and tab\tsegment', 'A B', 'ctx-3'],
    ]),
  ]);
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Segments');
  XLSX.writeFile(workbook, fixturePath);
  return fixturePath;
}

export async function createEditorSmokeSession(
  rows?: string[][],
  options?: {
    tagPolicy?: 'default' | 'none';
    srcLang?: string;
    tgtLang?: string;
    qaSettings?: ProjectQASettings;
  },
): Promise<EditorSmokeSession> {
  const tempDir = mkdtempSync(join(tmpdir(), 'simple-cat-cm6-smoke-'));
  const fixturePath = createFixtureSpreadsheet(tempDir, rows);
  const projectName = `cm6-smoke-${Date.now()}`;
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  launchEnv.MOMOCAT_USER_DATA_DIR = tempDir;

  const electronApp = await electron.launch({
    cwd: APP_ROOT,
    args: ['.'],
    env: launchEnv,
  });
  const page = await electronApp.firstWindow();

  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();

  const seeded = await page.evaluate(
    async ({ nextProjectName, nextFixturePath, nextOptions }) => {
      const api = (window as unknown as { api: any }).api;
      const project = await api.createProject(
        nextProjectName,
        nextOptions?.srcLang ?? 'en',
        nextOptions?.tgtLang ?? 'zh',
        'translation',
      );
      if (nextOptions?.qaSettings)
        await api.updateProjectQASettings(project.id, {
          ...project.qaSettings,
          ...nextOptions.qaSettings,
        });
      const file = await api.addFileToProject(project.id, nextFixturePath, {
        hasHeader: true,
        sourceCol: 0,
        targetCol: 1,
        contextCol: 2,
        ...(nextOptions?.tagPolicy ? { tagPolicy: nextOptions.tagPolicy } : {}),
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
      nextOptions: options,
    },
  );

  await page.reload();

  const projectLink = page
    .getByRole('navigation', { name: 'Projects', exact: true })
    .getByRole('button', { name: seeded.projectName, exact: true });
  await expect(projectLink).toBeVisible();
  await projectLink.click();

  const fileTitle = page.getByText(seeded.fileName, { exact: true }).first();
  await expect(fileTitle).toBeVisible();
  await fileTitle.click();

  await expect(page.getByPlaceholder('Filter target text')).toBeVisible();

  return {
    electronApp,
    page,
    tempDir,
    fileId: seeded.fileId,
    projectName: seeded.projectName,
  };
}

export async function closeEditorSmokeSession(session: EditorSmokeSession): Promise<void> {
  await session.electronApp.close();
  rmSync(session.tempDir, { recursive: true, force: true });
}
