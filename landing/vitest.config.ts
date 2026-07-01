import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component tests run in jsdom, which does not process CSS. We deliberately do
// NOT reuse landing/vite.config.ts here: its `@tailwindcss/vite` plugin pulls
// in lightningcss's platform-native binary (`lightningcss.linux-x64-gnu.node`),
// which fails to load in CI (the binary for the runner's platform is an
// optional dep that isn't guaranteed present). The React transform is the only
// part of the build pipeline the tests actually need to compile TSX.
export default defineConfig({
  plugins: [react()],
  test: {
    name: 'frontend',
    environment: 'jsdom',
    include: ['tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup/vitest.setup.ts'],
  },
})
