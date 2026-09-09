/**
 * Test-only bindings, added to the same global interface the Worker uses so a
 * test sees exactly the runtime shape plus what the harness injects.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      /** Injected by vitest.config.ts, read from ./migrations. Absent at runtime. */
      TEST_MIGRATIONS?: { name: string; queries: string[] }[];
    }
  }
}
export {};
