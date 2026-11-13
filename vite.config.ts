import { defineConfig } from 'vitest/config';

// GitHub Pages serves the site from /<repository-name>/, so assets need this base.
// Override with BASE_PATH=/ for a root deployment (e.g. a custom domain).
const base = process.env.BASE_PATH ?? '/Showitoff/';

export default defineConfig({
  base,
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
