import { currencySymbol } from "@/helpers/currency/currencies";
import { platformsArray } from "@/utils/platforms";
import type { AlertFilters } from "./filters";

/** Longest alert name, stored and renamed (JA-REQ-003). */
export const ALERT_NAME_MAX = 80;

const titleCase = (value: string) =>
  value.replace(/(^|[\s\-/(])(\p{L})/gu, (_, sep: string, letter: string) => sep + letter.toUpperCase());

const PLATFORM_LABELS = new Map<string, string>(platformsArray.map((p) => [p.value, p.label]));

/** "₹20L", "$120K", "€80K": short enough for a subject line. */
export function shortSalary(amount: number, currency: string | undefined): string {
  const symbol = currency ? currencySymbol(currency) : "";
  if (currency === "INR") {
    if (amount >= 1_00_00_000) return `${symbol}${trim(amount / 1_00_00_000)}Cr`;
    if (amount >= 1_00_000) return `${symbol}${trim(amount / 1_00_000)}L`;
  }
  const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(amount);
  return symbol === currency && currency ? `${compact} ${currency}` : `${symbol}${compact}`;
}

const trim = (n: number) => String(Math.round(n * 10) / 10);

function experience(filters: AlertFilters): string | null {
  const { minExperience: min, maxExperience: max } = filters;
  if (min !== undefined && max !== undefined) return min === max ? `${min} yrs` : `${min}–${max} yrs`;
  if (min !== undefined) return `${min}+ yrs`;
  if (max !== undefined) return `up to ${max} yrs`;
  return null;
}

/**
 * The parts of an alert's name: the headline ("Frontend Engineer jobs in
 * Bangalore") and the details (job types, experience, salary, companies,
 * platforms). Settings shows the details as the filter summary.
 */
export function alertNameParts(filters: AlertFilters): { headline: string; details: string[] } {
  const keywords = filters.jobTitleKeywords ?? [];
  let headline = keywords.length > 0 ? `${keywords.map(titleCase).join(", ")} jobs` : "Jobs";
  if (filters.location?.length) headline += ` in ${filters.location.map(titleCase).join(", ")}`;
  if (filters.companyName?.length) headline += ` at ${filters.companyName.join(", ")}`;

  const details: string[] = [];
  if (filters.jobType?.length) details.push(filters.jobType.join(", "));
  const years = experience(filters);
  if (years) details.push(years);
  if (filters.minSalary !== undefined) details.push(`${shortSalary(filters.minSalary, filters.salaryCurrency)}+`);
  else if (filters.salaryCurrency) details.push(`Paid in ${filters.salaryCurrency}`);
  if (filters.platform?.length) {
    details.push(`On ${filters.platform.map((p) => PLATFORM_LABELS.get(p) ?? titleCase(p)).join(", ")}`);
  }
  return { headline, details };
}

/** Cut on a word boundary with an ellipsis. */
export function truncateWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  const base = space > max / 2 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s,·–-]+$/u, "")}…`;
}

/**
 * A readable name (JA-REQ-003): "Frontend Engineer jobs in Bangalore, Remote ·
 * Fulltime · 2–5 yrs · ₹20L+", at most 80 characters.
 */
export function alertName(filters: AlertFilters): string {
  const { headline, details } = alertNameParts(filters);
  return truncateWords([headline, ...details].join(" · "), ALERT_NAME_MAX);
}

/** A user's own name for an alert: trimmed, no control characters, 1–80 characters. Null when empty. */
export function cleanAlertName(name: string): string | null {
  const cleaned = name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.slice(0, ALERT_NAME_MAX);
}
