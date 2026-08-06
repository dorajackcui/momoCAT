import { _electron as electron, expect, test } from '@playwright/test';
import { join } from 'node:path';
import type { DesktopApi } from '../src/shared/ipc';

const APP_ROOT = join(__dirname, '..');

test('renames TM/TB cards inline and keeps stale-save failures editable', async () => {
  test.setTimeout(90_000);
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;

  const stamp = Date.now();
  const originalTmName = `rename-smoke-tm-${stamp}`;
  const renamedTmName = `${originalTmName}-done`;
  const staleTmName = `stale-rename-smoke-tm-${stamp}`;
  const originalTbName = `rename-smoke-tb-${stamp}`;
  const renamedTbName = `${originalTbName}-done`;
  let tmId: string | undefined;
  let staleTmId: string | undefined;
  let tbId: string | undefined;

  const electronApp = await electron.launch({ cwd: APP_ROOT, args: ['.'], env: launchEnv });
  const page = await electronApp.firstWindow({ timeout: 60_000 });

  try {
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible();
    ({ tmId, staleTmId, tbId } = await page.evaluate(
      async ({ tmName, staleName, tbName }) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const [tm, staleTm, tb] = await Promise.all([
          api.createTM(tmName, 'en', 'fr', 'main'),
          api.createTM(staleName, 'en', 'fr', 'main'),
          api.createTB(tbName, 'en', 'fr'),
        ]);
        return { tmId: tm as string, staleTmId: staleTm as string, tbId: tb as string };
      },
      { tmName: originalTmName, staleName: staleTmName, tbName: originalTbName },
    ));

    await page.getByRole('button', { name: 'TM', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'TM Management' })).toBeVisible();
    const tmHeading = page.getByRole('heading', { name: originalTmName, exact: true });
    await expect(tmHeading).toBeVisible();
    await tmHeading.hover();
    await page.getByRole('button', { name: `Rename ${originalTmName}`, exact: true }).click();

    let input = page.getByLabel('Rename TM', { exact: true });
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(page.getByRole('heading', { name: originalTmName, exact: true })).toBeVisible();

    await tmHeading.hover();
    await page.getByRole('button', { name: `Rename ${originalTmName}`, exact: true }).click();
    input = page.getByLabel('Rename TM', { exact: true });
    await input.fill('   ');
    await expect(page.getByRole('button', { name: 'Save TM name' })).toBeDisabled();
    await input.fill(renamedTmName);
    await page.getByRole('button', { name: 'Save TM name' }).click();
    await expect(page.getByRole('heading', { name: renamedTmName, exact: true })).toBeVisible();

    const staleTmHeading = page.getByRole('heading', { name: staleTmName, exact: true });
    await expect(staleTmHeading).toBeVisible();
    await staleTmHeading.hover();
    await page.getByRole('button', { name: `Rename ${staleTmName}`, exact: true }).click();
    input = page.getByLabel('Rename TM', { exact: true });
    await page.evaluate(async (id) => {
      await (window as unknown as { api: DesktopApi }).api.deleteTM(id);
    }, staleTmId);
    await input.fill(`${staleTmName}-missing`);
    await page.getByRole('button', { name: 'Save TM name' }).click();
    await expect(input).toBeVisible();
    await expect(input).toBeEnabled();
    await expect(input).toHaveValue(`${staleTmName}-missing`);

    await page.getByRole('button', { name: 'TB', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'TB Management' })).toBeVisible();
    const tbHeading = page.getByRole('heading', { name: originalTbName, exact: true });
    await expect(tbHeading).toBeVisible();
    await tbHeading.hover();
    await page.getByRole('button', { name: `Rename ${originalTbName}`, exact: true }).click();
    input = page.getByLabel('Rename term base', { exact: true });
    await input.fill(renamedTbName);
    await input.press('Enter');
    await expect(page.getByRole('heading', { name: renamedTbName, exact: true })).toBeVisible();

    const persisted = await page.evaluate(
      async ({ nextTmId, nextTbId }) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const [tms, tbs] = await Promise.all([api.listTMs('main'), api.listTBs()]);
        return {
          tmName: tms.find((tm) => tm.id === nextTmId)?.name,
          tbName: tbs.find((tb) => tb.id === nextTbId)?.name,
        };
      },
      { nextTmId: tmId, nextTbId: tbId },
    );
    expect(persisted).toEqual({ tmName: renamedTmName, tbName: renamedTbName });
  } finally {
    await page
      .evaluate(
        async (ids) => {
          const api = (window as unknown as { api: DesktopApi }).api;
          if (ids.tmId) await api.deleteTM(ids.tmId);
          if (ids.staleTmId) await api.deleteTM(ids.staleTmId);
          if (ids.tbId) await api.deleteTB(ids.tbId);
        },
        { tmId, staleTmId, tbId },
      )
      .catch(() => undefined);
    await electronApp.close();
  }
});
