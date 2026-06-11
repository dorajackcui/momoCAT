import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  feedbackService,
  installFeedbackHandlers,
  isConfirmRequirementMet,
  resetFeedbackHandlersForTest,
} from './feedbackService';

describe('feedbackService', () => {
  afterEach(() => {
    resetFeedbackHandlersForTest();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('routes confirmations through an installed handler instead of window.confirm', async () => {
    const nativeConfirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('window', { confirm: nativeConfirm });
    const confirm = vi.fn().mockResolvedValue(true);

    installFeedbackHandlers({ confirm });

    await expect(feedbackService.confirm('Delete this project?')).resolves.toBe(true);
    expect(confirm).toHaveBeenCalledWith({ message: 'Delete this project?' });
    expect(nativeConfirm).not.toHaveBeenCalled();
  });

  it('falls back to window.confirm after the installed handler is removed', async () => {
    const nativeConfirm = vi.fn().mockReturnValue(true);
    vi.stubGlobal('window', { confirm: nativeConfirm });
    const uninstall = installFeedbackHandlers({
      confirm: vi.fn().mockResolvedValue(false),
    });

    uninstall();
    await expect(feedbackService.confirm('Fallback?')).resolves.toBe(true);

    expect(nativeConfirm).toHaveBeenCalledWith('Fallback?');
  });

  it('requires exact typed confirmation text when a destructive action asks for it', () => {
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, '')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'my project')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'My Project ')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'My Project')).toBe(true);
  });
});
