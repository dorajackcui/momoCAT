import { expect, test } from '@playwright/test';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';

test('QA selection highlights only the relevant fragments and stays consistent during editing', async () => {
  const session = await createEditorSmokeSession(
    [
      ['[访问令牌] 即将过期。', 'The [Access token] expires soon.', '术语参考'],
      ['请在周五前刷新访问令牌。', 'Renew the credential before Friday.', '缺少推荐译法'],
      ['妥善保管访问令牌。', 'Keep the credential secure.', '缺少推荐译法'],
      ['队列中有 12 个项目。', 'There are 13 items in the queue.', '数字发生变化'],
      [
        '访问 https://docs.example.test/start。',
        'Visit https://docs.example.test/guide.',
        'URL 发生变化',
      ],
      ['你好 {name} | {count}', 'Hello {name} {count} {extra}', '缺少竖线、多出占位符'],
      ['请仔细阅读 <b>此内容</b>。', 'Read <b>this carefully.', '缺少闭合标记'],
      ['阅读更新说明。', 'Read the notes，， then check AＡ.', '重复标点和全半角混用'],
      ['打开（设置）对话框。', 'Open the (settings] dialog.', '括号配对错误'],
      ['保存后继续。', 'Please 保存 before continuing.', '译文含中文'],
    ],
    {
      tagPolicy: 'none',
      srcLang: 'zh',
      tgtLang: 'en',
      qaSettings: {
        enabledRuleIds: [
          'terminology-consistency',
          'tag-integrity',
          'number',
          'url',
          'chinese',
          'target-text',
        ],
        disabledCheckIds: [],
      },
    },
  );
  try {
    const { page } = session;
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    const category = (label: string) => page.getByRole('region', { name: label, exact: true });
    const choose = async (label: string) => {
      for (const name of [
        'Terminology',
        'Numbers',
        'URLs',
        'Tag / Placeholder',
        'Target text',
        'Chinese in target',
      ]) {
        const button = category(name).getByRole('button', {
          name: (name === label ? 'Expand ' : 'Collapse ') + name,
          exact: true,
        });
        if (await button.count()) await button.click();
      }
      await category(label)
        .getByRole('button', {
          name: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ·'),
        })
        .click();
    };
    const shot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({
        path: test.info().outputPath('qa-highlight-' + name + '.png'),
        animations: 'disabled',
      });
    };
    await expect(category('Terminology')).toBeVisible();
    await page.getByRole('button', { name: 'Run QA', exact: true }).click();
    await expect(page.getByText('Saved results · Recheck needed', { exact: true })).toHaveCount(0);
    await choose('Terminology');
    await expect(page.locator('.editor-source-text mark')).toHaveText(['访问令牌', '访问令牌']);
    await expect(page.locator('.editor-row .cm-target-highlight')).toHaveCount(0);
    await shot('terms');

    await choose('Numbers');
    await expect(page.locator('.editor-source-text mark')).toHaveText(['12']);
    await expect(page.locator('.editor-row .cm-target-highlight')).toHaveText(['13']);
    await page.locator('.editor-source-text').click();
    await expect(page.locator('.cm-content .cm-target-highlight')).toHaveText('13');
    await shot('numbers');

    await choose('URLs');
    await expect(page.locator('.editor-source-text mark')).toHaveText([
      'https://docs.example.test/start',
    ]);
    await expect(page.locator('.editor-row .cm-target-highlight')).toHaveText([
      'https://docs.example.test/guide',
    ]);
    await shot('urls');

    await choose('Tag / Placeholder');
    await expect(page.locator('.editor-source-text mark').filter({ hasText: '|' })).toHaveCount(1);
    await expect(
      page.locator('.editor-row .cm-target-highlight').filter({ hasText: '{extra}' }),
    ).toHaveCount(1);
    await shot('tags');

    await choose('Target text');
    await expect(page.locator('.editor-source-text mark')).toHaveCount(0);
    await expect(page.locator('.editor-row .cm-target-highlight')).toHaveText([
      '，，',
      'Ａ',
      '(',
      ']',
    ]);
    await shot('target-text');

    await choose('Chinese in target');
    await expect(page.locator('.editor-source-text mark')).toHaveCount(0);
    await expect(
      page.locator('.editor-row .cm-target-highlight').filter({ hasText: '保存' }),
    ).toHaveCount(1);
    await shot('chinese');
    await choose('Numbers');
    await page.locator('.editor-source-text').click();
    await page.locator('.cm-content').fill('There are 12 items in the queue.');
    await expect(page.locator('.cm-content .cm-target-highlight')).toHaveCount(0);
    await expect(page.getByText('Changed · Recheck needed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Exit QA filter', exact: true }).click();
    await expect(page.locator('.editor-row mark, .editor-row .cm-target-highlight')).toHaveCount(0);
    await page.getByRole('button', { name: 'Run batch QA', exact: true }).click();
    await expect(category('Numbers')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await closeEditorSmokeSession(session);
  }
});
