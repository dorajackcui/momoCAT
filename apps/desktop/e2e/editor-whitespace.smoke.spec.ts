import { expect, test, type Locator } from '@playwright/test';
import type { DesktopApi } from '../src/shared/ipc';
import { closeEditorSmokeSession, createEditorSmokeSession } from './support/editorSmokeSession';

const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const redoShortcut = process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+y';

async function textWidth(locator: Locator) {
  return locator.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('.cm-line') ?? element);
    return range.getBoundingClientRect().width;
  });
}

test('inserts and pastes nonbreaking spaces, displays hollow circles and preserves saved text', async () => {
  const session = await createEditorSmokeSession(
    [
      ['sa fin\u00A0!', 'sa fin!', 'NBSP (U+00A0)'],
      ['Prix\u202F: 20\u00A0€', 'Prix: 20 €', 'NNBSP (U+202F) + NBSP'],
    ],
    { srcLang: 'fr', tgtLang: 'fr' },
  );
  try {
    const { page, fileId } = session;
    const rows = page.locator('div.group.grid');
    const first = rows.first();
    const second = rows.nth(1);
    const firstTarget = first.locator('.cm-content');
    await firstTarget.focus();
    await page.keyboard.press('End');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(`${modifier}+Shift+Space`);
    // textContent reads the actual document rather than CSS display markers.
    expect(await firstTarget.textContent()).toBe('sa fin\u00A0!');
    await page.keyboard.press(`${modifier}+z`);
    expect(await firstTarget.textContent()).toBe('sa fin!');
    await page.keyboard.press(redoShortcut);
    expect(await firstTarget.textContent()).toBe('sa fin\u00A0!');
    await page.keyboard.insertText('X');
    expect(await firstTarget.textContent()).toBe('sa fin\u00A0X!');
    await page.keyboard.press(`${modifier}+z`);
    expect(await firstTarget.textContent()).toBe('sa fin\u00A0!');

    const toggle = page.getByRole('button', { name: 'Toggle non-printing symbols' });
    const sourceWidth = await textWidth(first.locator('.editor-source-text'));
    const editingWidth = await textWidth(firstTarget);
    await toggle.click();
    expect(await textWidth(first.locator('.editor-source-text'))).toBeCloseTo(sourceWidth, 1);
    expect(await textWidth(firstTarget)).toBeCloseTo(editingWidth, 1);
    expect(await first.locator('.editor-source-text').textContent()).toBe('sa fin\u00A0!');
    const marker = firstTarget.locator('.cm-np-nbsp');
    expect(await marker.textContent()).toBe('\u00A0');
    expect(
      await marker.evaluate((element) => {
        const style = getComputedStyle(element, '::before');
        return { borderRadius: style.borderRadius, borderStyle: style.borderStyle };
      }),
    ).toEqual({ borderRadius: '50%', borderStyle: 'solid' });

    await second.locator('.editor-source-text').click();
    expect(await first.locator('.editor-target-preview').textContent()).toBe('sa fin\u00A0!');
    const pastedText = 'Prix\u202F: 20\u00A0€';
    const secondTarget = second.locator('.cm-content');
    await secondTarget.focus();
    await page.keyboard.press(`${modifier}+a`);
    await secondTarget.evaluate((element, text) => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    }, pastedText);
    expect(await secondTarget.textContent()).toBe(pastedText);
    expect(await secondTarget.locator('.cm-np-nnbsp').textContent()).toBe('\u202F');
    expect(await secondTarget.locator('.cm-np-nbsp').textContent()).toBe('\u00A0');
    await toggle.click();
    expect(await first.locator('.editor-target-preview').textContent()).toBe('sa fin\u00A0!');
    expect(await secondTarget.textContent()).toBe(pastedText);
    const previewWidth = await textWidth(first.locator('.editor-target-preview'));
    await toggle.click();
    expect(await textWidth(first.locator('.editor-target-preview'))).toBeCloseTo(previewWidth, 1);
    expect(await textWidth(first.locator('.editor-target-preview'))).toBeCloseTo(editingWidth, 1);

    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    const saved = await page.evaluate(async (id) => {
      const segments = await (window as unknown as { api: DesktopApi }).api.getSegments(id, 0, 10);
      return segments.map((segment) => segment.targetTokens.map((token) => token.content).join(''));
    }, fileId);
    expect(saved).toEqual(['sa fin\u00A0!', pastedText]);
    await page.getByRole('button', { name: 'cm6-smoke-fixture.xlsx', exact: true }).click();
    await expect(secondTarget).toBeVisible();
    expect(await secondTarget.textContent()).toBe(pastedText);
    expect(await first.locator('.editor-target-preview').textContent()).toBe('sa fin\u00A0!');
    await toggle.click();
    expect(await first.locator('.editor-target-preview').textContent()).toBe('sa fin\u00A0!');
    expect(await second.locator('.editor-source-text').textContent()).toBe(pastedText);
    await first.locator('.editor-source-text').click();
    expect(await firstTarget.locator('.cm-np-nbsp').textContent()).toBe('\u00A0');
    expect(await second.locator('.editor-target-preview').textContent()).toBe(pastedText);
    expect(await textWidth(firstTarget)).toBeCloseTo(editingWidth, 1);
    await page.getByRole('button', { name: 'Editor appearance', exact: true }).click();
    await page
      .getByRole('group', { name: 'Color scheme' })
      .getByText('Nord', { exact: true })
      .click();
    await page.keyboard.press('Escape');
    await expect(page.locator('html')).toHaveAttribute('data-color-theme', 'nord');
    await expect(page.getByText('Searching...', { exact: true })).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('nbsp-editor.png') });
    await first.screenshot({ path: test.info().outputPath('nbsp-active.png') });
    await second.locator('.editor-source-text').click();
    await first.screenshot({ path: test.info().outputPath('nbsp-preview.png') });
  } finally {
    await closeEditorSmokeSession(session);
  }
});

async function markerPaint(marker: Locator) {
  return marker.evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    const match = element.closest('.editor-search-highlight, .cm-target-highlight');
    if (!match) throw new Error('Expected the whitespace inside a search highlight');
    return {
      color: style.color,
      highlightColor: getComputedStyle(match).color,
      opacity: Number(style.opacity),
      width: style.width,
      height: style.height,
      top: style.top,
    };
  });
}

async function markerCenterY(marker: Locator) {
  return marker.evaluate((element) => {
    const style = getComputedStyle(element, '::before');
    const translateY = new DOMMatrixReadOnly(style.transform).m42;
    return (
      element.getBoundingClientRect().top +
      Number.parseFloat(style.top) +
      Number.parseFloat(style.height) / 2 +
      translateY
    );
  });
}

test('keeps nonprinting marks visible inside source and target Filter highlights', async () => {
  const text = 'sa fin\u00A0!';
  const session = await createEditorSmokeSession(
    [
      [text, text, 'NBSP active'],
      [text, text, 'NBSP preview'],
      ['sa fin\u202F!', 'sa fin\u202F!', 'NNBSP'],
      ['sa\tfin\u00A0!', 'sa\tfin\u00A0!', 'Tab'],
      ['sa\nfin\u00A0!', 'sa\nfin\u00A0!', 'Line break'],
      ['Other text', 'Other target', 'Filtered out'],
    ],
    { srcLang: 'fr', tgtLang: 'fr' },
  );
  try {
    const { page } = session;
    await page.getByRole('button', { name: 'Toggle non-printing symbols' }).click();
    await page.getByRole('button', { name: /^Search match mode:/ }).click();
    await page
      .getByRole('menu', { name: 'Search match mode', exact: true })
      .getByRole('menuitem', { name: 'Regex', exact: true })
      .click();
    await page.getByPlaceholder('Filter source text').fill('sa\\sfin\\s!');
    await page.getByPlaceholder('Filter target text').fill('sa\\sfin\\s!');
    const rows = page.locator('div.group.grid');
    await expect(rows).toHaveCount(5);
    const first = rows.first();
    const second = rows.nth(1);
    await expect(first.locator('.cm-content')).toBeVisible();
    for (const theme of ['Classic', 'Nord']) {
      await page.getByRole('button', { name: 'Editor appearance', exact: true }).click();
      await page
        .getByRole('group', { name: 'Color scheme' })
        .getByText(theme, { exact: true })
        .click();
      await page.keyboard.press('Escape');
      for (const surface of [
        first.locator('.editor-source-text'),
        first.locator('.cm-content'),
        second.locator('.editor-target-preview'),
        rows.nth(2).locator('.editor-target-preview'),
        rows.nth(3).locator('.editor-target-preview'),
        rows.nth(4).locator('.editor-target-preview'),
      ]) {
        const marks = surface.locator(
          '.cm-np-space, .cm-np-tab, .cm-np-nbsp, .cm-np-nnbsp, .cm-np-newline',
        );
        await expect(marks).toHaveCount(2);
        for (const marker of await marks.all()) {
          const paint = await markerPaint(marker);
          expect(paint.color).toBe(paint.highlightColor);
          expect(paint.opacity).toBe(1);
        }
      }
      for (const surface of [
        first.locator('.editor-source-text'),
        first.locator('.cm-content'),
        second.locator('.editor-target-preview'),
      ]) {
        // Allow subpixel border rounding while keeping both centers on the same pixel.
        const circleY = await markerCenterY(surface.locator('.cm-np-nbsp'));
        const dotY = await markerCenterY(surface.locator('.cm-np-space'));
        expect(Math.abs(circleY - dotY)).toBeLessThan(0.5);
      }
      const editingPaint = await markerPaint(first.locator('.cm-content .cm-np-nbsp'));
      expect(await markerPaint(second.locator('.editor-target-preview .cm-np-nbsp'))).toEqual(
        editingPaint,
      );
      await page.screenshot({
        path: test.info().outputPath('filter-' + theme.toLowerCase() + '.png'),
      });
    }
    await first.screenshot({ path: test.info().outputPath('filter-active.png') });
    await second.locator('.editor-source-text').click();
    expect(await markerPaint(first.locator('.editor-target-preview .cm-np-nbsp'))).toEqual(
      await markerPaint(second.locator('.cm-content .cm-np-nbsp')),
    );
    await first.screenshot({ path: test.info().outputPath('filter-preview.png') });
    for (const rowIndex of [2, 3, 4]) {
      const row = rows.nth(rowIndex);
      await row.locator('.editor-source-text').click();
      const markers = row.locator(
        '.cm-content .cm-np-space, .cm-content .cm-np-tab, .cm-content .cm-np-nbsp, .cm-content .cm-np-nnbsp, .cm-content .cm-np-newline',
      );
      await expect(markers).toHaveCount(2);
      for (const marker of await markers.all()) {
        const paint = await markerPaint(marker);
        expect(paint.color).toBe(paint.highlightColor);
        expect(paint.opacity).toBe(1);
      }
    }
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('preserves multiline selections and wrapping when nonprinting marks are toggled', async () => {
  const text = 'sa fin\u00A0!\t\n\nDernière\u202F: °·⇥↵\n';
  const session = await createEditorSmokeSession(
    [
      [text, text, 'Multiline'],
      ['Other source', 'Other target', 'Activate elsewhere'],
    ],
    { srcLang: 'fr', tgtLang: 'fr' },
  );
  try {
    const { page } = session;
    const first = page.locator('div.group.grid').first();
    const second = page.locator('div.group.grid').nth(1);
    const toggle = page.getByRole('button', { name: 'Toggle non-printing symbols' });
    await second.locator('.editor-source-text').click();
    const source = first.locator('.editor-source-text');
    const preview = first.locator('.editor-target-preview');
    const sourceHeight = await source.evaluate((element) => element.getBoundingClientRect().height);
    const previewHeight = await preview.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await toggle.click();
    for (const surface of [source, preview]) {
      expect(await surface.textContent()).toBe(text);
      await expect(surface.locator('.cm-np-newline')).toHaveCount(3);
      expect(
        await surface.evaluate((element) => {
          (document.activeElement as HTMLElement | null)?.blur();
          const range = document.createRange();
          range.selectNodeContents(element);
          const selection = window.getSelection()!;
          selection.removeAllRanges();
          selection.addRange(range);
          return range.toString();
        }),
      ).toBe(text);
      await page.keyboard.press(modifier + '+c');
      const copied = await session.electronApp.evaluate(({ clipboard }) => clipboard.readText());
      expect(copied.replace(/\r\n/g, '\n')).toBe(text);
    }
    expect(await source.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      sourceHeight,
    );
    expect(await preview.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      previewHeight,
    );
    // Reproduce selecting a phrase in the preview before activation mounts CodeMirror.
    await preview.evaluate((element) => {
      const marker = element.querySelector('.cm-np-nnbsp')!;
      const range = document.createRange();
      range.setStart(marker.previousSibling!, 0);
      range.setEnd(marker.nextSibling!, 1);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    const editing = first.locator('.cm-content');
    await expect(editing).toBeVisible();
    await page.keyboard.insertText('REMPLACÉ');
    expect(await editing.locator('.cm-line').allTextContents()).toEqual([
      'sa fin\u00A0!\t',
      '',
      'REMPLACÉ °·⇥↵',
      '',
    ]);
    await page.keyboard.press(modifier + '+z');
    expect((await editing.locator('.cm-line').allTextContents()).join('\n')).toBe(text);
    const editingHeight = await editing.evaluate(
      (element) => element.getBoundingClientRect().height,
    );
    await toggle.click();
    expect((await editing.locator('.cm-line').allTextContents()).join('\n')).toBe(text);
    expect(await editing.evaluate((element) => element.getBoundingClientRect().height)).toBe(
      editingHeight,
    );
    await toggle.click();
    await page.screenshot({ path: test.info().outputPath('multiline-symbols.png') });
  } finally {
    await closeEditorSmokeSession(session);
  }
});
