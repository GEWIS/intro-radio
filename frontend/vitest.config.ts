import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

// Deliberately standalone rather than merging vite.config.mts: these are a
// couple of narrowly-scoped regression tests for plain logic (see #15, #16),
// not a full component test suite, so we avoid pulling in the app's Vue/
// Vuetify build plugins here.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.spec.ts'],
  },
});
