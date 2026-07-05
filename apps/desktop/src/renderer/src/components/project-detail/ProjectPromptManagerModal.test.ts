import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ProjectSavedPromptsController } from '../../hooks/projectDetail/useProjectAI';
import { ProjectPromptManagerModal } from './ProjectPromptManagerModal';

function createSavedPromptsController(
  overrides?: Partial<ProjectSavedPromptsController>,
): ProjectSavedPromptsController {
  return {
    prompts: [],
    selectedPromptId: null,
    managerOpen: true,
    openManager: vi.fn(),
    closeManager: vi.fn(),
    applyPrompt: vi.fn().mockResolvedValue(true),
    saveDraftAsNewPrompt: vi.fn().mockResolvedValue(true),
    updatePrompt: vi.fn().mockResolvedValue(true),
    deletePrompt: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function renderModal(savedPrompts: ProjectSavedPromptsController, currentDraft = '') {
  return renderToStaticMarkup(
    React.createElement(ProjectPromptManagerModal, {
      open: true,
      onClose: vi.fn(),
      savedPrompts,
      currentDraft,
    }),
  );
}

describe('ProjectPromptManagerModal', () => {
  it('shows an empty state when no prompts are saved', () => {
    const html = renderModal(createSavedPromptsController());

    expect(html).toContain('Saved Prompts');
    expect(html).toContain('No saved prompts yet.');
    expect(html).toContain('Save Current Prompt As');
  });

  it('lists saved prompts with their actions and marks the prompt in use', () => {
    const controller = createSavedPromptsController({
      prompts: [
        {
          id: 1,
          projectId: 9,
          name: 'Formal tone',
          content: 'Translate formally.',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
        {
          id: 2,
          projectId: 9,
          name: 'Casual tone',
          content: 'Translate casually.',
          createdAt: '2026-07-01T00:00:00.000Z',
          updatedAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      selectedPromptId: 1,
    });
    const html = renderModal(controller, 'Translate formally.');

    expect(html).toContain('Formal tone');
    expect(html).toContain('Casual tone');
    expect(html).toContain('Translate formally.');
    expect(html).toContain('In use');
    expect(html).toContain('Apply');
    expect(html).toContain('Edit');
    expect(html).toContain('Delete');
  });
});
