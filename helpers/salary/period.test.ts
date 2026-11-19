import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, POPULAR_CURRENCIES } from "@/helpers/currency/currencies";
import { MIN_PLAUSIBLE_ANNUAL_SALARY } from "./low-salary-cutoffs";
import {
  formatSalaryAmount,
  fromAnnualSalary,
  HOURS_PER_YEAR,
  lowSalaryHint,
  salaryEquivalents,
  toAnnualSalary,
} from "./period";

describe("toAnnualSalary", () => {
  it("converts months and hours to a year (8 hours a day, 5 days a week)", () => {
    expect(HOURS_PER_YEAR).toBe(2080);
    expect(toAnnualSalary(90_000, "year")).toBe(90_000);
    expect(toAnnualSalary(120_000, "month")).toBe(1_440_000);
    expect(toAnnualSalary(25, "hour")).toBe(52_000);
    expect(toAnnualSalary(25.5, "hour")).toBe(53_040);
  });

  it("rounds to a whole yearly amount", () => {
    expect(toAnnualSalary(12.345, "hour")).toBe(25_678);
  });

  it("goes back from a year", () => {
    expect(fromAnnualSalary(1_440_000, "month")).toBe(120_000);
    expect(fromAnnualSalary(52_000, "hour")).toBe(25);
  });
});

describe("formatSalaryAmount", () => {
  it("groups rupees the Indian way and keeps cents only on hourly rates", () => {
    expect(formatSalaryAmount(1_440_000, "INR")).toBe("₹14,40,000");
    expect(formatSalaryAmount(52_000, "USD")).toBe("$52,000");
    expect(formatSalaryAmount(25.5, "USD", "hour")).toBe("$25.50");
    expect(formatSalaryAmount(25, "USD", "hour")).toBe("$25");
  });
});

describe("salaryEquivalents", () => {
  it("shows the other two periods", () => {
    expect(salaryEquivalents(1_440_000, "year", "INR")).toBe("≈ ₹1,20,000 a month · ₹692.31 an hour");
    expect(salaryEquivalents(120_000, "month", "INR")).toBe("≈ ₹14,40,000 a year · ₹692.31 an hour");
    expect(salaryEquivalents(25, "hour", "USD")).toBe("≈ $52,000 a year · $4,333 a month");
  });
});

describe("lowSalaryHint", () => {
  it("suggests per month for an amount that's low for a year", () => {
    expect(lowSalaryHint(50_000, "year", "INR")).toEqual({ kind: "month", annual: 600_000 });
    expect(lowSalaryHint(5_000, "year", "USD")).toEqual({ kind: "month", annual: 60_000 });
    // In every currency with a rate, not just the popular ones.
    expect(lowSalaryHint(300_000, "year", "JPY")).toEqual({ kind: "month", annual: 3_600_000 });
  });

  it("only says it's low when even twelve times it is too low", () => {
    expect(lowSalaryHint(50_000, "year", "JPY")).toEqual({ kind: "low" });
    expect(lowSalaryHint(300, "year", "USD")).toEqual({ kind: "low" });
  });

  it("stays quiet for plausible amounts, other periods and currencies with no cut-off", () => {
    expect(lowSalaryHint(1_200_000, "year", "INR")).toBeNull();
    expect(lowSalaryHint(8_000, "year", "USD")).toBeNull();
    expect(lowSalaryHint(5_000, "month", "USD")).toBeNull();
    expect(lowSalaryHint(5_000, "hour", "USD")).toBeNull();
    expect(lowSalaryHint(5_000, "year", "XXX")).toBeNull();
    expect(lowSalaryHint(0, "year", "USD")).toBeNull();
  });
});

describe("MIN_PLAUSIBLE_ANNUAL_SALARY", () => {
  it("has a cut-off for nearly every currency the pickers offer", () => {
    const missing = CURRENCY_CODES.filter((code) => !(code in MIN_PLAUSIBLE_ANNUAL_SALARY));
    expect(missing.length).toBeLessThanOrEqual(10);
    for (const code of POPULAR_CURRENCIES) expect(MIN_PLAUSIBLE_ANNUAL_SALARY[code]).toBeGreaterThan(0);
  });
});
