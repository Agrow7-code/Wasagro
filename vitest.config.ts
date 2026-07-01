import { defineConfig } from 'vitest/config'

// Two independent test "projects" share one `npm test` (= vitest run)
// invocation from the repo root:
//  - backend:  plain TypeScript, node environment (tests/**/*.test.ts).
//  - frontend: React components under landing/src/** — delegated entirely to
//              `landing/vitest.config.ts`. root and landing/ are two
//              INDEPENDENT npm projects (separate package.json + node_modules
//              — landing deploys standalone on Vercel, see `vercel-build`).
//              Pointing a project entry AT the `landing` directory (rather
//              than re-declaring jsdom/plugins/aliases here) makes Vitest
//              resolve every import — app source AND @testing-library/react
//              itself — from landing/node_modules, so there is exactly ONE
//              React instance. Aliasing across the two node_modules trees
//              from here does NOT work: @testing-library/react's internal
//              `react-dom/client` require is native CJS resolution from its
//              OWN install location and ignores Vite's `resolve.alias`.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'backend',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
        },
      },
      'landing',
    ],
  },
})
