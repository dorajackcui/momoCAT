import { expect, test } from '@playwright/test';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import {
  closeEditorSmokeSession as closeSmokeSession,
  createEditorSmokeSession as createSmokeSession,
} from './support/editorSmokeSession';

test.describe('Shared UI controls smoke', () => {
  test('uses one AI entry on compact rows and waits for saves before AI dispatch', async () => {
    const session = await createSmokeSession();
    try {
      const { page, fileId } = session;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      type AIProbe = {
        calls: { kind: string; instruction?: string; savedText?: string }[];
        savedText?: string;
        releaseSave?: () => void;
        failSave?: boolean;
      };
      await session.electronApp.evaluate(
        ({ ipcMain }, { channels, fileId }) => {
          const probe: AIProbe = { calls: [] };
          (globalThis as unknown as { aiProbe: AIProbe }).aiProbe = probe;
          for (const [kind, channel] of [
            ['translate', channels.ai.translateSegment],
            ['refine', channels.ai.refineSegment],
          ]) {
            ipcMain.removeHandler(channel);
            ipcMain.handle(channel, (_event, segmentId, instruction) => {
              probe.calls.push({ kind, instruction, savedText: probe.savedText });
              return {
                fileId,
                segmentId,
                status: 'translated',
                propagatedIds: [],
                targetTokens: [{ type: 'text', content: `${kind} result` }],
                serverAppliedAt: new Date().toISOString(),
              };
            });
          }
          ipcMain.removeHandler(channels.segment.update);
          ipcMain.handle(
            channels.segment.update,
            async (_event, segmentId, targetTokens, status) => {
              if (probe.failSave) throw new Error('Fixture save failed');
              await new Promise<void>((resolve) => {
                probe.releaseSave = resolve;
              });
              probe.savedText = targetTokens
                .map((token: { content: string }) => token.content)
                .join('');
              return { fileId, segmentId, targetTokens, status, propagatedIds: [] };
            },
          );
        },
        { channels: IPC_CHANNELS, fileId },
      );
      const calls = () =>
        session.electronApp.evaluate(
          () => (globalThis as unknown as { aiProbe: AIProbe }).aiProbe.calls,
        );

      const rows = page.locator('div.group.grid');
      await rows.first().click();
      const emptyAI = rows.first().getByRole('button', { name: 'AI translate this segment' });
      expect((await rows.first().boundingBox())!.height).toBe(64);
      await emptyAI.click();
      await expect(rows.first().locator('.cm-content')).toHaveText('translate result');
      await expect(page.getByRole('dialog', { name: 'Refine translation' })).toBeHidden();
      expect((await calls()).map((call) => call.kind)).toEqual(['translate']);

      const row = rows.nth(1);
      await row.click();
      const target = row.locator('.cm-content');
      const ai = row.getByRole('button', { name: 'AI refine this translation' });
      await target.press('Home');
      await target.press('ArrowRight');
      const height = (await row.boundingBox())!.height;
      await ai.click();
      const popup = page.getByRole('dialog', { name: 'Refine translation' });
      const prompt = popup.getByRole('textbox', { name: 'AI refine instruction' });
      await expect(prompt).toBeFocused();
      expect((await row.boundingBox())!.height).toBe(height);
      await prompt.fill('Discard this');
      await prompt.press('Escape');
      await expect(popup).toBeHidden();
      await expect(target).toBeFocused();
      await page.keyboard.insertText('X');
      await expect(target).toHaveText('NXeedle target');
      await ai.click();
      await expect(prompt).toHaveValue('');
      const search = page.getByPlaceholder('Filter source text');
      await search.click();
      await expect(popup).toBeHidden();
      await expect(search).toBeFocused();
      await ai.click();
      await prompt.fill('  Make it concise  ');
      await prompt.press('Enter');
      await expect(popup).toBeHidden();
      await expect(ai).toBeDisabled();
      expect((await calls()).map((call) => call.kind)).toEqual(['translate']);
      await session.electronApp.evaluate(() => {
        (globalThis as unknown as { aiProbe: AIProbe }).aiProbe.releaseSave!();
      });
      await expect(target).toHaveText('refine result');
      expect((await calls())[1]).toEqual({
        kind: 'refine',
        instruction: 'Make it concise',
        savedText: 'NXeedle target',
      });
      await ai.click();
      await popup.getByRole('button', { name: 'Retranslate' }).click();
      await expect(target).toHaveText('translate result');
      expect((await calls()).map((call) => call.kind)).toEqual([
        'translate',
        'refine',
        'translate',
      ]);

      await session.electronApp.evaluate(() => {
        (globalThis as unknown as { aiProbe: AIProbe }).aiProbe.failSave = true;
      });
      await target.fill('Keep this unsaved draft');
      await ai.click();
      await prompt.fill('Shorter');
      await prompt.press('Enter');
      await expect(row.getByText(/AI 微调失败/)).toBeVisible();
      await expect(target).toHaveText('Keep this unsaved draft');
      await ai.click();
      await popup.getByRole('button', { name: 'Retranslate' }).click();
      await expect(row.getByText(/AI 翻译失败/)).toBeVisible();
      await expect(target).toHaveText('Keep this unsaved draft');
      expect(await calls()).toHaveLength(3);
      expect(errors).toEqual([]);
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('preserves CAT search, editor focus and drafts across popups and dialogs', async () => {
    const session = await createSmokeSession();
    try {
      const { page, fileId } = session;
      const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
      await session.electronApp.evaluate(({ ipcMain }, channel) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, (_event, _projectId, query) => {
          (globalThis as unknown as { concordanceQuery: string }).concordanceQuery = query;
          return [];
        });
      }, IPC_CHANNELS.tm.concordance);
      const row = page.locator('div.group.grid').nth(1);
      await row.click();
      const target = row.locator('.cm-content');
      await target.fill('Draft before controls');
      await page.keyboard.press(`${modifier}+a`);
      await page.keyboard.press(`${modifier}+k`);
      const search = page.getByPlaceholder('Search TM...');
      await expect(search).toBeFocused();
      await expect(search).toHaveValue('Draft before controls');
      await expect(page.getByRole('tab', { name: 'Concordance', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await search.fill('Explicit concordance query');
      await search.press('Enter');
      await expect
        .poll(() =>
          session.electronApp.evaluate(
            () => (globalThis as unknown as { concordanceQuery: string }).concordanceQuery,
          ),
        )
        .toBe('Explicit concordance query');
      await page.getByRole('tab', { name: 'CAT', exact: true }).click();
      await expect(search).toHaveCount(0);
      await expect(target).toHaveText('Draft before controls');

      const filtersButton = page.getByRole('button', { name: 'Open filters' });
      await filtersButton.click();
      const filters = page.getByRole('dialog', { name: 'Filters' });
      const sourceSearch = page.getByPlaceholder('Filter source text');
      await sourceSearch.click();
      await expect(filters).toBeHidden();
      await expect(sourceSearch).toBeFocused();
      await filtersButton.click();
      await page.getByRole('button', { name: 'Sort options' }).click();
      await expect(filters).toBeHidden();
      const sort = page.getByRole('menu', { name: 'Sort', exact: true });
      await expect(sort).toBeVisible();
      await target.click();
      await expect(sort).toBeHidden();
      await expect(target).toBeFocused();

      const translate = page.getByRole('button', { name: 'AI batch translate' });
      await translate.click();
      const modal = page.getByRole('dialog', { name: 'AI Translate Options' });
      await expect(modal).toBeVisible();
      for (let index = 0; index < 7; index++) {
        await page.keyboard.press('Tab');
        expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await page.keyboard.press('Escape');
      await expect(modal).toBeHidden();
      await expect(translate).toBeFocused();
      await expect(target).toHaveText('Draft before controls');
      await target.focus();
      await page.keyboard.press('Control+End');
      await page.keyboard.insertText(' after controls');
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      expect(
        await page.evaluate(async (id) => {
          const segments = await (window as unknown as { api: any }).api.getSegments(id, 0, 1000);
          return segments[1].targetTokens
            .map((token: { content?: string }) => token.content ?? '')
            .join('');
        }, fileId),
      ).toBe('Draft before controls after controls');
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('uses shared choices and action controls through commit and resource workflows', async () => {
    const session = await createSmokeSession();
    try {
      const { page } = session;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      await page.getByRole('button', { name: 'Commit', exact: true }).click();
      const commit = page.getByRole('dialog', { name: 'Commit File To TM' });
      const confirmed = commit.getByRole('radio', { name: 'Confirmed only', exact: true });
      await confirmed.focus();
      await page.keyboard.press('ArrowRight');
      await expect(commit.getByRole('radio', { name: 'All with translations' })).toBeChecked();
      await expect(confirmed).not.toBeChecked();
      await commit.getByRole('button', { name: 'Cancel', exact: true }).click();

      for (const resource of [
        {
          kind: 'TM',
          nav: 'Translation memory',
          create: 'Create Main TM',
          standard: 'Standard TM',
          placeholder: 'e.g. Technical Glossary',
          save: 'Save TM',
          assetLabel: 'TM',
          remove: 'Delete TM',
        },
        {
          kind: 'TB',
          nav: 'Term bases',
          create: 'Create Term Base',
          standard: 'Standard TB',
          placeholder: 'e.g. Product Glossary',
          save: 'Save',
          assetLabel: 'term base',
          remove: 'Delete term base',
        },
      ]) {
        await page.getByRole('button', { name: resource.nav, exact: true }).click();
        await page.getByRole('button', { name: resource.create, exact: true }).click();
        const choices = page.getByRole('group', { name: `${resource.kind} creation type` });
        const standard = choices.getByRole('radio', { name: resource.standard, exact: true });
        await standard.focus();
        await page.keyboard.press('ArrowRight');
        await expect(
          choices.getByRole('radio', { name: 'Sync with Excel', exact: true }),
        ).toBeChecked();
        await page.keyboard.press('ArrowLeft');
        await expect(standard).toBeChecked();
        const choiceColors = await choices
          .locator('.ui-choice-content')
          .evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
        expect(choiceColors[0]).not.toEqual(choiceColors[1]);
        const name = `UI ${resource.kind} ${Date.now()}`;
        await page.getByPlaceholder(resource.placeholder).fill(name);
        await page.getByRole('button', { name: resource.save, exact: true }).click();
        const card = page.locator('.workspace-resource-card').filter({
          has: page.getByRole('button', { name: new RegExp(`^Preview ${name}`) }),
        });
        await expect(card).toBeVisible();
        await card.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
        const renamed = `${name} renamed`;
        await card.getByRole('textbox', { name: `Rename ${resource.assetLabel}` }).fill(renamed);
        await card.getByRole('button', { name: `Save ${resource.assetLabel} name` }).click();
        await expect(card.getByRole('textbox')).toHaveCount(0);
        await card.getByRole('button', { name: `Preview ${renamed}`, exact: true }).click();
        await expect(page.getByRole('heading', { name: renamed, exact: true })).toBeVisible();
        await page.getByRole('button', { name: `← ${resource.nav}`, exact: true }).click();
        await card.getByRole('button', { name: resource.remove, exact: true }).click();
        const confirmation = page.getByRole('dialog', { name: 'Confirm Action' });
        await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(card).toBeVisible();
      }
      expect(errors).toEqual([]);
    } finally {
      await closeSmokeSession(session);
    }
  });

  test('shares popup, tab and form behavior across CAT and workspace pages', async () => {
    const session = await createSmokeSession();
    try {
      const { page } = session;
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const filtersButton = page.getByRole('button', { name: 'Open filters' });
      await filtersButton.click();
      const filters = page.getByRole('dialog', { name: 'Filters' });
      await filters.getByRole('button', { name: 'QA error', exact: true }).click();
      await expect(filters.getByRole('button', { name: 'QA error', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await page.keyboard.press('Escape');
      await expect(filters).toBeHidden();
      await expect(filtersButton).toBeFocused();
      await page.getByRole('button', { name: 'Clear filter', exact: true }).click();
      await page.getByRole('button', { name: 'Sort options' }).click();
      const sort = page.getByRole('menu', { name: 'Sort', exact: true });
      await expect(sort.getByRole('menuitem', { name: 'Default order' })).toBeFocused();
      await page.keyboard.press('End');
      await expect(
        sort.getByRole('menuitem', { name: 'Target length: long to short' }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
      const taskTab = page.getByRole('tab', { name: 'Tasks', exact: true });
      await taskTab.focus();
      await page.keyboard.press('End');
      await expect(page.getByRole('tab', { name: 'Settings', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.keyboard.press('Home');
      await expect(taskTab).toHaveAttribute('aria-selected', 'true');
      await page.getByRole('button', { name: '+ Add File', exact: true }).click();
      await expect(page.getByRole('menuitem', { name: 'Import', exact: true })).toBeFocused();
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'New project', exact: true }).click();
      const create = page.getByRole('dialog', { name: 'Create New Project' });
      const name = `UI controls ${Date.now()}`;
      await expect(create.getByRole('textbox')).toBeFocused();
      await create.getByRole('textbox').fill(name);
      await create.getByRole('button', { name: 'Review', exact: true }).click();
      await expect(create.getByRole('button', { name: 'Review', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await create.getByRole('button', { name: 'Create Project', exact: true }).click();
      await expect(create).toBeHidden();
      const newProject = page.getByRole('button', { name, exact: true });
      await expect(newProject).toBeVisible();
      await page.getByRole('button', { name: `Actions for ${name}`, exact: true }).click();
      await page.getByRole('menuitem', { name: 'Delete project…', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: 'Delete Project', exact: true });
      const deleteButton = confirm.getByRole('button', { name: 'Delete Project', exact: true });
      await expect(deleteButton).toBeDisabled();
      await expect(confirm.getByRole('textbox')).toBeFocused();
      await confirm.getByRole('textbox').fill(name);
      await deleteButton.click();
      await expect(confirm).toBeHidden();
      await expect(newProject).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await closeSmokeSession(session);
    }
  });
});
