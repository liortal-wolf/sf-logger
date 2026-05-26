import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: false,
    setupFiles: ['./tests/__mocks__/gm.ts'],
    include: ['tests/**/*.test.ts']
  }
});
