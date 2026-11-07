import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";

// Offline eval (resume improve spec §10): real Gemini calls, so never part of
// `npm test`. Run with `npm run eval:resume-improve`.

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
    include: ["evals/resume-improve/**/*.eval.ts"],
    environment: "node",
    testTimeout: 10 * 60_000,
  },
});
