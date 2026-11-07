import { describe, expect, it } from "vitest";
import { cleanJobText, validateAndSanitizeSearchQuery } from "./security";

describe("cleanJobText", () => {
  it("keeps text that the search filter refuses", () => {
    const text = "Draft system prompts for our agents.";

    expect(validateAndSanitizeSearchQuery(text, 100).success).toBe(false);
    expect(cleanJobText(text, 100)).toBe(text);
  });

  it("strips tags and trims", () => {
    expect(cleanJobText("  <p>Build <b>agents</b></p>  ", 100)).toBe("Build agents");
  });

  it("cuts to the limit instead of refusing", () => {
    expect(cleanJobText("x".repeat(50), 10)).toBe("x".repeat(10));
  });
});
