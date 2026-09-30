export type DesktopBuildFlavor = 'local' | 'cloud';

declare const __MOMOCAT_BUILD_FLAVOR__: DesktopBuildFlavor;

export function getDesktopBuildProfile(
  flavor: DesktopBuildFlavor = typeof __MOMOCAT_BUILD_FLAVOR__ === 'undefined'
    ? 'local'
    : __MOMOCAT_BUILD_FLAVOR__,
) {
  return flavor === 'cloud'
    ? {
        flavor,
        appName: 'momoCAT Cloud',
        displayName: 'momoCAT Cloud',
        appUserModelId: 'com.simplecat.tool.cloud.experimental',
        updatesEnabled: false,
      }
    : {
        flavor,
        appName: undefined,
        displayName: 'momoCAT',
        appUserModelId: 'com.cat.tool',
        updatesEnabled: true,
      };
}
