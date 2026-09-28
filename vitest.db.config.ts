import { defineConfig } from "vitest/config";

/**
 * PostgreSQL integration tests. They need a disposable local test database in
 * CHESS_ONE_TEST_DATABASE_URL and fail, never skip, when it is missing.
 */
export default defineConfig({
  test: {
    name: "persistence-db",
    include: ["tests/live-game-persistence/**/*.db.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
