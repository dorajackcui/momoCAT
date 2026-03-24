import { defineConfig } from 'vitest/config';

export default defineConfig({
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
