import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Offline evals (SI-TEST-040/041): real Gemini calls, so never part of `npm test`.
// Run with `npm run eval:screening`.

try {
  process.loadEnvFile(fileURLToPath(new URL("../../.env", import.meta.url)));
} catch {
  // No .env: the key must already be in the environment.
}

export default defineConfig({
  resolve: {
    alias: [{ find: /^@\//, replacement: fileURLToPath(new URL("../../", import.meta.url)) }],
  },
  test: {
    root: fileURLToPath(new URL("../../", import.meta.url)),
    include: ["evals/screening-interview/**/*.eval.ts"],
    environment: "node",
    testTimeout: 20 * 60_000,
  },
});
