import { expect, test } from '@playwright/test';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import type { DesktopApi } from '../src/shared/ipc';

test('Confirm succeeds with QA findings and skips checks when instant QA is off', async () => {
  const session = await createEditorSmokeSession([
    ['Count 1', 'Count 2', ''],
    ['Hello <b>world</b>', 'Missing markers', ''],
  ]);
  try {
    const { page, fileId } = session;
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Numbers', exact: true })).toBeVisible();
    await page.locator('.editor-row').first().locator('.editor-target-cell').click();
    await page.keyboard.press('Control+Enter');
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const rows = await (window as any).api.getSegments(id, 0, 10);
          return {
            status: rows[0].status,
            qa: rows[0].qaIssues?.some((issue: any) => issue.ruleId === 'number'),
          };
        }, fileId),
      )
      .toEqual({ status: 'confirmed', qa: true });
    await expect(page.getByRole('region', { name: 'Numbers', exact: true })).toBeVisible();
    await page.evaluate(async (id) => {
      const api = (window as any).api;
      const file = await api.getFile(id);
      await api.updateProjectQASettings(file.projectId, {
        enabledRuleIds: [],
        instantQaOnConfirm: false,
      });
    }, fileId);
    await expect(page.getByRole('region', { name: 'Numbers', exact: true })).toHaveCount(0);
    await page.locator('.editor-row').nth(1).locator('.editor-target-cell').click();
    await page.keyboard.press('Control+Enter');
    await expect
      .poll(async () =>
        page.evaluate(async (id) => {
          const rows = await (window as any).api.getSegments(id, 0, 10);
          return {
            status: rows[1].status,
            qa: rows[1].qaIssues,
          };
        }, fileId),
      )
      .toEqual({ status: 'confirmed', qa: undefined });
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(
      page.getByRole('region', { name: 'Tag / Placeholder', exact: true }),
    ).toBeVisible();
    const stats = await page.evaluate(async (id) => (window as any).api.getFile(id), fileId);
    expect(stats.segmentStatusStats.qaProblemSegments).toBe(1);
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('QA lists findings and filters CAT rows directly, retaining edits until recheck', async () => {
  const session = await createEditorSmokeSession([
    ['Open', '打开', ''],
    ['Open', '开启', ''],
    ['[Open]', '[打开]', ''],
    ['Open the menu', '开启菜单', ''],
    ['Open the file', '开启文件', ''],
    ['Count 12', '数量 13', ''],
    ['Clean', '正确', ''],
    ['[Save]', '[保存]', ''],
    ['Save file', '存档文件', ''],
  ]);
  try {
    const { page, fileId } = session;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByPlaceholder('Filter source text').fill('Clean');
    await expect(page.locator('.editor-row')).toHaveCount(1);
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'QA', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByText('Checking…', { exact: true })).toHaveCount(0);
    const consistency = page.getByRole('region', {
      name: 'Same source, different targets',
      exact: true,
    });
    await expect(consistency).toBeVisible();
    await page.setViewportSize({ width: 900, height: 800 });
    await expect(consistency).toBeVisible();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect(consistency.locator('details')).toHaveCount(0);
    await expect(
      consistency.getByRole('button', { name: 'Row 2 打开', exact: true }),
    ).toBeVisible();
    await consistency
      .getByRole('button', { name: 'Same source, different targets · 3 rows', exact: true })
      .click();
    await expect(page.getByPlaceholder('Filter source text')).toHaveValue('');
    await expect(page.locator('.editor-row')).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath('qa-panel.png'), animations: 'disabled' });
    const terminology = page.getByRole('region', { name: 'Terminology', exact: true });
    await terminology.screenshot({
      path: test.info().outputPath('qa-terminology.png'),
      animations: 'disabled',
    });
    const categoryButton = terminology.getByRole('button', {
      name: 'Terminology · 4 rows',
      exact: true,
    });
    await expect(categoryButton).toHaveText('Terminology4');
    await expect(
      terminology.getByRole('button', { name: 'Open → 打开 · 3 rows', exact: true }),
    ).toHaveText('Open → 打开3');
    await terminology.getByRole('button', { name: 'Collapse Terminology', exact: true }).click();
    await expect(
      terminology.getByRole('button', { name: 'Open → 打开 · 3 rows', exact: true }),
    ).toBeHidden();
    await expect(page.locator('.editor-row')).toHaveCount(3);
    await categoryButton.click();
    await expect(page.locator('.editor-source-text')).toHaveText([
      'Open',
      'Open the menu',
      'Open the file',
      'Save file',
    ]);
    await page.screenshot({
      path: test.info().outputPath('qa-collapsed.png'),
      animations: 'disabled',
    });
    await terminology
      .getByRole('button', { name: 'Expand Terminology', exact: true })
      .press('Enter');
    await expect(terminology.getByText(/expects/)).toHaveCount(0);
    await expect(
      terminology.getByRole('button', { name: 'Open → 打开 · 3 rows', exact: true }),
    ).toHaveAttribute('title', 'Open → 打开\nSources: Current file');
    await expect(
      terminology.getByRole('button', { name: 'Row 5 开启菜单', exact: true }),
    ).toBeVisible();
    await terminology.getByRole('button', { name: 'Open → 打开 · 3 rows', exact: true }).click();
    await expect(page.locator('.editor-row')).toHaveCount(3);
    await expect(page.locator('.editor-source-text')).toHaveText([
      'Open',
      'Open the menu',
      'Open the file',
    ]);
    await terminology.getByRole('button', { name: 'Row 5 开启菜单', exact: true }).click();
    await expect(page.locator('.cm-content')).toHaveText('开启菜单');
    const savedFindings = await page.evaluate(async (id) => {
      const api = (window as any).api;
      return {
        issues: (await api.getSegments(id, 0, 10)).map((row: any) => row.qaIssues),
        problems: (await api.getFile(id)).segmentStatusStats.qaProblemSegments,
      };
    }, fileId);
    const target = page.locator('.cm-content');
    await target.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
    await target.fill('打开菜单');
    await page.locator('.editor-row').nth(2).locator('.editor-target-cell').click();
    await expect(page.getByText('Changed · Recheck needed', { exact: true })).toBeVisible();
    await expect(
      terminology.getByRole('button', { name: 'Row 5 打开菜单', exact: true }),
    ).toBeVisible();
    await expect(page.locator('.editor-row')).toHaveCount(3);
    await page.getByRole('button', { name: 'Exit QA filter', exact: true }).click();
    await expect(page.locator('.editor-row')).toHaveCount(9);
    await expect(page.getByPlaceholder('Filter source text')).toHaveValue('');
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const api = (window as any).api;
          const rows = await api.getSegments(id, 0, 10);
          return {
            target: rows[3].targetTokens.map((token: any) => token.content).join(''),
            issues: rows.map((row: any) => row.qaIssues),
            problems: (await api.getFile(id)).segmentStatusStats.qaProblemSegments,
          };
        }, fileId),
      )
      .toEqual({ target: '打开菜单', ...savedFindings });
    const file = await page.evaluate(async (id) => (window as any).api.getFile(id), fileId);
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByText(file.name, { exact: true }).first().click();
    await page.getByRole('tab', { name: 'QA', exact: true }).click();
    await expect(
      terminology.getByRole('button', { name: 'Row 5 打开菜单', exact: true }),
    ).toBeVisible();
    await expect(page.getByText('Saved results · Recheck needed', { exact: true })).toHaveClass(
      /notice-warning/,
    );
    await terminology.getByRole('button', { name: 'Row 5 打开菜单', exact: true }).click();
    await page.locator('.cm-content').fill('打开新菜单');
    await expect(page.getByText('Changed · Recheck needed', { exact: true })).toHaveClass(
      /notice-warning/,
    );
    await page.screenshot({
      path: test.info().outputPath('qa-reopened-edited.png'),
      animations: 'disabled',
    });
    await page.getByRole('button', { name: 'Run QA', exact: true }).click();
    await expect(
      terminology.getByRole('button', { name: 'Open → 打开 · 2 rows', exact: true }),
    ).toBeVisible();
    await expect(
      terminology.getByRole('button', { name: 'Row 5 打开新菜单', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByText(/Recheck needed/)).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('QA leaves editing, filters and navigation available without overwriting pending changes', async () => {
  const session = await createEditorSmokeSession([
    ['Count 1', 'Count 2', ''],
    ['Clean', '正确', ''],
  ]);
  try {
    const { page, electronApp, fileId } = session;
    const report = await page.evaluate(async (id) => (window as any).api.runFileQA(id), fileId);
    await electronApp.evaluate(
      ({ ipcMain }, { channel, report }) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(
          channel,
          () =>
            new Promise((resolve) => {
              (globalThis as any).finishSmokeQA = () => resolve(report);
            }),
        );
      },
      { channel: IPC_CHANNELS.file.runQA, report },
    );
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(page.getByText('Checking…', { exact: true })).toBeVisible();
    await page.locator('.editor-row').first().locator('.editor-target-cell').click();
    await page.locator('.cm-content').fill('Count 1 fixed while checking');
    await page.getByPlaceholder('Filter source text').fill('Count');
    await expect(page.locator('.editor-row')).toHaveCount(1);
    await expect(page.getByText('Checking…', { exact: true })).toBeVisible();
    await electronApp.evaluate(() => (globalThis as any).finishSmokeQA());
    await expect(page.getByText('Changed · Recheck needed', { exact: true })).toBeVisible();
    await expect(page.locator('.editor-target-cell')).toContainText('Count 1 fixed while checking');
    await page.getByRole('button', { name: 'Run QA', exact: true }).click();
    await expect(page.getByText('Checking…', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'QA', exact: true })).toBeVisible();
    await expect(page.getByPlaceholder('Filter source text')).toHaveCount(0);
    await electronApp.evaluate(() => (globalThis as any).finishSmokeQA());
  } finally {
    await closeEditorSmokeSession(session);
  }
});

for (const problemCount of [3, 501]) {
  test(`QA summarizes repeated substring references with ${problemCount} findings`, async () => {
    const session = await createEditorSmokeSession([
      ...Array.from({ length: 40 }, () => ['Artwork', '作品', '']),
      ...Array.from({ length: problemCount }, (_, index) => [
        `Artwork in sentence ${index}`,
        '其他译文',
        '',
      ]),
    ]);
    try {
      const { page, fileId } = session;
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(async (id) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        const file = await api.getFile(id);
        if (!file) throw new Error('Missing QA fixture');
        await api.updateProjectQASettings(file.projectId, {
          enabledRuleIds: ['substring-consistency'],
          instantQaOnConfirm: false,
        });
      }, fileId);
      await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
      await expect(
        page.getByRole('button', { name: 'Reference row 2', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: /^Reference row / })).toHaveCount(1);
      await expect(
        page.getByRole('button', { name: 'Row 42 其他译文', exact: true }),
      ).toBeVisible();
      const group = page.getByRole('button', {
        name: `Artwork → 作品 · ${problemCount} rows`,
        exact: true,
      });
      await group.click();
      await expect(page.locator('.editor-source-text').first()).toHaveText('Artwork in sentence 0');
      await page.getByRole('button', { name: 'Reference row 2', exact: true }).click();
      await expect(page.locator('.cm-content')).toHaveText('作品');
      await page.getByRole('button', { name: 'View all 40 references', exact: true }).click();
      await expect(
        page.getByText(
          'QA filter: Substring translation consistency › Artwork → 作品 › Reference rows · 40 rows',
          {
            exact: true,
          },
        ),
      ).toBeVisible();
      await expect(page.locator('.editor-source-text').first()).toHaveText('Artwork');
      await expect(page.locator('.editor-source-text', { hasText: 'sentence' })).toHaveCount(0);
      if (problemCount === 3)
        await page.screenshot({
          path: test.info().outputPath('qa-reference-summary.png'),
          animations: 'disabled',
        });
      await group.click();
      await expect(page.locator('.editor-source-text').first()).toHaveText('Artwork in sentence 0');
    } finally {
      await closeEditorSmokeSession(session);
    }
  });
}

test('large-file QA keeps the main and renderer event loops responsive', async () => {
  const rows = Array.from({ length: 3000 }, (_, index) => {
    const id = String(index % 80).padStart(5, '0');
    return index < 80 ? [`[Term${id}]`, `[译${id}]`, ''] : [`Use Term${id} here`, `目标${id}`, ''];
  });
  const session = await createEditorSmokeSession(rows);
  try {
    const { electronApp, page, fileId } = session;
    await electronApp.evaluate(() => {
      const state = {
        last: Date.now(),
        gaps: [] as number[],
        timer: undefined as ReturnType<typeof setInterval> | undefined,
      };
      state.timer = setInterval(() => {
        const now = Date.now();
        state.gaps.push(now - state.last);
        state.last = now;
      }, 20);
      (globalThis as any).qaHeartbeat = state;
    });
    const renderer = await page.evaluate(async (id) => {
      const gaps: number[] = [];
      let last = performance.now();
      const timer = setInterval(() => {
        const now = performance.now();
        gaps.push(now - last);
        last = now;
      }, 20);
      const started = performance.now();
      try {
        const report = await (window as any).api.runFileQA(id);
        return {
          durationMs: performance.now() - started,
          checked: report.checkedSegments,
          findings: report.issues.length,
          samples: gaps.length,
          maxGapMs: Math.max(...gaps, 0),
        };
      } finally {
        clearInterval(timer);
      }
    }, fileId);
    const main = await electronApp.evaluate(() => {
      const state = (globalThis as any).qaHeartbeat;
      clearInterval(state.timer);
      return { samples: state.gaps.length, maxGapMs: Math.max(...state.gaps, 0) };
    });
    await test.info().attach('qa-performance.json', {
      body: Buffer.from(JSON.stringify({ main, renderer }, null, 2)),
      contentType: 'application/json',
    });
    console.log('QA performance', JSON.stringify({ main, renderer }));
    expect(renderer.checked).toBe(3000);
    expect(renderer.findings).toBeGreaterThanOrEqual(2920);
    expect(main.samples).toBeGreaterThan(3);
    expect(renderer.samples).toBeGreaterThan(3);
    expect(main.maxGapMs).toBeLessThan(1000);
    expect(renderer.maxGapMs).toBeLessThan(1000);
    await page.evaluate(() => {
      const state = { last: performance.now(), gaps: [] as number[], timer: 0 };
      state.timer = window.setInterval(() => {
        const now = performance.now();
        state.gaps.push(now - state.last);
        state.last = now;
      }, 20);
      (window as any).qaPanelHeartbeat = state;
    });
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(page.getByText('2920 findings · 2920 rows', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Filter source text').fill('Term00001');
    const panel = await page.evaluate(() => {
      const state = (window as any).qaPanelHeartbeat;
      clearInterval(state.timer);
      return { samples: state.gaps.length, maxGapMs: Math.max(...state.gaps, 0) };
    });
    console.log('QA panel performance', JSON.stringify(panel));
    expect(panel.maxGapMs).toBeLessThan(1000);
    await page.screenshot({
      path: test.info().outputPath('qa-large-results.png'),
      animations: 'disabled',
    });
    expect(await page.getByRole('button', { name: /^Row \d/ }).count()).toBeLessThan(100);
    const results = page.getByLabel('QA results', { exact: true });
    await results.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(
      page.getByRole('button', { name: 'Row 2961 目标00079', exact: true }),
    ).toBeVisible();
    await results.evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.getByRole('button', { name: 'Collapse Terminology', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Row \d/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Terminology · 2920 rows', exact: true }).click();
    await expect(page.getByPlaceholder('Filter source text')).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Exit QA filter', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Expand Terminology', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Row 82 / })).toBeVisible();
  } finally {
    await closeEditorSmokeSession(session);
  }
});
