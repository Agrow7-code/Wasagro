import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

// Reuses landing's OWN vite.config.ts (the `react()` plugin, Tailwind, the
// dev proxy) so the test transform pipeline matches what actually ships —
// this file only adds the `test` block (jsdom environment + setup file).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      name: 'frontend',
      environment: 'jsdom',
      include: ['tests/**/*.test.tsx'],
      setupFiles: ['./tests/setup/vitest.setup.ts'],
    },
  }),
)
