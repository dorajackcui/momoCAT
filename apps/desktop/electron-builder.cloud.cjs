const { build } = require('./package.json');

module.exports = {
  ...build,
  appId: 'com.simplecat.tool.cloud.experimental',
  productName: 'momoCAT Cloud',
  artifactName: '${productName}-Setup-${version}-${arch}.${ext}',
  executableName: 'momoCAT Cloud',
  extraMetadata: {
    name: 'simple-cat-tool-cloud',
    productName: 'momoCAT Cloud',
  },
  directories: { ...build.directories, output: 'dist-cloud' },
  mac: {
    ...build.mac,
    identity: '-',
    notarize: false,
    preAutoEntitlements: false,
    hardenedRuntime: true,
    entitlements: 'build/entitlements.cloud.mac.plist',
    entitlementsInherit: 'build/entitlements.cloud.mac.plist',
  },
  publish: null,
};
