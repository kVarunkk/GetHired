import { describe, expect, it } from "vitest";
import { readSource, sourceFiles } from "@/test/utils/source";

// IV-SEC-001: Google tokens are decrypted only by helpers/calendar/*. Nothing
// else imports the crypto module or touches the token tables.
const ALLOWED_DIR = "helpers/calendar/";
const PATTERNS: [string, RegExp][] = [
  ["token-crypto import", /from\s+["'][^"']*calendar\/token-crypto["']/],
  ["calendar_tokens", /["'`]calendar_tokens["'`]/],
  ["calendar_pending_revocations", /["'`]calendar_pending_revocations["'`]/],
];

function offenders(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles(["app", "helpers", "components", "lib", "utils", "hooks", "emails"])) {
    if (file.startsWith(ALLOWED_DIR)) continue;
    if (file === "utils/types/database.types.ts") continue;
    const source = readSource(file);
    for (const [label, pattern] of PATTERNS) {
      if (pattern.test(source)) found.push(`${file}: ${label}`);
    }
  }
  return found;
}

describe("calendar token usage (IV-SEC-001)", () => {
  it("only helpers/calendar/* imports token-crypto or reads the token tables", () => {
    expect(offenders()).toEqual([]);
  });

  it("the patterns catch an import and a table read", () => {
    const [[, importPattern], [, tablePattern]] = PATTERNS;
    expect(importPattern.test(`import { decryptToken } from "@/helpers/calendar/token-crypto";`)).toBe(true);
    expect(tablePattern.test(`admin.from("calendar_tokens").select("*")`)).toBe(true);
  });
});
