import react from '@vitejs/plugin-react'
// vitest/config re-exports Vite's defineConfig with the `test` key typed.
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the built app works on GitHub Pages regardless of repo name
  base: './',
  plugins: [react()],
  test: {
    // Pure logic only, so no DOM environment is needed - the money is in
    // calc.ts and the normalizers, not in whether a button renders. Adding
    // jsdom later is a config line, not a rewrite.
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
})
