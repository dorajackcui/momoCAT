// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { ProjectDetailHeader } from './ProjectDetailHeader';

const PROJECT: Project = {
  id: 1,
  uuid: 'project-1',
  name: 'Demo Project',
  srcLang: 'en',
  tgtLang: 'fr',
  projectType: 'translation',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function renderHeader(overrides: Partial<Parameters<typeof ProjectDetailHeader>[0]> = {}) {
  const props: Parameters<typeof ProjectDetailHeader>[0] = {
    project: PROJECT,
    loading: false,
    activeTab: 'files',
    onBack: vi.fn(),
    onTabChange: vi.fn(),
    onOpenQASettings: vi.fn(),
    isAddFileMenuOpen: false,
    onToggleAddFileMenu: vi.fn(),
    onCloseAddFileMenu: vi.fn(),
    onOpenFileImport: vi.fn(),
    onOpenPasteSource: vi.fn(),
    ...overrides,
  };
  render(<ProjectDetailHeader {...props} />);
  return props;
}

describe('ProjectDetailHeader', () => {
  it('renders project identity and delegates tab changes', () => {
    const props = renderHeader();

    expect(screen.getByText('Demo Project')).toBeInTheDocument();
    expect(screen.getByText('en → fr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Translation Memory' }));
    fireEvent.click(screen.getByRole('button', { name: 'Term Bases' }));

    expect(props.onTabChange).toHaveBeenNthCalledWith(1, 'tm');
    expect(props.onTabChange).toHaveBeenNthCalledWith(2, 'tb');
  });

  it('delegates add-file menu actions', () => {
    const props = renderHeader({ isAddFileMenuOpen: true });

    fireEvent.click(screen.getByRole('menuitem', { name: 'Import' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Paste' }));

    expect(props.onOpenFileImport).toHaveBeenCalledTimes(1);
    expect(props.onOpenPasteSource).toHaveBeenCalledTimes(1);
  });

  it('closes the add-file menu on Escape and outside pointer input', () => {
    const onCloseAddFileMenu = vi.fn();
    renderHeader({ isAddFileMenuOpen: true, onCloseAddFileMenu });

    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.pointerDown(document.body);

    expect(onCloseAddFileMenu).toHaveBeenCalledTimes(2);
  });
});
