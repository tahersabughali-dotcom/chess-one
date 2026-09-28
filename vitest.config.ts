import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "rules", include: ["tests/rules/**/*.test.ts"] } },
      { test: { name: "boundaries", include: ["tests/boundaries/**/*.test.ts"] } },
    ],
  },
});
