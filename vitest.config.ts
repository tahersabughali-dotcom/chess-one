import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "rules", include: ["tests/rules/**/*.test.ts"] } },
      { test: { name: "boundaries", include: ["tests/boundaries/**/*.test.ts"] } },
      { test: { name: "live-game", include: ["tests/live-game/**/*.test.ts"] } },
      {
        test: {
          name: "persistence",
          include: ["tests/live-game-persistence/**/*.test.ts"],
          exclude: [...configDefaults.exclude, "tests/live-game-persistence/**/*.db.test.ts"],
        },
      },
    ],
  },
});
