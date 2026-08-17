import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MountedTM, ProjectFileRecord } from '../../../../shared/ipc';
import {
  getDefaultMountedCommitTarget,
  getMountedCommitTargets,
  ProjectCommitModal,
} from './ProjectCommitModal';

function createMountedTM(id: string, type: 'working' | 'main', permission: string): MountedTM {
  return {
    id,
    name: type === 'working' ? 'Project Working TM' : 'Shared Main TM',
    srcLang: 'en',
    tgtLang: 'zh',
    type,
    createdAt: '',
    updatedAt: '',
    priority: type === 'working' ? 0 : 10,
    permission,
    isEnabled: 1,
    entryCount: 0,
  };
}

const file = {
  id: 11,
  projectId: 7,
  name: 'demo.xlsx',
} as ProjectFileRecord;

describe('ProjectCommitModal', () => {
  it('offers a writable Working TM alongside mounted Main TMs', () => {
    const workingTM = createMountedTM('working-1', 'working', 'readwrite');
    const mainTM = createMountedTM('main-1', 'main', 'read');
    const html = renderToStaticMarkup(
      React.createElement(ProjectCommitModal, {
        file,
        mountedTMs: [workingTM, mainTM],
        selectedTmId: workingTM.id,
        commitScope: 'confirmed-only',
        onSelectedTmIdChange: vi.fn(),
        onCommitScopeChange: vi.fn(),
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
      }),
    );

    expect(html).toContain('Commit File To TM');
    expect(html).toContain('Project Working TM (Working TM, en→zh)');
    expect(html).toContain('Shared Main TM (Main TM, en→zh)');
  });

  it('excludes a read-only Working TM from commit targets', () => {
    const readOnlyWorkingTM = createMountedTM('working-1', 'working', 'read');
    const writableWorkingTM = createMountedTM('working-2', 'working', 'write');
    const mainTM = createMountedTM('main-1', 'main', 'read');

    expect(getMountedCommitTargets([readOnlyWorkingTM, writableWorkingTM, mainTM])).toEqual([
      writableWorkingTM,
      mainTM,
    ]);
  });

  it('keeps a mounted Main TM as the default when both target types are available', () => {
    const workingTM = createMountedTM('working-1', 'working', 'readwrite');
    const mainTM = createMountedTM('main-1', 'main', 'read');

    expect(getDefaultMountedCommitTarget([workingTM, mainTM])).toBe(mainTM);
    expect(getDefaultMountedCommitTarget([workingTM])).toBe(workingTM);
  });
});
