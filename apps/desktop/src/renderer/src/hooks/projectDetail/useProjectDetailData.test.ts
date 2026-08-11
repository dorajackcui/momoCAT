import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import type { TMBatchMatchResult } from '../../../../shared/ipc';
import { createProjectDetailActions, createProjectDetailDataLoaders } from './useProjectDetailData';

const { apiClientMock } = vi.hoisted(() => ({
  apiClientMock: {
    getProject: vi.fn(),
    getProjectFiles: vi.fn(),
    getProjectMountedTMs: vi.fn(),
    listTMOptions: vi.fn(),
    getProjectMountedTBs: vi.fn(),
    listTBs: vi.fn(),
    mountTMToProject: vi.fn(),
    unmountTMFromProject: vi.fn(),
    mountTBToProject: vi.fn(),
    unmountTBFromProject: vi.fn(),
    commitToMainTM: vi.fn(),
    matchFileWithTM: vi.fn(),
  },
}));

vi.mock('../../services/apiClient', () => ({
  apiClient: apiClientMock,
}));

const project: Project = {
  id: 7,
  uuid: 'project-7',
  name: 'Project 7',
  srcLang: 'en',
  tgtLang: 'zh',
  projectType: 'translation',
  aiPrompt: null,
  aiTemperature: null,
  aiModel: null,
  qaSettings: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  apiClientMock.getProject.mockResolvedValue(project);
  apiClientMock.getProjectFiles.mockResolvedValue([]);
  apiClientMock.getProjectMountedTMs.mockResolvedValue([]);
  apiClientMock.listTMOptions.mockResolvedValue([]);
  apiClientMock.getProjectMountedTBs.mockResolvedValue([]);
  apiClientMock.listTBs.mockResolvedValue([]);
  apiClientMock.mountTMToProject.mockResolvedValue(undefined);
  apiClientMock.unmountTMFromProject.mockResolvedValue(undefined);
  apiClientMock.mountTBToProject.mockResolvedValue(undefined);
  apiClientMock.unmountTBFromProject.mockResolvedValue(undefined);
  apiClientMock.commitToMainTM.mockResolvedValue(0);
  apiClientMock.matchFileWithTM.mockResolvedValue({
    total: 0,
    matched: 0,
    applied: 0,
    skipped: 0,
  });
});

function createMutationHarness() {
  const order: string[] = [];
  const runMutation = vi.fn(async <T>(fn: () => Promise<T>): Promise<T> => {
    order.push('mutation:start');
    const result = await fn();
    order.push('mutation:end');
    return result;
  });
  const loadData = vi.fn(async () => {
    order.push('loadData');
  });
  return { order, runMutation, loadData };
}

describe('useProjectDetailData behavior helpers', () => {
  it('loads only project and files for the initial files view', async () => {
    const setters = createDataSetters();
    const loaders = createProjectDetailDataLoaders({
      projectId: 7,
      api: apiClientMock,
      ...setters,
    });

    await loaders.loadData();

    expect(apiClientMock.getProject).toHaveBeenCalledWith(7);
    expect(apiClientMock.getProjectFiles).toHaveBeenCalledWith(7);
    expect(apiClientMock.getProjectMountedTMs).not.toHaveBeenCalled();
    expect(apiClientMock.listTMOptions).not.toHaveBeenCalled();
    expect(apiClientMock.getProjectMountedTBs).not.toHaveBeenCalled();
    expect(apiClientMock.listTBs).not.toHaveBeenCalled();
    expect(setters.setProject).toHaveBeenCalledWith(project);
    expect(setters.setFiles).toHaveBeenCalledWith([]);
  });

  it('loads TM and TB reference data on demand', async () => {
    const setters = createDataSetters();
    const loaders = createProjectDetailDataLoaders({
      projectId: 7,
      api: apiClientMock,
      ...setters,
    });

    await loaders.loadTMData();

    expect(apiClientMock.getProjectMountedTMs).toHaveBeenCalledWith(7);
    expect(apiClientMock.listTMOptions).toHaveBeenCalledWith('main');
    expect(setters.setMountedTMs).toHaveBeenCalledWith([]);
    expect(setters.setAllMainTMs).toHaveBeenCalledWith([]);

    await loaders.loadTBData();

    expect(apiClientMock.getProjectMountedTBs).toHaveBeenCalledWith(7);
    expect(apiClientMock.listTBs).toHaveBeenCalledWith();
    expect(setters.setMountedTBs).toHaveBeenCalledWith([]);
    expect(setters.setAllTBs).toHaveBeenCalledWith([]);
  });

  it('mountTM runs inside mutation and refreshes data', async () => {
    const { order, runMutation, loadData } = createMutationHarness();
    const api = {
      mountTMToProject: vi.fn(async () => {
        order.push('api:mountTMToProject');
      }),
      unmountTMFromProject: vi.fn(async () => {}),
      mountTBToProject: vi.fn(async () => {}),
      unmountTBFromProject: vi.fn(async () => {}),
      commitToMainTM: vi.fn(async () => 0),
      matchFileWithTM: vi.fn(async () => ({ total: 0, matched: 0, applied: 0, skipped: 0 })),
    };
    const actions = createProjectDetailActions({ projectId: 7, api, loadData, runMutation });

    await actions.mountTM('tm-1');

    expect(api.mountTMToProject).toHaveBeenCalledWith(7, 'tm-1');
    expect(loadData).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['mutation:start', 'api:mountTMToProject', 'loadData', 'mutation:end']);
  });

  it('commitToMainTM returns API result and refreshes', async () => {
    const { runMutation, loadData } = createMutationHarness();
    const api = {
      mountTMToProject: vi.fn(async () => {}),
      unmountTMFromProject: vi.fn(async () => {}),
      mountTBToProject: vi.fn(async () => {}),
      unmountTBFromProject: vi.fn(async () => {}),
      commitToMainTM: vi.fn(async () => 23),
      matchFileWithTM: vi.fn(async () => ({ total: 0, matched: 0, applied: 0, skipped: 0 })),
    };
    const actions = createProjectDetailActions({ projectId: 11, api, loadData, runMutation });

    const count = await actions.commitToMainTM('tm-main', 101);

    expect(count).toBe(23);
    expect(api.commitToMainTM).toHaveBeenCalledWith('tm-main', 101, undefined);
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('commitToMainTM passes commit options to the API', async () => {
    const { runMutation, loadData } = createMutationHarness();
    const api = {
      mountTMToProject: vi.fn(async () => {}),
      unmountTMFromProject: vi.fn(async () => {}),
      mountTBToProject: vi.fn(async () => {}),
      unmountTBFromProject: vi.fn(async () => {}),
      commitToMainTM: vi.fn(async () => 5),
      matchFileWithTM: vi.fn(async () => ({ total: 0, matched: 0, applied: 0, skipped: 0 })),
    };
    const actions = createProjectDetailActions({ projectId: 11, api, loadData, runMutation });

    const count = await actions.commitToMainTM('tm-main', 101, { scope: 'all' });

    expect(count).toBe(5);
    expect(api.commitToMainTM).toHaveBeenCalledWith('tm-main', 101, { scope: 'all' });
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('matchFileWithTM returns batch result and refreshes', async () => {
    const { runMutation, loadData } = createMutationHarness();
    const expected: TMBatchMatchResult = { total: 100, matched: 80, applied: 70, skipped: 10 };
    const api = {
      mountTMToProject: vi.fn(async () => {}),
      unmountTMFromProject: vi.fn(async () => {}),
      mountTBToProject: vi.fn(async () => {}),
      unmountTBFromProject: vi.fn(async () => {}),
      commitToMainTM: vi.fn(async () => 0),
      matchFileWithTM: vi.fn(async () => expected),
    };
    const actions = createProjectDetailActions({ projectId: 1, api, loadData, runMutation });

    const result = await actions.matchFileWithTM(9, 'tm-2');

    expect(result).toEqual(expected);
    expect(api.matchFileWithTM).toHaveBeenCalledWith(9, 'tm-2');
    expect(loadData).toHaveBeenCalledTimes(1);
  });

  it('propagates mutation failure and does not refresh', async () => {
    const { runMutation, loadData } = createMutationHarness();
    const api = {
      mountTMToProject: vi.fn(async () => {}),
      unmountTMFromProject: vi.fn(async () => {}),
      mountTBToProject: vi.fn(async () => {
        throw new Error('mount failed');
      }),
      unmountTBFromProject: vi.fn(async () => {}),
      commitToMainTM: vi.fn(async () => 0),
      matchFileWithTM: vi.fn(async () => ({ total: 0, matched: 0, applied: 0, skipped: 0 })),
    };
    const actions = createProjectDetailActions({ projectId: 1, api, loadData, runMutation });

    await expect(actions.mountTB('tb-1')).rejects.toThrow('mount failed');
    expect(loadData).not.toHaveBeenCalled();
  });
});

function createDataSetters() {
  return {
    setProject: vi.fn(),
    setFiles: vi.fn(),
    setMountedTMs: vi.fn(),
    setAllMainTMs: vi.fn(),
    setMountedTBs: vi.fn(),
    setAllTBs: vi.fn(),
    setLoadingData: vi.fn(),
  };
}
