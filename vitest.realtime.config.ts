import { defineConfig } from "vitest/config";

/**
 * Every realtime test: protocol, runtime, and local WebSocket tests, plus the
 * end-to-end tests over real WebSocket, Fastify, and PostgreSQL. The
 * PostgreSQL files need CHESS_ONE_TEST_DATABASE_URL and fail, never skip,
 * when it is missing.
 */
export default defineConfig({
  test: {
    name: "realtime-all",
    include: ["tests/realtime/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
