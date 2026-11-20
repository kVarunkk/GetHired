import { describe, expect, it } from "vitest";
import { normalizeSalaryText } from "./salary-text";

describe("normalizeSalaryText", () => {
  it("regroups lakh-grouped amounts in thousands", () => {
    expect(normalizeSalaryText("INR 15,00,000.00 - 20,00,000.00")).toBe("INR 1,500,000 - 2,000,000");
    expect(normalizeSalaryText("₹1,20,00,000 per year")).toBe("₹12,000,000 per year");
    expect(normalizeSalaryText("3,60,000 - 4,80,000")).toBe("360,000 - 480,000");
  });

  it("keeps a real fraction", () => {
    expect(normalizeSalaryText("INR 1,00,000.50")).toBe("INR 100,000.50");
  });

  it("leaves amounts already grouped in thousands, and other text, unchanged", () => {
    for (const text of [
      "USD 179,000 - 230,000",
      "INR 3,000,000 - 5,000,000",
      "EUR 52,600–65,400",
      "15 LPA",
      "$15–$17/hour",
      "Competitive",
      "2026-11-20",
    ]) {
      expect(normalizeSalaryText(text)).toBe(text);
    }
  });
});
