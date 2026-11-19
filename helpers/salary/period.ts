/**
 * Salaries are stored per year. People think in months or hours too, so forms
 * take the amount in the period they pick and convert it here. Client-safe.
 */

import { MIN_PLAUSIBLE_ANNUAL_SALARY } from "./low-salary-cutoffs";

export const SALARY_PERIODS = ["year", "month", "hour"] as const;
export type SalaryPeriod = (typeof SALARY_PERIODS)[number];

/** An hourly rate's yearly estimate assumes 8 hours a day, 5 days a week. */
export const HOURS_PER_WEEK = 40;
export const WEEKS_PER_YEAR = 52;
export const HOURS_PER_YEAR = HOURS_PER_WEEK * WEEKS_PER_YEAR;

const PER_YEAR: Record<SalaryPeriod, number> = {
  year: 1,
  month: 12,
  hour: HOURS_PER_YEAR,
};

export const SALARY_PERIOD_LABELS: Record<SalaryPeriod, string> = {
  year: "Per year",
  month: "Per month",
  hour: "Per hour",
};

const PERIOD_SUFFIX: Record<SalaryPeriod, string> = {
  year: "a year",
  month: "a month",
  hour: "an hour",
};

export function isSalaryPeriod(value: unknown): value is SalaryPeriod {
  return typeof value === "string" && (SALARY_PERIODS as readonly string[]).includes(value);
}

/** The yearly amount, as a whole number, for what's paid per `period`. */
export function toAnnualSalary(amount: number, period: SalaryPeriod): number {
  return Math.round(amount * PER_YEAR[period]);
}

/** What a yearly amount comes to per `period` (not rounded). */
export function fromAnnualSalary(annual: number, period: SalaryPeriod): number {
  return annual / PER_YEAR[period];
}

/** "₹1,20,000", "$25.50". Hourly amounts keep cents; the rest are whole. */
export function formatSalaryAmount(amount: number, currency: string, period: SalaryPeriod = "year"): string {
  const digits = period === "hour" && !Number.isInteger(amount) ? 2 : 0;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("en-US", { maximumFractionDigits: digits })} ${currency}`;
  }
}

/**
 * The amount in the other periods, so a wrong period is easy to spot:
 * "≈ ₹1,20,000 a month · ₹692 an hour" for a yearly amount.
 */
export function salaryEquivalents(amount: number, period: SalaryPeriod, currency: string): string {
  const annual = amount * PER_YEAR[period];
  const others = SALARY_PERIODS.filter((other) => other !== period).map((other) => {
    const value = fromAnnualSalary(annual, other);
    const shown = other === "hour" ? Math.round(value * 100) / 100 : Math.round(value);
    return `${formatSalaryAmount(shown, currency, other)} ${PERIOD_SUFFIX[other]}`;
  });
  return `≈ ${others.join(" · ")}`;
}

/**
 * A yearly amount below the currency's cut-off (`low-salary-cutoffs.ts`) is
 * usually a month's pay. `month` when twelve times it looks like a real yearly
 * salary (with that yearly amount), `low` when even that is too low. Null when
 * the amount looks fine, the period isn't a year, or the currency has no
 * cut-off. Low salaries are real for some people, so this only warns.
 */
export type LowSalaryHint = { kind: "month"; annual: number } | { kind: "low" };

export function lowSalaryHint(
  amount: number,
  period: SalaryPeriod,
  currency: string,
): LowSalaryHint | null {
  const cutoff = MIN_PLAUSIBLE_ANNUAL_SALARY[currency];
  if (period !== "year" || cutoff === undefined || !(amount > 0) || amount >= cutoff) {
    return null;
  }
  const annual = toAnnualSalary(amount, "month");
  return annual >= cutoff ? { kind: "month", annual } : { kind: "low" };
}
