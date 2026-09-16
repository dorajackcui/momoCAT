import { expect, test } from '@playwright/test';
import {
  closeEditorSmokeSession as closeSmokeSession,
  createEditorSmokeSession as createSmokeSession,
} from './support/editorSmokeSession';

test.describe('Shared UI controls smoke', () => {
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
      await expect(page.getByRole('tab', { name: 'Term Bases', exact: true })).toHaveAttribute(
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
