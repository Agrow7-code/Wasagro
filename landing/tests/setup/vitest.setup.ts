// Vitest setup for the frontend ("landing") test project — jsdom environment.
// Extends `expect` with @testing-library/jest-dom matchers and ensures the DOM
// is unmounted/cleaned between tests (Vitest does not auto-register the
// testing-library cleanup hook unless `test.globals` is enabled, which this
// repo does not use — see vitest.config.ts).
import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

afterEach(() => {
  cleanup()
})
