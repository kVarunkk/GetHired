import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json.
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("./", import.meta.url)) }],
  },
  test: {
    setupFiles: ["./test/setup.ts"],
    // Reset vi.fn() history/implementations and restore spies before each test,
    // so module-level vi.mock() fns don't leak state between tests.
    mockReset: true,
    restoreMocks: true,
    exclude: ["**/node_modules/**", "**/.next/**"],
    coverage: {
      provider: "v8",
      include: ["app/**", "helpers/**", "lib/**", "utils/**", "components/**"],
    },
    // Server code (routes, helpers) runs in node; React components (*.test.tsx) in jsdom.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx"],
        },
      },
    ],
  },
});
