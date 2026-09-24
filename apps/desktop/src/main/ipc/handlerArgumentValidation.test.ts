import { describe, expect, it, vi } from 'vitest';
import type { Segment } from '@cat/core/models';
import { IPC_CHANNELS } from '../../shared/ipcChannels';
import { registerProjectHandlers } from './projectHandlers';
import { registerTBHandlers } from './tbHandlers';
import { registerTMHandlers } from './tmHandlers';
import { registerAIHandlers } from './aiHandlers';
import { registerDialogHandlers } from './dialogHandlers';
import { registerJobHandlers } from './jobHandlers';
import type { IpcMainListener } from './types';

const { project, file, segment, tm, tb, ai, dialog, job } = IPC_CHANNELS;
const importOptions = { sourceCol: 0, targetCol: 1, hasHeader: false };
const referenceImportOptions = { ...importOptions, overwrite: false };
const syncConfig = { filePath: 'source.xlsx', columns: importOptions };
const sampleSegment: Segment = {
  segmentId: 'seg-1',
  fileId: 1,
  orderIndex: 0,
  sourceTokens: [{ type: 'text', content: 'Source' }],
  targetTokens: [],
  status: 'empty',
  tagsSignature: '',
  matchKey: 'Source',
  srcHash: 'hash',
  meta: { updatedAt: '2026-01-01T00:00:00.000Z', context: 'Context' },
};

function setup() {
  const handlers = new Map<string, IpcMainListener>();
  const downstreamCall = vi.fn(() => {
    throw new Error('Unexpected downstream call');
  });
  const dependency = new Proxy({}, { get: () => downstreamCall });
  const deps = {
    ipcMain: {
      handle: (channel: string, handler: IpcMainListener) => handlers.set(channel, handler),
    },
    projectService: dependency,
    jobManager: dependency,
    referenceLookup: dependency,
    referenceLookupPrefetch: dependency,
    notifyReferenceDataChanged: downstreamCall,
    dialog: dependency,
  };
  registerProjectHandlers(deps as never);
  registerTMHandlers(deps as never);
  registerTBHandlers(deps as never);
  registerAIHandlers(deps as never);
  registerDialogHandlers(deps as never);
  registerJobHandlers(deps as never);
  return {
    downstreamCall,
    invoke: (channel: string, args: unknown[]) =>
      Promise.resolve().then(() => handlers.get(channel)!({}, ...args)),
  };
}

const requests: Array<{ channel: string; args: unknown[] }> = [
  { channel: project.create, args: ['Project', 'en', 'zh', 'translation'] },
  { channel: project.get, args: [1] },
  { channel: project.updatePrompt, args: [1, null] },
  { channel: project.updateAISettings, args: [1, null, null] },
  {
    channel: project.updateQASettings,
    args: [1, { enabledRuleIds: ['tag-integrity'], instantQaOnConfirm: true }],
  },
  { channel: project.listSavedPrompts, args: [1] },
  { channel: project.createSavedPrompt, args: [1, 'Prompt', 'Content'] },
  { channel: project.updateSavedPrompt, args: [1, 2, 'Prompt', 'Content'] },
  { channel: project.deleteSavedPrompt, args: [1, 2] },
  { channel: project.remove, args: [1] },
  { channel: project.getFiles, args: [1] },
  { channel: file.get, args: [1] },
  { channel: file.rename, args: [1, 'Renamed.xlsx'] },
  { channel: file.remove, args: [1] },
  { channel: project.addFile, args: [1, 'source.xlsx', importOptions] },
  { channel: project.createPastedSourceFile, args: [1, { sources: ['Source'] }] },
  { channel: file.getSegments, args: [1, 0, 100] },
  { channel: file.getPreview, args: ['source.xlsx'] },
  { channel: segment.update, args: ['seg-1', [], 'empty', 'request-1'] },
  { channel: file.export, args: [1, 'output.xlsx', importOptions] },
  { channel: file.runQA, args: [1] },
  { channel: segment.checkQA, args: ['seg-1'] },
  { channel: file.inspect, args: [1, 'output.xlsx'] },
  { channel: file.exportReferences, args: [1, 'output.xlsx'] },
  { channel: file.precheckSourceTerminology, args: [1, 'output.xlsx'] },
  { channel: file.cancelSourceTerminologyPrecheck, args: [1] },
  { channel: tm.getMatches, args: [1, sampleSegment] },
  { channel: tm.prefetch, args: [1, sampleSegment] },
  { channel: tm.concordance, args: [1, 'query'] },
  { channel: tm.list, args: ['main'] },
  { channel: tm.listOptions, args: ['main'] },
  { channel: tm.preview, args: ['tm-1'] },
  { channel: tm.create, args: ['Memory', 'en', 'zh', 'main'] },
  { channel: tm.remove, args: ['tm-1'] },
  { channel: tm.rename, args: ['tm-1', 'Renamed'] },
  { channel: tm.getMountedByProject, args: [1] },
  { channel: tm.mount, args: [1, 'tm-1', 0, 'read-write'] },
  { channel: tm.unmount, args: [1, 'tm-1'] },
  { channel: tm.exportWorking, args: [1, 'tm-1', 'output.xlsx'] },
  { channel: tm.resetWorking, args: [1, 'tm-1'] },
  { channel: tm.commitFile, args: ['tm-1', 1, { scope: 'all' }] },
  { channel: tm.matchFile, args: [1, 'tm-1'] },
  { channel: tm.importPreview, args: ['source.xlsx'] },
  { channel: tm.importExecute, args: ['tm-1', 'source.xlsx', referenceImportOptions] },
  { channel: tm.syncSetConfig, args: ['tm-1', syncConfig] },
  { channel: tm.syncExecute, args: ['tm-1'] },
  { channel: tm.syncCancel, args: ['tm-1', 'job-1'] },
  { channel: tb.getMatches, args: [1, sampleSegment] },
  { channel: tb.prefetch, args: [1, sampleSegment] },
  { channel: tb.preview, args: ['tb-1'] },
  { channel: tb.create, args: ['Terms', 'en', 'zh'] },
  { channel: tb.remove, args: ['tb-1'] },
  { channel: tb.rename, args: ['tb-1', 'Renamed'] },
  { channel: tb.getMountedByProject, args: [1] },
  { channel: tb.mount, args: [1, 'tb-1', 0] },
  { channel: tb.unmount, args: [1, 'tb-1'] },
  { channel: tb.importPreview, args: ['source.xlsx'] },
  { channel: tb.importExecute, args: ['tb-1', 'source.xlsx', referenceImportOptions] },
  { channel: tb.syncSetConfig, args: ['tb-1', syncConfig] },
  { channel: tb.syncExecute, args: ['tb-1'] },
  {
    channel: ai.testConnection,
    args: [{ name: 'Connection', baseUrl: 'https://example.test', apiKey: 'example-key' }],
  },
  { channel: ai.deleteConnection, args: ['connection-1'] },
  {
    channel: ai.addProvider,
    args: [{ name: 'Provider', connectionId: 'connection-1', model: 'model' }],
  },
  { channel: ai.deleteProvider, args: ['provider-1'] },
  { channel: ai.setProxySettings, args: [{ mode: 'system' }] },
  {
    channel: ai.setSourceTerminologyPromptSettings,
    args: [{ action: 'create', name: 'Prompt', prompt: 'Content' }],
  },
  { channel: ai.translateSegment, args: ['seg-1'] },
  { channel: ai.refineSegment, args: ['seg-1', 'Instruction'] },
  { channel: ai.translateFile, args: [1, {}] },
  { channel: ai.cancelFileJob, args: ['job-1'] },
  { channel: ai.testTranslate, args: [1, 'Source', 'Context'] },
  { channel: dialog.openFile, args: [[{ name: 'Excel', extensions: ['xlsx'] }]] },
  { channel: dialog.saveFile, args: ['output.xlsx', [{ name: 'Excel', extensions: ['xlsx'] }]] },
  { channel: job.getStatus, args: ['job-1'] },
];

describe('IPC argument boundaries', () => {
  it.each(
    requests.flatMap(({ channel, args }) =>
      args.map((value, index) => ({
        channel,
        index,
        args: args.map((arg, i) => (i === index ? (value === null ? false : null) : arg)),
      })),
    ),
  )('rejects invalid argument $index of $channel before delegation', async ({ channel, args }) => {
    const { invoke, downstreamCall } = setup();
    await expect(invoke(channel, args)).rejects.toThrow(/^Invalid /);
    expect(downstreamCall).not.toHaveBeenCalled();
  });

  it.each([undefined, '1', 0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid persisted identities (%s) before deleting a project directory',
    async (projectId) => {
      const { invoke, downstreamCall } = setup();
      await expect(invoke(project.remove, [projectId])).rejects.toThrow('Invalid projectId');
      expect(downstreamCall).not.toHaveBeenCalled();
    },
  );

  it.each([
    [project.create, ['Project', 'en', 'zh', 'unknown']],
    [tm.create, ['Memory', 'en', 'zh', 'unknown']],
    [tm.commitFile, ['tm-1', 1, { scope: 'unknown' }]],
    [tm.mount, [1, 'tm-1', Infinity]],
    [tb.mount, [1, 'tb-1', NaN]],
    [file.getSegments, [1, -1, 100]],
    [file.getSegments, [1, 0, Infinity]],
    [file.inspect, [1, '  ']],
    [tm.syncCancel, ['tm-1', '']],
    [project.updateQASettings, [1, { enabledRuleIds: ['unknown'], instantQaOnConfirm: true }]],
    [project.updateQASettings, [1, { enabledRuleIds: new Array(1), instantQaOnConfirm: true }]],
    [project.updateQASettings, [1, { enabledRuleIds: [], instantQaOnConfirm: 'false' }]],
    [project.createPastedSourceFile, [1, { sources: ['Source', 1] }]],
    [project.createPastedSourceFile, [1, { sources: new Array(1) }]],
    [project.createPastedSourceFile, [1, { sources: ['Source'], tagPolicy: 'unknown' }]],
    [project.addFile, [1, 'source.xlsx', { ...importOptions, sourceCol: -1 }]],
    [project.addFile, [1, 'source.xlsx', { ...importOptions, targetCol: 1.5 }]],
    [project.addFile, [1, 'source.xlsx', { ...importOptions, contextCol: NaN }]],
    [project.addFile, [1, 'source.xlsx', { ...importOptions, tagPolicy: 'unknown' }]],
    [project.addFile, [1, 'source.xlsx', { ...importOptions, hasHeader: 'false' }]],
    [tm.importExecute, ['tm-1', 'source.xlsx', { ...referenceImportOptions, overwrite: 'false' }]],
    [tm.importExecute, ['tm-1', 'source.xlsx', { ...referenceImportOptions, sourceCol: Infinity }]],
    [tb.importExecute, ['tb-1', 'source.xlsx', { ...referenceImportOptions, noteCol: -1 }]],
    [tm.syncSetConfig, ['tm-1', { ...syncConfig, columns: [] }]],
    [tm.syncSetConfig, ['tm-1', { ...syncConfig, filePath: 1 }]],
    [tb.syncSetConfig, ['tb-1', { ...syncConfig, columns: { ...importOptions, noteCol: '1' } }]],
    [tm.getMatches, [1, { ...sampleSegment, sourceTokens: [{ type: 'text', content: 42 }] }]],
    [tm.prefetch, [1, { ...sampleSegment, srcHash: null }]],
    [tb.getMatches, [1, { ...sampleSegment, meta: [] }]],
    [tb.prefetch, [1, { ...sampleSegment, meta: { ...sampleSegment.meta, context: 7 } }]],
    [ai.testConnection, [{ name: 'Connection', baseUrl: 'https://example.test', apiKey: 1 }]],
    [
      ai.testConnection,
      [{ name: 'Connection', baseUrl: 'https://example.test', apiKey: '', connectionId: false }],
    ],
    [ai.addProvider, [{ name: 'Provider', connectionId: 'connection-1', model: [] }]],
    [ai.deleteProvider, ['  ']],
    [ai.setProxySettings, [{ mode: 'unknown' }]],
    [ai.setProxySettings, [{ mode: 'off', customProxyUrl: false }]],
    [ai.setSourceTerminologyPromptSettings, [{ action: 'unknown' }]],
    [ai.setSourceTerminologyPromptSettings, [{ action: 'create', name: 'Prompt', prompt: 1 }]],
    [
      ai.setSourceTerminologyPromptSettings,
      [{ action: 'update', promptId: 'prompt-1', name: null, prompt: 'Content' }],
    ],
    [ai.setSourceTerminologyPromptSettings, [{ action: 'delete', promptId: 1 }]],
    [ai.setSourceTerminologyPromptSettings, [{ action: 'activate' }]],
    [ai.translateFile, [NaN, {}]],
    [ai.translateFile, [1, []]],
    [ai.translateFile, [1, { mode: 'unknown' }]],
    [ai.translateFile, [1, { targetScope: null }]],
    [ai.translateFile, [1, { targetBaseline: false }]],
    [ai.cancelFileJob, ['']],
    [dialog.openFile, [[{ name: 'Excel', extensions: [1] }]]],
    [dialog.openFile, [[{ name: false, extensions: ['xlsx'] }]]],
    [dialog.openFile, [new Array(1)]],
    [dialog.saveFile, ['output.xlsx', [{ name: 'Excel', extensions: new Array(1) }]]],
    [job.getStatus, ['  ']],
  ] satisfies Array<[string, unknown[]]>)(
    'rejects malformed shapes on %s before service, worker, job or event side effects',
    async (channel, args) => {
      const { invoke, downstreamCall } = setup();
      await expect(invoke(channel, args)).rejects.toThrow(/^Invalid /);
      expect(downstreamCall).not.toHaveBeenCalled();
    },
  );
});

describe('valid IPC payload compatibility', () => {
  it.each([
    [project.create, 'createProject', ['Project', 'en', 'zh'], ['Project', 'en', 'zh', undefined]],
    [project.create, 'createProject', ['Project', 'en', 'zh', 'review']],
    [project.create, 'createProject', ['Project', 'en', 'zh', 'custom']],
    [project.updateAISettings, 'updateProjectAISettings', [1, null, null]],
    [project.updatePrompt, 'updateProjectPrompt', [1, '']],
    [project.createSavedPrompt, 'createProjectSavedPrompt', [1, 'Prompt', '']],
    [
      project.updateQASettings,
      'updateProjectQASettings',
      [1, { enabledRuleIds: [], instantQaOnConfirm: false }],
    ],
    [
      project.addFile,
      'addFileToProject',
      [1, 'source.xlsx', { ...importOptions, contextCol: 0, tagPolicy: 'none', extra: true }],
    ],
    [project.createPastedSourceFile, 'createPastedSourceFile', [1, { sources: [] }]],
    [file.export, 'exportFile', [1, 'output.xlsx'], [1, 'output.xlsx', undefined]],
    [file.export, 'exportFile', [1, 'output.xlsx', importOptions]],
    [file.getSegments, 'getSegments', [1, 0, 0]],
    [tm.list, 'listTMs', [], [undefined]],
    [tm.listOptions, 'listTMOptions', ['working']],
    [tm.mount, 'mountTMToProject', [1, 'tm-1'], [1, 'tm-1', undefined, undefined]],
    [tm.mount, 'mountTMToProject', [1, 'tm-1', 0, 'custom-permission']],
    [tm.mount, 'mountTMToProject', [1, 'tm-1', -1.5, 'read-only']],
    [tm.commitFile, 'commitFileToTM', ['tm-1', 1, {}]],
    [tm.syncSetConfig, 'setTMSyncConfig', ['tm-1', syncConfig]],
    [tb.mount, 'mountTBToProject', [1, 'tb-1'], [1, 'tb-1', undefined]],
    [
      tb.syncSetConfig,
      'setTBSyncConfig',
      ['tb-1', { ...syncConfig, columns: { ...importOptions, noteCol: 0 } }],
    ],
    [
      ai.testConnection,
      'testAIConnection',
      [{ name: '', baseUrl: '', apiKey: '', connectionId: undefined, extra: true }],
    ],
    [
      ai.addProvider,
      'addAIProvider',
      [{ name: 'Provider', connectionId: 'connection-1', model: 'model' }],
    ],
    [ai.deleteConnection, 'deleteAIConnection', ['connection-1']],
    [ai.deleteProvider, 'deleteAIProvider', ['provider-1']],
    [ai.setProxySettings, 'setProxySettings', [{ mode: 'system' }]],
    [ai.setProxySettings, 'setProxySettings', [{ mode: 'off', customProxyUrl: '' }]],
    [
      ai.setProxySettings,
      'setProxySettings',
      [{ mode: 'custom', customProxyUrl: 'http://127.0.0.1:8080' }],
    ],
    [
      ai.setSourceTerminologyPromptSettings,
      'setSourceTerminologyPromptSettings',
      [{ action: 'create', name: 'Prompt', prompt: 'Content' }],
    ],
    [
      ai.setSourceTerminologyPromptSettings,
      'setSourceTerminologyPromptSettings',
      [{ action: 'update', promptId: 'prompt-1', name: 'Prompt', prompt: 'Content' }],
    ],
    [
      ai.setSourceTerminologyPromptSettings,
      'setSourceTerminologyPromptSettings',
      [{ action: 'delete', promptId: 'prompt-1' }],
    ],
    [
      ai.setSourceTerminologyPromptSettings,
      'setSourceTerminologyPromptSettings',
      [{ action: 'activate', promptId: 'builtin:default' }],
    ],
    [ai.translateSegment, 'aiTranslateSegment', ['seg-1']],
    [ai.refineSegment, 'aiRefineSegment', ['seg-1', '']],
    [ai.testTranslate, 'aiTestTranslate', [1, ''], [1, '', undefined]],
    [ai.testTranslate, 'aiTestTranslate', [1, 'Source', '']],
  ] satisfies Array<[string, string, unknown[], unknown[]?]>)(
    'forwards %s payloads and preserves optional/default values',
    async (channel, method, args, expected = args) => {
      const handlers = new Map<string, IpcMainListener>();
      const serviceCall = vi.fn().mockResolvedValue({ committedCount: 0, tmType: 'main' });
      const deps = {
        ipcMain: {
          handle: (name: string, handler: IpcMainListener) => handlers.set(name, handler),
        },
        projectService: { [method]: serviceCall },
        jobManager: {},
        referenceLookup: {},
        referenceLookupPrefetch: {},
        notifyReferenceDataChanged: vi.fn(),
      };
      registerProjectHandlers(deps as never);
      registerTMHandlers(deps as never);
      registerTBHandlers(deps as never);
      registerAIHandlers(deps as never);
      await handlers.get(channel)!({}, ...args);
      expect(serviceCall).toHaveBeenCalledExactlyOnceWith(...expected);
      expected.forEach((value, index) => {
        if (typeof value === 'object' && value !== null) {
          expect(serviceCall.mock.calls[0][index]).toBe(value);
        }
      });
    },
  );
});
