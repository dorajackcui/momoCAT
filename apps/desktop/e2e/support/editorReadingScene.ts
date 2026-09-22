import type { Segment } from '@cat/core/models';
import type { DesktopApi } from '../../src/shared/ipc';
import { IPC_CHANNELS } from '../../src/shared/ipcChannels';
import type { EditorSmokeSession } from './editorSmokeSession';

// Isolated IPC fixtures show every status, QA tone and reference badge in one reading scene.
export async function prepareEditorReadingScene(session: EditorSmokeSession): Promise<void> {
  const { page, electronApp, fileId } = session;
  await page.setViewportSize({ width: 1440, height: 960 });
  const [template] = await page.evaluate(
    async (id) => (window as unknown as { api: DesktopApi }).api.getSegments(id, 0, 10),
    fileId,
  );
  const scenes: [Segment['status'], string, string][] = [
    [
      'empty',
      'Outside the window, the city slowly woke to the morning light.',
      '',
    ],
    [
      'draft',
      'She opened the window and listened to the rain on the leaves.',
      '她推开窗，静静听着雨滴落在叶片上的声音。',
    ],
    [
      'draft',
      'Beside the window stood a table, a notebook and a cup of café au lait.',
      '窗边摆着一张桌子、一本笔记和一杯拿铁。',
    ],
    [
      'draft',
      'The light through the window softened the edges of every object.',
      '透过窗户的光，让每一件物品的轮廓都柔和起来。',
    ],
    [
      'confirmed',
      'Through the open window came the scent of fresh bread.',
      '新鲜面包的香气，从敞开的窗户飘进来。',
    ],
    [
      'draft',
      'Keep the window open for 15 minutes before starting work.',
      '开始工作前，请开窗通风 5 分钟。',
    ],
    ['draft', 'Please close the window before you leave.', '离开前，请关上窗户'],
  ];
  const segments = scenes.map(
    ([status, source, target], index): Segment => ({
      ...template,
      segmentId: `palette-scene-${index}`,
      orderIndex: index,
      status,
      sourceTokens: [{ type: 'text', content: source }],
      targetTokens: [{ type: 'text', content: target }],
      meta: { ...template.meta, rowRef: index + 1, context: `Reading sample · ${status}` },
      qaIssues:
        index === 5
          ? [{ ruleId: 'number', severity: 'error', message: 'Number mismatch: 15 → 5' }]
          : index === 6
            ? [{ ruleId: 'punctuation', severity: 'warning', message: 'Check final punctuation' }]
            : [],
    }),
  );
  await page.getByRole('button', { name: 'Back to Project' }).click();
  await electronApp.evaluate(
    ({ ipcMain }, { channels, segments }) => {
      ipcMain.removeHandler(channels.file.getSegments);
      ipcMain.handle(channels.file.getSegments, (_event, _fileId, offset, limit) =>
        segments.slice(offset, offset + limit),
      );
      const base = {
        projectId: 1,
        srcLang: 'en',
        tgtLang: 'zh',
        srcHash: '',
        matchKey: '',
        tagsSignature: '',
        sourceTokens: segments[2].sourceTokens,
        targetTokens: segments[2].targetTokens,
        createdAt: '2026-09-18T08:00:00Z',
        updatedAt: '2026-09-18T08:00:00Z',
        usageCount: 1,
        tmName: 'Reading memory',
        tmType: 'main',
      };
      const matches = [
        { ...base, id: 'exact', kind: 'tm', rank: 100, similarity: 100 },
        {
          ...base,
          id: 'fuzzy',
          kind: 'tm',
          rank: 85,
          similarity: 85,
          sourceTokens: [{ type: 'text', content: 'A notebook lay beside the window.' }],
          targetTokens: [{ type: 'text', content: '一本笔记静静躺在窗边。' }],
        },
        {
          ...base,
          id: 'concordance',
          kind: 'concordance',
          rank: 70,
          matchedSourceText: 'window',
          sourceCoverage: 0.5,
          entryCoverage: 0.5,
          sourceTokens: [{ type: 'text', content: 'the open window' }],
          targetTokens: [{ type: 'text', content: '敞开的窗户' }],
        },
      ];
      const terms = [
        {
          id: 'term',
          tbId: 'terms',
          srcTerm: 'window',
          tgtTerm: '窗户',
          srcNorm: 'window',
          tbName: 'Literary terms',
          priority: 1,
          positions: [{ start: 11, end: 17 }],
          createdAt: base.createdAt,
          updatedAt: base.updatedAt,
          usageCount: 1,
        },
      ];
      for (const channel of [channels.tm.getMatches, channels.tm.prefetch]) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => matches);
      }
      for (const channel of [channels.tb.getMatches, channels.tb.prefetch]) {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, () => terms);
      }
    },
    { channels: IPC_CHANNELS, segments },
  );
  await page.getByText('cm6-smoke-fixture.xlsx', { exact: true }).click();
}
