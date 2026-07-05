import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    resolve: {
      alias: {
        '@cat/core': resolve('../../packages/core/src'),
        '@cat/db': resolve('../../packages/db/src'),
        '@cat/localization': resolve('../../packages/localization/src'),
      },
    },
    build: {
      rollupOptions: {
        external: ['better-sqlite3'],
        input: {
          index: resolve('src/main/index.ts'),
          tmImportWorker: resolve('src/main/tmImportWorker.ts'),
          tmSyncWorker: resolve('src/main/tmSyncWorker.ts'),
          referenceLookupWorker: resolve('src/main/referenceLookupWorker.ts'),
          referenceExportWorker: resolve('src/main/referenceExportWorker.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@cat/core'] })],
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@cat/core': resolve('../../packages/core/src'),
      },
    },
    plugins: [react()],
  },
});
