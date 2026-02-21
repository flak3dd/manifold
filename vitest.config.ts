import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    // Two environments: browser-like globals for bridge code (since it uses
    // page.evaluate callbacks that reference window/indexedDB/HTMLElement),
    // and node for pure logic tests.
    environment: "node",
    include: [
      "playwright-bridge/tests/**/*.test.ts",
      "src/**/*.test.ts",
    ],
    coverage: {
      provider: "v8",
      include: [
        "playwright-bridge/**/*.ts",
        "src/lib/**/*.ts",
        "evasions/**/*.ts",
      ],
      exclude: [
        "playwright-bridge/tests/**",
        "src/**/*.test.ts",
        "**/*.d.ts",
      ],
      reporter: ["text", "lcov", "html"],
    },
  },
  resolve: {
    // Allow Vitest to resolve .js extensions to .ts sources (used by
    // evasions/index.ts which imports via ./canvas.js etc.)
    extensions: [".ts", ".js"],
  },
});
