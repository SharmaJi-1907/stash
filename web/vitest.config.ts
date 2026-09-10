import { defineConfig } from 'vitest/config';

/**
 * The web tests run in Node with a fake IndexedDB, not in a browser.
 *
 * What is being tested here is the local store and the outbox — plain logic over
 * a database — and those are the parts where a mistake is invisible until a save
 * is lost. Rendering is checked by looking at it, which no test replaces.
 */
export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
