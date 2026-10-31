/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages project sites).
  base: './',
  build: {
    target: 'es2020',
    // Flags are fetched on demand; never inline them into the JS bundle.
    assetsInlineLimit: (file) => (file.includes('flag-icons') ? false : undefined),
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
