import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import type { DesktopApi } from '../src/shared/ipc';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
async function storedSegments(page: Page, fileId: number) {
  return page.evaluate(
    (id) => (window as unknown as { api: DesktopApi }).api.getSegments(id, 0, 1000),
    fileId,
  );
}

test('selects by row numbers and keeps text selection separate from segment selection', async () => {
  const session = await createEditorSmokeSession();
  try {
    const { page } = session;
    const rows = page.locator('.editor-row');
    const numbers = page.locator('.editor-row-number');
    const toolbar = page.getByRole('group', { name: 'Translation tools' }).locator('..');
    expect(
      await toolbar
        .getByRole('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))),
    ).toEqual([
      'AI batch translate',
      'Run batch QA',
      'Clear selected targets',
      'Copy source to selected targets',
      'Confirm selected segments',
      'Toggle non-printing symbols',
      'Editor appearance',
    ]);
    expect(
      await toolbar.evaluate((element) => parseFloat(getComputedStyle(element).borderBottomWidth)),
    ).toBeGreaterThan(0);
    for (const group of ['Translation tools', 'Selected segments', 'Display settings']) {
      await expect(page.getByRole('group', { name: group })).toHaveCSS('border-width', '0px');
    }
    await expect(page.getByRole('group', { name: 'Selected segments' })).not.toContainText(
      'selected',
    );
    await rows.nth(0).locator('.editor-source-text').click();
    await rows
      .nth(2)
      .locator('.editor-target-cell')
      .click({ modifiers: ['Shift'] });
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(3);
    await rows
      .nth(1)
      .locator('.editor-source-text')
      .click({ modifiers: [modifier] });
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(2);
    await numbers.nth(0).click();
    await numbers.nth(2).focus();
    await numbers.nth(2).press('Shift+Enter');
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(3);
    await numbers.nth(1).focus();
    await numbers.nth(1).press(`${modifier}+Space`);
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(2);
    await numbers.nth(0).click();
    await numbers.nth(2).click({ modifiers: ['Shift'] });
    const outlines = await page.locator('.editor-selection-outline').evaluateAll((elements) =>
      elements.map((element) => {
        const css = getComputedStyle(element);
        return [parseFloat(css.borderTopWidth) > 0, parseFloat(css.borderBottomWidth) > 0];
      }),
    );
    expect(outlines).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
    const rowBounds = await rows.first().locator('.editor-target-cell').boundingBox();
    const outlineBounds = await rows.first().locator('.editor-selection-outline').boundingBox();
    expect(Math.abs(outlineBounds!.x - rowBounds!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(outlineBounds!.width - rowBounds!.width)).toBeLessThanOrEqual(1);
    await expect(numbers.nth(2)).toHaveCSS('outline-color', 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: resolve(__dirname, '../../../.tmp/editor-selection.png') });
    await numbers.nth(1).click({ modifiers: [modifier] });
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(2);
    await page.locator('.editor-row').nth(1).locator('.editor-target-cell').click();
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(1);
    const target = page.locator('.cm-content');
    await target.press(`${modifier}+a`);
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(1);
    await target.press(`${modifier}+Shift+a`);
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(3);
    await page
      .getByRole('button', { name: 'Copy source to selected targets', exact: true })
      .click();
    await expect
      .poll(async () =>
        (await storedSegments(page, session.fileId)).every(
          (segment) =>
            segment.status === 'draft' &&
            JSON.stringify(segment.targetTokens) === JSON.stringify(segment.sourceTokens),
        ),
      )
      .toBe(true);
    await page.locator('.editor-scrollbar').press(`${modifier}+Enter`);
    await expect
      .poll(async () =>
        (await storedSegments(page, session.fileId)).every((s) => s.status === 'confirmed'),
      )
      .toBe(true);
    await page.getByRole('button', { name: 'Clear selected targets', exact: true }).click();
    await expect
      .poll(async () =>
        (await storedSegments(page, session.fileId)).every(
          (s) => s.status === 'empty' && s.targetTokens.length === 0,
        ),
      )
      .toBe(true);
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('selects all filtered drafts beyond the viewport without changing hidden repeats', async () => {
  const rows = Array.from({ length: 80 }, (_, index) => [
    `Source ${Math.floor(index / 2)}`,
    index % 2 ? '' : `Draft ${index}`,
    '',
  ]);
  const session = await createEditorSmokeSession(rows);
  try {
    const { page, fileId } = session;
    await page.getByRole('button', { name: 'Open filters', exact: true }).click();
    await page.getByRole('button', { name: 'Draft', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.locator('.editor-row-number').first().click();
    await page.keyboard.press(`${modifier}+Shift+a`);
    await expect(
      page.getByRole('button', { name: 'Confirm selected segments', exact: true }),
    ).toBeEnabled();
    expect(await page.locator('.editor-row').count()).toBeLessThan(40);
    await page.keyboard.press(`${modifier}+c`);
    const copied = await session.electronApp.evaluate(({ clipboard }) => clipboard.readText());
    expect(copied.split('\n')).toHaveLength(40);
    expect(copied.split('\n')[39]).toBe('Source 39\tDraft 78');
    await page.getByRole('button', { name: 'Confirm selected segments', exact: true }).click();
    await expect
      .poll(
        async () =>
          (await storedSegments(page, fileId)).filter((s) => s.status === 'confirmed').length,
      )
      .toBe(40);
    const segments = await storedSegments(page, fileId);
    expect(segments.filter((s) => s.status === 'empty')).toHaveLength(40);
    expect(
      segments.filter((s) => s.status === 'empty').every((s) => s.targetTokens.length === 0),
    ).toBe(true);
    // The editor preserves filtered membership while editing; changing the
    // criteria refreshes it and permanently drops selections that become hidden.
    await page.getByRole('button', { name: 'Open filters', exact: true }).click();
    await page.getByRole('button', { name: 'Draft', exact: true }).click();
    await page.getByRole('button', { name: 'Empty', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(
      page.getByRole('button', { name: 'Confirm selected segments', exact: true }),
    ).toBeDisabled();
    await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
    await expect(
      page.getByRole('button', { name: 'Confirm selected segments', exact: true }),
    ).toBeDisabled();
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('copies bilingual rows and pastes targets while distinguishing cell and row line breaks', async () => {
  const session = await createEditorSmokeSession([
    ['Source one', 'Target one\ncontinued', ''],
    ['Source two', '', ''],
    ['Source three', 'Target three', ''],
  ]);
  try {
    const { page, electronApp, fileId } = session;
    const numbers = page.locator('.editor-row-number');
    await numbers.nth(2).click();
    await numbers.nth(0).click({ modifiers: [modifier] });
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(2);
    await page.keyboard.press(`${modifier}+c`);
    const copied = await electronApp.evaluate(({ clipboard }) => ({
      text: clipboard.readText(),
      html: clipboard.readHTML(),
    }));
    expect(copied.text).toBe('Source one\t"Target one\ncontinued"\nSource three\tTarget three');
    expect(copied.html).toContain('Target one<br>continued');

    // The same bilingual copy pastes only its Target column, in display order.
    await page.getByRole('button', { name: 'Clear selected targets', exact: true }).click();
    await expect.poll(async () => (await storedSegments(page, fileId))[0].targetTokens).toEqual([]);
    await numbers.nth(0).focus();
    await page.keyboard.press(`${modifier}+v`);
    await expect
      .poll(async () =>
        (await storedSegments(page, fileId))[0].targetTokens.map((t) => t.content).join(''),
      )
      .toBe('Target one\ncontinued');
    expect((await storedSegments(page, fileId))[1].targetTokens).toEqual([]);

    await numbers.nth(0).click();
    await numbers.nth(2).click({ modifiers: ['Shift'] });
    await electronApp.evaluate(({ clipboard }) =>
      clipboard.write({
        text: '"New one\ncontinued"\n\nNew three',
        html: '<table><tr><td>New one<br>continued</td></tr><tr><td></td></tr><tr><td>New three</td></tr></table>',
      }),
    );
    await page.keyboard.press(`${modifier}+v`);
    await expect
      .poll(async () =>
        (await storedSegments(page, fileId)).map((s) =>
          s.targetTokens.map((t) => t.content).join(''),
        ),
      )
      .toEqual(['New one\ncontinued', '', 'New three']);
    expect((await storedSegments(page, fileId)).map((s) => s.status)).toEqual([
      'draft',
      'empty',
      'draft',
    ]);

    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('source\ttoo short'));
    await page.keyboard.press(`${modifier}+v`);
    await expect(page.getByText(/Row count does not match \(1 copied, 3 selected\)/)).toBeVisible();
    expect((await storedSegments(page, fileId))[2].targetTokens[0].content).toBe('New three');

    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('First\nSecond\nThird'));
    await page.keyboard.press(`${modifier}+v`);
    await expect(page.getByRole('dialog', { name: 'Paste text' })).toBeVisible();
    await page.getByRole('button', { name: 'Paste as 3 segments' }).click();
    await expect
      .poll(async () =>
        (await storedSegments(page, fileId)).map((s) =>
          s.targetTokens.map((t) => t.content).join(''),
        ),
      )
      .toEqual(['First', 'Second', 'Third']);

    // Keyboard focus can enter the target while the row multi-selection remains.
    const focusedTarget = page.locator('.cm-content');
    await focusedTarget.focus();
    await expect(page.locator('.editor-row[data-selected="true"]')).toHaveCount(3);
    await focusedTarget.press(`${modifier}+a`);
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('Keyboard\nediting'));
    await focusedTarget.press(`${modifier}+v`);
    await expect(page.getByRole('dialog', { name: 'Paste text' })).toHaveCount(0);
    await numbers.last().focus();
    await expect
      .poll(async () =>
        (await storedSegments(page, fileId))[2].targetTokens.map((t) => t.content).join(''),
      )
      .toBe('Keyboard\nediting');
    expect((await storedSegments(page, fileId))[0].targetTokens[0].content).toBe('First');

    // Inside a target editor, native copy/paste continues to operate on text.
    await page.locator('.editor-row').first().locator('.editor-target-cell').click();
    const target = page.locator('.cm-content');
    await target.press(`${modifier}+a`);
    await target.press(`${modifier}+c`);
    expect(await electronApp.evaluate(({ clipboard }) => clipboard.readText())).toBe('First');
    await electronApp.evaluate(({ clipboard }) => clipboard.writeText('Inside\none segment'));
    await target.press(`${modifier}+v`);
    await expect(target).toHaveText('Insideone segment');
    await expect(page.getByRole('dialog', { name: 'Paste text' })).toHaveCount(0);
    await numbers.nth(0).click();
    await expect
      .poll(async () =>
        (await storedSegments(page, fileId))[0].targetTokens.map((t) => t.content).join(''),
      )
      .toBe('Inside\none segment');
  } finally {
    await closeEditorSmokeSession(session);
  }
});
