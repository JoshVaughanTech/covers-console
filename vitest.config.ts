import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // `@/` is declared in tsconfig paths, which tsc and Next both read but
  // vitest does not — without this, any lib module importing across
  // packages resolves under the compiler and fails under test.
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],

    /* PGlite is a WebAssembly Postgres, and the store suites start one per
       test in a beforeEach. That is slower than it looks: on an idle machine
       tests/notifications.test.ts takes 36s for 20 tests, and event-store,
       weekly-delivery and engage all sit in the 15–25s range. Vitest's default
       10s hook timeout is already marginal against that.

       Under load it stops being marginal. Three sessions building in one
       checkout produced 50 failures on one run and 63 on the next over an
       IDENTICAL tree — verified by tree hash, so nothing about the code had
       changed — and every single one was `Hook timed out in 10000ms` or
       `Test timed out in 5000ms`. Not one was an assertion. Written up as
       entry 9 of docs/green-tests-broken-build.md.

       That failure mode is worse than slow. A suite that goes red for reasons
       unrelated to the diff teaches people to re-run it until it passes, and a
       check nobody believes is a check nobody has. So these are set high
       enough that a timeout means something is genuinely stuck rather than
       merely contended.

       Not infinite, and the job timeout in .github/workflows/ci.yml is the
       other half: a real deadlock fails the run in twenty minutes rather than
       hanging a runner. */
    hookTimeout: 60_000,
    testTimeout: 30_000,
  },
});
