// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '@cat/core/project';
import { WorkspaceSidebar } from './WorkspaceSidebar';

const projects = [
  { id: 1, name: 'Product localization', srcLang: 'en', tgtLang: 'zh', projectType: 'translation' },
  { id: 2, name: 'Help Center Review', srcLang: 'en', tgtLang: 'zh', projectType: 'review' },
] as Project[];

function props() {
  return {
    projects,
    view: { kind: 'project' as const, projectId: 1 },
    disabled: false,
    onNavigate: vi.fn(),
    onCreate: vi.fn(),
    onDelete: vi.fn(),
  };
}

beforeEach(() => {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1280 });
});

describe('WorkspaceSidebar', () => {
  it('opens a floating project menu outside the scrolling list and supports keyboard dismissal', () => {
    const callbacks = props();
    render(<WorkspaceSidebar {...callbacks} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Product localization' });
    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Product localization actions' });
    expect(menu.parentElement).toBe(document.body);
    expect(screen.getByRole('navigation', { name: 'Projects' })).not.toContainElement(menu);
    expect(within(menu).getByRole('menuitem', { name: 'Open project' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(within(menu).getByRole('menuitem', { name: 'Delete project…' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    expect(callbacks.onDelete).not.toHaveBeenCalled();
  });

  it('delegates the chosen project action and dismisses on an outside click', () => {
    const callbacks = props();
    render(<WorkspaceSidebar {...callbacks} />);
    const trigger = screen.getByRole('button', { name: 'Actions for Help Center Review' });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Open project' }));
    expect(callbacks.onNavigate).toHaveBeenCalledWith({ kind: 'project', projectId: 2 });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete project…' }));
    expect(callbacks.onDelete).toHaveBeenCalledWith(projects[1]);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('keeps direct project navigation on narrow windows and restores it after CAT', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 640 });
    const callbacks = props();
    const { rerender } = render(<WorkspaceSidebar {...callbacks} />);
    const nav = screen.getByRole('navigation', { name: 'Projects' });
    expect(
      within(nav).getByRole('button', { name: 'Product localization', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    expect(
      screen.queryByRole('button', { name: /Collapse sidebar|Expand sidebar|Switch project/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(within(nav).getByRole('button', { name: 'Help Center Review', exact: true }));
    expect(callbacks.onNavigate).toHaveBeenCalledWith({ kind: 'project', projectId: 2 });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    rerender(<WorkspaceSidebar {...callbacks} hidden />);
    expect(
      screen.queryByRole('complementary', { name: 'Workspace navigation' }),
    ).not.toBeInTheDocument();
    rerender(<WorkspaceSidebar {...callbacks} />);
    expect(screen.getByRole('button', { name: 'Product localization', exact: true })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Help Center Review', exact: true })).toBeVisible();
  });

  it('keeps project creation reachable when the sidebar has no projects', () => {
    const callbacks = props();
    render(<WorkspaceSidebar {...callbacks} projects={[]} />);
    expect(screen.getByText('Your projects will appear here.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    expect(callbacks.onCreate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
