import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";

// Offline eval of the agent's job-search calls: real Gemini calls, so never
// part of `npm test`. Run with `npm run eval:agent-search`.

try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the key must already be in the environment.
}

export default defineConfig({
  // The tools import email templates (JSX).
  plugins: [react()],
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("../../", import.meta.url)) }],
  },
  test: {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    include: ["evals/agent-search/**/*.eval.ts"],
    environment: "node",
    // Mocks server-only and next/server's after(), which the tools import.
    setupFiles: ["./test/setup.ts"],
    testTimeout: 10 * 60_000,
  },
});
