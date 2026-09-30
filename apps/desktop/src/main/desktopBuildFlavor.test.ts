import { describe, expect, it, vi } from 'vitest';
import { getDesktopBuildProfile } from './desktopBuildFlavor';

describe('desktop build isolation', () => {
  it('preserves ordinary builds when no compile-time flavor is supplied', () => {
    expect(getDesktopBuildProfile()).toEqual({
      flavor: 'local',
      appName: undefined,
      displayName: 'momoCAT',
      appUserModelId: 'com.cat.tool',
      updatesEnabled: true,
    });
  });

  it('gives cloud builds their own desktop identity and disables ordinary updates', () => {
    expect(getDesktopBuildProfile('cloud')).toEqual({
      flavor: 'cloud',
      appName: 'momoCAT Cloud',
      displayName: 'momoCAT Cloud',
      appUserModelId: 'com.simplecat.tool.cloud.experimental',
      updatesEnabled: false,
    });
  });

  it('does not change installed identity in response to a runtime environment variable', () => {
    vi.stubEnv('MOMOCAT_BUILD_FLAVOR', 'cloud');
    try {
      expect(getDesktopBuildProfile().flavor).toBe('local');
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
