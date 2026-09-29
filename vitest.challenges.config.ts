import { defineConfig } from "vitest/config";

/**
 * Every direct-challenge test: the domain state machine, the application,
 * the HTTP routes, and the PostgreSQL and end-to-end files. Those need
 * CHESS_ONE_TEST_DATABASE_URL and fail, never skip, when it is missing.
 */
export default defineConfig({
  test: {
    name: "challenges-all",
    include: ["tests/challenges/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
