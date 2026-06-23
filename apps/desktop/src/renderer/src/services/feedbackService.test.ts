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

  it('routes notifications through an installed handler instead of window.alert', () => {
    const nativeAlert = vi.fn();
    vi.stubGlobal('window', { alert: nativeAlert });
    const notify = vi.fn();

    installFeedbackHandlers({ notify });

    feedbackService.success('File created');
    expect(notify).toHaveBeenCalledWith('File created', 'success');

    feedbackService.error('Something failed');
    expect(notify).toHaveBeenCalledWith('Something failed', 'error');

    feedbackService.info('Heads up');
    expect(notify).toHaveBeenCalledWith('Heads up', 'info');

    expect(nativeAlert).not.toHaveBeenCalled();
  });

  it('falls back to window.alert after the notify handler is removed', () => {
    const nativeAlert = vi.fn();
    vi.stubGlobal('window', { alert: nativeAlert });
    const uninstall = installFeedbackHandlers({
      notify: vi.fn(),
    });

    uninstall();
    feedbackService.success('Fallback toast');

    expect(nativeAlert).toHaveBeenCalledWith('Fallback toast');
  });

  it('requires exact typed confirmation text when a destructive action asks for it', () => {
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, '')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'my project')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'My Project ')).toBe(false);
    expect(isConfirmRequirementMet({ requiredText: 'My Project' }, 'My Project')).toBe(true);
  });
});
