import { describe, expect, it } from "vitest";
import { alertName, alertNameParts, cleanAlertName, shortSalary } from "./name";

describe("alertName (JAT-012, JA-TST-001)", () => {
  it("builds the spec's example", () => {
    expect(
      alertName({
        jobTitleKeywords: ["frontend engineer"],
        location: ["bangalore", "remote"],
        jobType: ["Fulltime"],
        minExperience: 2,
        maxExperience: 5,
        minSalary: 2000000,
        salaryCurrency: "INR",
      }),
    ).toBe("Frontend Engineer jobs in Bangalore, Remote · Fulltime · 2–5 yrs · ₹20L+");
  });

  it("keywords only", () => {
    expect(alertName({ jobTitleKeywords: ["react", "next.js"] })).toBe("React, Next.js jobs");
  });

  it("location only", () => {
    expect(alertName({ location: ["bangalore"] })).toBe("Jobs in Bangalore");
    expect(alertName({ location: ["new york", "san francisco", "remote"] })).toBe(
      "Jobs in New York, San Francisco, Remote",
    );
  });

  it("salary with INR and USD", () => {
    expect(alertName({ minSalary: 1500000, salaryCurrency: "INR" })).toBe("Jobs · ₹15L+");
    expect(alertName({ minSalary: 120000, salaryCurrency: "USD" })).toBe("Jobs · $120K+");
    expect(alertName({ salaryCurrency: "EUR" })).toBe("Jobs · Paid in EUR");
  });

  it("experience min only, max only and a range", () => {
    expect(alertName({ minExperience: 5 })).toBe("Jobs · 5+ yrs");
    expect(alertName({ maxExperience: 1 })).toBe("Jobs · up to 1 yrs");
    expect(alertName({ minExperience: 2, maxExperience: 2 })).toBe("Jobs · 2 yrs");
  });

  it("companies and platforms", () => {
    expect(alertName({ companyName: ["Acme"], platform: ["greenhouse"] })).toBe("Jobs at Acme · On Greenhouse");
  });

  it("truncates to 80 characters on a word boundary", () => {
    const name = alertName({
      jobTitleKeywords: ["software engineer", "backend developer", "platform engineer", "site reliability"],
      location: ["bangalore", "hyderabad"],
    });
    expect(name.length).toBeLessThanOrEqual(80);
    expect(name.endsWith("…")).toBe(true);
    expect(name).not.toMatch(/\s…$/);
  });

  it("exposes the details for the Settings summary", () => {
    expect(alertNameParts({ location: ["pune"], jobType: ["Intern"] })).toEqual({
      headline: "Jobs in Pune",
      details: ["Intern"],
    });
  });
});

describe("shortSalary", () => {
  it("uses crores for large INR amounts", () => {
    expect(shortSalary(10000000, "INR")).toBe("₹1Cr");
  });
});

describe("cleanAlertName", () => {
  it("trims, strips control characters and caps the length", () => {
    expect(cleanAlertName("  My\u0007 alert\n ")).toBe("My alert");
    expect(cleanAlertName("   ")).toBeNull();
    expect(cleanAlertName("x".repeat(100))).toHaveLength(80);
  });
});
