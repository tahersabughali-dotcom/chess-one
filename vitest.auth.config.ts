import { defineConfig } from "vitest/config";

/**
 * Every accounts and authentication test: identity, hashing, sessions, HTTP
 * routes, and WebSocket authentication, plus the PostgreSQL and end-to-end
 * files. Those need CHESS_ONE_TEST_DATABASE_URL and fail, never skip, when
 * it is missing.
 */
export default defineConfig({
  test: {
    name: "auth-all",
    include: ["tests/accounts/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
