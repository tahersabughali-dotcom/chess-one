import { defineConfig } from "vitest/config";

/**
 * Every game-access test: assignment, the access resolver, seat control and
 * lease rotation, the protocol, and the PostgreSQL and end-to-end files.
 * Those need CHESS_ONE_TEST_DATABASE_URL and fail, never skip, when it is
 * missing.
 */
export default defineConfig({
  test: {
    name: "game-access-all",
    include: ["tests/game-access/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
