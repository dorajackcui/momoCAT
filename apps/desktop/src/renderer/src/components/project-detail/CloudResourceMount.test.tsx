// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ProjectTMPane } from './ProjectTMPane';
import { ProjectTBPane } from './ProjectTBPane';

const resource = {
  id: 'same-id',
  name: 'Product',
  srcLang: 'en',
  tgtLang: 'zh',
  createdAt: '',
  updatedAt: '',
};

describe('cloud project resource mounting', () => {
  it.each(['tm', 'tb'] as const)(
    'distinguishes cloud mounting from explicit local %s copy with colliding IDs',
    (kind) => {
      const mount = vi.fn();
      const copy = vi.fn();
      const localResources = [{ ...resource, name: 'Local product' }];
      if (kind === 'tm') {
        render(
          <ProjectTMPane
            mountedTMs={[]}
            allMainTMs={[{ ...resource, type: 'main' }]}
            loadState={{ status: 'ready' }}
            onRetry={vi.fn()}
            onMountTM={mount}
            onUnmountTM={vi.fn()}
            onExportWorkingTM={vi.fn()}
            onResetWorkingTM={vi.fn()}
            localResources={localResources}
            onCopyAndMount={copy}
          />,
        );
      } else {
        render(
          <ProjectTBPane
            mountedTBs={[]}
            allTBs={[{ ...resource, stats: { entryCount: 0, languagePairs: [] } }]}
            onMountTB={mount}
            onUnmountTB={vi.fn()}
            localResources={localResources}
            onCopyAndMount={copy}
          />,
        );
      }
      const select = screen.getByRole('combobox', {
        name: kind === 'tm' ? 'Mount translation memory' : 'Mount term base',
      });
      fireEvent.change(select, { target: { value: 'same-id' } });
      expect(mount).toHaveBeenCalledWith('same-id');
      expect(copy).not.toHaveBeenCalled();
      expect(
        screen.getByRole('option', { name: /Local product.*create cloud copy/ }),
      ).toBeInTheDocument();
      fireEvent.change(select, { target: { value: 'local:same-id' } });
      expect(copy).toHaveBeenCalledWith('same-id');
      expect(mount).toHaveBeenCalledOnce();
    },
  );

  it('keeps local project pickers free of cloud-copy controls', () => {
    render(<ProjectTBPane mountedTBs={[]} allTBs={[]} onMountTB={vi.fn()} onUnmountTB={vi.fn()} />);
    expect(
      screen.queryByRole('group', { name: 'Create cloud copy from local' }),
    ).not.toBeInTheDocument();
  });
});
