import { describe, expect, it } from "vitest";
import { escapeCsvCell, isFormulaLike } from "./csv-safety";
import { parseCandidateFields } from "./candidate-schema";

describe("isFormulaLike (BI-SEC-004)", () => {
  it.each(["=SUM(A1)", "+1", "-1+2", "@cmd", " =1", "\t=1", "\t@x", "  -x"])("flags %j", (cell) => {
    expect(isFormulaLike(cell)).toBe(true);
  });

  it.each(["Asha", "asha@example.com", "1-2", "a=b", "", "  "])("leaves %j", (cell) => {
    expect(isFormulaLike(cell)).toBe(false);
  });
});

describe("escapeCsvCell", () => {
  it("prefixes formula-like text with a quote mark", () => {
    expect(escapeCsvCell("=1+1")).toBe("'=1+1");
    expect(escapeCsvCell("@x")).toBe("'@x");
  });

  it("quotes commas, quotes and newlines", () => {
    expect(escapeCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(escapeCsvCell("=a,b")).toBe("\"'=a,b\"");
  });

  it("leaves plain text, numbers and empty values alone", () => {
    expect(escapeCsvCell("Asha Rao")).toBe("Asha Rao");
    expect(escapeCsvCell(-1)).toBe("-1");
    expect(escapeCsvCell(null)).toBe("");
    expect(escapeCsvCell(undefined)).toBe("");
  });

  it("doesn't escape a negative number: it's a validation error in a numeric field instead", () => {
    const result = parseCandidateFields({ full_name: "Asha", experience_years: "-1" });
    expect(result.ok).toBe(false);
  });
});
