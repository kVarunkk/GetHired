import { describe, expect, it } from "vitest";
import {
  CANDIDATE_FIELD_KEYS,
  parseCandidateFields,
  splitList,
  type CandidateFieldKey,
} from "./candidate-schema";

const ok = (input: Record<string, unknown>, opts?: { withJob?: boolean }) => {
  const result = parseCandidateFields({ full_name: "Asha Rao", ...input }, opts);
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.errors)}`);
  return result.data;
};

const errorsOf = (input: Record<string, unknown>, opts?: { withJob?: boolean }) => {
  const result = parseCandidateFields({ full_name: "Asha Rao", ...input }, opts);
  if (result.ok) throw new Error("expected errors");
  return result.errors;
};

describe("splitList", () => {
  it("splits on commas and semicolons, trims, drops empties and dedupes case-insensitively", () => {
    expect(splitList("Go, rust; ;  TypeScript,go,,", { max: 50, maxLength: 60 })).toEqual({
      items: ["Go", "rust", "TypeScript"],
      error: null,
    });
  });

  it("accepts an array and splits each entry", () => {
    expect(splitList(["a, b", "c"], { max: 5, maxLength: 5 }).items).toEqual(["a", "b", "c"]);
  });

  it("reports too many items and too long items", () => {
    expect(splitList("a,b,c", { max: 2, maxLength: 5 }).error).toMatch(/at most 2/);
    expect(splitList("abcdef", { max: 2, maxLength: 5 }).error).toMatch(/5 characters/);
  });

  it("reads null and empty as no items", () => {
    expect(splitList(null, { max: 2, maxLength: 5 })).toEqual({ items: [], error: null });
    expect(splitList("", { max: 2, maxLength: 5 })).toEqual({ items: [], error: null });
  });
});

describe("parseCandidateFields (BI-REQ-012)", () => {
  it("lists every field key", () => {
    expect([...CANDIDATE_FIELD_KEYS].sort()).toEqual(
      [
        "full_name",
        "email",
        "phone",
        "location",
        "current_title",
        "current_company",
        "experience_years",
        "linkedin_url",
        "github_url",
        "portfolio_url",
        "skills",
        "tags",
        "notes",
        "resume_url",
      ].sort(),
    );
  });

  it("requires a name of 1–120 characters", () => {
    expect(errorsOf({ full_name: "  " }).full_name).toBeTruthy();
    expect(errorsOf({ full_name: "x".repeat(121) }).full_name).toMatch(/120/);
    expect(ok({ full_name: "  Asha  " }).full_name).toBe("Asha");
    expect(ok({ full_name: "x".repeat(120) }).full_name).toHaveLength(120);
  });

  it("validates, trims and lower-cases the email", () => {
    expect(ok({ email: "  Asha.Rao@Example.COM " }).email).toBe("asha.rao@example.com");
    expect(errorsOf({ email: "not-an-email" }).email).toBeTruthy();
    expect(ok({ email: "" }).email).toBeNull();
    expect(ok({}).email).toBeUndefined();
  });

  it("keeps the phone as entered within 30 characters of digits, + - ( ) and spaces", () => {
    expect(ok({ phone: " +91 (80) 1234-5678 " }).phone).toBe("+91 (80) 1234-5678");
    expect(errorsOf({ phone: "1".repeat(31) }).phone).toBeTruthy();
    expect(errorsOf({ phone: "call me" }).phone).toBeTruthy();
    expect(errorsOf({ phone: "=1+2" }).phone).toBeTruthy();
  });

  it.each(["location", "current_title", "current_company"] as const)("caps %s at 120", (field) => {
    expect(ok({ [field]: "x".repeat(120) })[field]).toHaveLength(120);
    expect(errorsOf({ [field]: "x".repeat(121) })[field]).toMatch(/120/);
  });

  it("takes experience between 0 and 60, with decimals, from a number or text", () => {
    expect(ok({ experience_years: 0 }).experience_years).toBe(0);
    expect(ok({ experience_years: "3.5" }).experience_years).toBe(3.5);
    expect(ok({ experience_years: 60 }).experience_years).toBe(60);
    expect(ok({ experience_years: "" }).experience_years).toBeNull();
    expect(errorsOf({ experience_years: -1 }).experience_years).toBeTruthy();
    expect(errorsOf({ experience_years: "-1" }).experience_years).toBeTruthy();
    expect(errorsOf({ experience_years: 60.5 }).experience_years).toBeTruthy();
    expect(errorsOf({ experience_years: "ten" }).experience_years).toBeTruthy();
  });

  it.each(["linkedin_url", "github_url", "portfolio_url", "resume_url"] as const)(
    "accepts only http(s) for %s",
    (field) => {
      expect(ok({ [field]: "https://example.com/a" })[field]).toBe("https://example.com/a");
      expect(ok({ [field]: "http://example.com" })[field]).toBe("http://example.com");
      expect(errorsOf({ [field]: "javascript:alert(1)" })[field]).toBeTruthy();
      expect(errorsOf({ [field]: "ftp://example.com/cv.pdf" })[field]).toBeTruthy();
      expect(errorsOf({ [field]: "example.com" })[field]).toBeTruthy();
    },
  );

  it("splits skills (≤ 50 × 60) and tags (≤ 20 × 40)", () => {
    expect(ok({ skills: "Go; Rust, go" }).skills).toEqual(["Go", "Rust"]);
    expect(ok({ tags: ["referral", "2024"] }).tags).toEqual(["referral", "2024"]);
    expect(errorsOf({ skills: Array.from({ length: 51 }, (_, i) => `s${i}`).join(",") }).skills).toBeTruthy();
    expect(errorsOf({ skills: "x".repeat(61) }).skills).toBeTruthy();
    expect(errorsOf({ tags: Array.from({ length: 21 }, (_, i) => `t${i}`).join(";") }).tags).toBeTruthy();
    expect(errorsOf({ tags: "x".repeat(41) }).tags).toBeTruthy();
    expect(ok({ skills: "" }).skills).toEqual([]);
  });

  it("caps notes at 2,000", () => {
    expect(ok({ notes: "x".repeat(2000) }).notes).toHaveLength(2000);
    expect(errorsOf({ notes: "x".repeat(2001) }).notes).toBeTruthy();
  });

  it("accepts stage only when a job is the destination", () => {
    expect(errorsOf({ stage: "Onsite" }).stage).toBeTruthy();
    expect(ok({ stage: " Onsite " }, { withJob: true }).stage).toBe("Onsite");
  });

  it("rejects unknown keys", () => {
    const errors = errorsOf({ age: "34" });
    expect(Object.keys(errors)).toContain("age");
  });

  it("keys every error by its field", () => {
    const errors = errorsOf({ full_name: "", email: "x", linkedin_url: "javascript:1" });
    expect(Object.keys(errors).sort()).toEqual(["email", "full_name", "linkedin_url"] satisfies CandidateFieldKey[]);
  });

  it("stores formula-looking text as plain text", () => {
    expect(ok({ notes: "=HYPERLINK(\"x\")" }).notes).toBe("=HYPERLINK(\"x\")");
    expect(ok({ current_title: "@lead" }).current_title).toBe("@lead");
  });
});
