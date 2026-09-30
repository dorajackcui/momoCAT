import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { IPC_CHANNELS } from '../src/shared/ipcChannels';
import type { DesktopApi } from '../src/shared/ipc';
import { createEditorSmokeSession, closeEditorSmokeSession } from './support/editorSmokeSession';

test('editing and undoing during a real AI request preserves the last draft in UI and storage', async () => {
  let finishResponse: (() => void) | undefined;
  let delayTranslation = false;
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/v1/models') {
      response.end(JSON.stringify({ data: [{ id: 'gpt-smoke' }] }));
      return;
    }
    request.resume();
    request.on('end', () => {
      const respond = () =>
        response.end(JSON.stringify({ choices: [{ message: { content: 'Late AI output' } }] }));
      if (delayTranslation) finishResponse = respond;
      else respond();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  let session: Awaited<ReturnType<typeof createEditorSmokeSession>> | undefined;
  try {
    session = await createEditorSmokeSession([['First', 'Original', '']]);
    const { page, fileId } = session;
    await page.evaluate(
      async ({ baseUrl, fileId }) => {
        const api = (window as unknown as { api: DesktopApi }).api;
        await api.setProxySettings({ mode: 'off' });
        const tested = await api.testAIConnection({
          name: 'Local regression fixture',
          baseUrl,
          apiKey: 'fixture-key',
        });
        if (!tested.ok || !tested.connection) throw new Error('Local AI fixture did not connect');
        const provider = await api.addAIProvider({
          name: 'Local fixture',
          connectionId: tested.connection.id,
          model: 'gpt-smoke',
        });
        const file = await api.getFile(fileId);
        await api.updateProjectAISettings(file!.projectId, null, provider.id);
      },
      { baseUrl, fileId },
    );
    delayTranslation = true;
    await page.locator('.editor-target-cell').click();
    await page.getByRole('button', { name: 'AI refine this translation', exact: true }).click();
    await page.getByRole('button', { name: 'Retranslate', exact: true }).click();
    await expect.poll(() => typeof finishResponse).toBe('function');
    const target = page.locator('.cm-content');
    await target.click();
    await target.press('End');
    await page.keyboard.insertText(' edit');
    const savedTarget = () =>
      page.evaluate(async (id) => {
        const [row] = await (window as unknown as { api: DesktopApi }).api.getSegments(id, 0, 10);
        return row.targetTokens.map((token) => token.content).join('');
      }, fileId);
    await expect.poll(savedTarget).toBe('Original edit');
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await expect(target).toHaveText('Original');
    await expect.poll(savedTarget).toBe('Original');
    finishResponse!();
    await expect(
      page.getByRole('button', { name: 'AI refine this translation', exact: true }),
    ).toBeEnabled();
    await expect(target).toHaveText('Original');
    expect(await savedTarget()).toBe('Original');
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByRole('button', { name: 'cm6-smoke-fixture.xlsx', exact: true }).click();
    await expect(page.locator('.editor-target-cell')).toContainText('Original');
  } finally {
    if (session) await closeEditorSmokeSession(session);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('typing during confirmation keeps the draft, caret and save order without advancing', async () => {
  const session = await createEditorSmokeSession([
    ['First', 'Original', ''],
    ['Second', '', ''],
  ]);
  try {
    const { page, electronApp, fileId } = session;
    await electronApp.evaluate(({ ipcMain }, channel) => {
      const original = (ipcMain as any)._invokeHandlers.get(channel);
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, async (event, ...args) => {
        const result = await original(event, ...args);
        if (args[2] !== 'confirmed') return result;
        return new Promise((resolve) => {
          (globalThis as any).finishConfirm = () => resolve(result);
        });
      });
    }, IPC_CHANNELS.segment.update);
    await page.locator('.editor-row').first().locator('.editor-target-cell').click();
    await page.keyboard.press('Control+Enter');
    await expect
      .poll(() => electronApp.evaluate(() => typeof (globalThis as any).finishConfirm))
      .toBe('function');
    const target = page.locator('.cm-content');
    await target.fill('New draft');
    await target.press('End');
    await page.keyboard.insertText('!');
    await electronApp.evaluate(() => (globalThis as any).finishConfirm());
    await expect(target).toHaveText('New draft!');
    await page.keyboard.insertText('?');
    await expect(target).toHaveText('New draft!?');
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const [first, second] = await (window as unknown as { api: DesktopApi }).api.getSegments(
            id,
            0,
            10,
          );
          return [first.status, first.targetTokens.map((t) => t.content).join(''), second.status];
        }, fileId),
      )
      .toEqual(['draft', 'New draft!?', 'empty']);
    await page.getByRole('button', { name: 'Back to Project', exact: true }).click();
    await page.getByRole('button', { name: 'cm6-smoke-fixture.xlsx', exact: true }).click();
    await expect(page.locator('.editor-target-cell').first()).toContainText('New draft!?');
  } finally {
    await closeEditorSmokeSession(session);
  }
});

test('typing during AI translation survives its delayed response and broadcast echo', async () => {
  const session = await createEditorSmokeSession([
    ['First', '', ''],
    ['Second', '', ''],
  ]);
  try {
    const { page, electronApp, fileId } = session;
    await electronApp.evaluate(
      ({ ipcMain }, { channel, eventChannel, fileId }) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(
          channel,
          (event, segmentId, clientRequestId) =>
            new Promise((resolve) => {
              (globalThis as any).finishAI = () => {
                const result = {
                  fileId,
                  segmentId,
                  targetTokens: [{ type: 'text', content: 'Old AI result' }],
                  status: 'draft',
                  propagatedIds: [],
                  serverAppliedAt: new Date().toISOString(),
                };
                event.sender.send(eventChannel, { ...result, clientRequestId });
                resolve(result);
              };
            }),
        );
      },
      {
        channel: IPC_CHANNELS.ai.translateSegment,
        eventChannel: IPC_CHANNELS.events.segmentsUpdated,
        fileId,
      },
    );
    await page.locator('.editor-row').first().locator('.editor-target-cell').click();
    await page.getByRole('button', { name: 'AI translate this segment', exact: true }).click();
    await expect
      .poll(() => electronApp.evaluate(() => typeof (globalThis as any).finishAI))
      .toBe('function');
    const target = page.locator('.cm-content');
    await target.fill('My translation');
    await electronApp.evaluate(() => (globalThis as any).finishAI());
    await expect(
      page.getByRole('button', { name: 'AI refine this translation', exact: true }),
    ).toBeEnabled();
    await expect(target).toHaveText('My translation');
    await expect
      .poll(() =>
        page.evaluate(async (id) => {
          const [first] = await (window as unknown as { api: DesktopApi }).api.getSegments(
            id,
            0,
            10,
          );
          return first.targetTokens.map((t) => t.content).join('');
        }, fileId),
      )
      .toBe('My translation');
  } finally {
    await closeEditorSmokeSession(session);
  }
});
