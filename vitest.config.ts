import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: '@cat/localization',
        replacement: resolve(__dirname, 'packages/localization/src'),
      },
      {
        find: /^@cat\/localization\/(.+)$/,
        replacement: resolve(__dirname, 'packages/localization/src/$1'),
      },
      {
        find: '@cat/core',
        replacement: resolve(__dirname, 'packages/core/src'),
      },
      {
        find: /^@cat\/core\/(.+)$/,
        replacement: resolve(__dirname, 'packages/core/src/$1'),
      },
      {
        find: '@cat/db',
        replacement: resolve(__dirname, 'packages/db/src'),
      },
      {
        find: /^@cat\/db\/(.+)$/,
        replacement: resolve(__dirname, 'packages/db/src/$1'),
      },
    ],
  },
  test: {
    exclude: [
      '.tmp/**',
      '**/node_modules/**',
      '**/dist/**',
      '**/out/**',
      '**/release/**',
      '**/build/**',
      '**/e2e/**',
    ],
    include: ['**/*.{test,spec}.{ts,js}'],
    environment: 'node',
  },
});
