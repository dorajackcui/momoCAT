import { describe, expect, it, vi } from 'vitest';
import { buildDeleteProjectConfirmRequest } from './useProjects';

vi.mock('../services/apiClient', () => ({
  apiClient: {},
}));

describe('buildDeleteProjectConfirmRequest', () => {
  it('requires typing the project name before deletion can be confirmed', () => {
    expect(buildDeleteProjectConfirmRequest('Launch Plan')).toEqual({
      title: 'Delete Project',
      message: 'This will permanently delete this project and remove all files and translations.',
      confirmLabel: 'Delete Project',
      confirmVariant: 'danger',
      requiredText: 'Launch Plan',
      requiredTextLabel: 'Type the project name to confirm',
    });
  });
});
