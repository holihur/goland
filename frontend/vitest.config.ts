import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "json"],
      include: [
        "src/lib/**/*.{ts,tsx}",
        "src/App.tsx",
        "src/components/LoginPage.tsx",
        "src/components/PromptDialog.tsx",
        "src/components/SettingsDialog.tsx",
      ],
      exclude: ["src/lib/types.ts"],
      thresholds: { lines: 70, statements: 70, functions: 70, branches: 60 },
    },
  },
  resolve: {
    alias: { "@": new URL("./src", import.meta.url).pathname },
  },
});
