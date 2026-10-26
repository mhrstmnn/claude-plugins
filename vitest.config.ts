import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["test/*/unit/**/*.test.ts"] } },
      {
        // Installs the runtime from the registry and starts the real language server.
        test: {
          name: "integration",
          include: ["test/*/integration/**/*.test.ts"],
          testTimeout: 300_000,
          hookTimeout: 300_000,
        },
      },
    ],
  },
});
