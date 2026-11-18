/**
 * Salary currencies, client-safe. Salaries are stored with an ISO 4217 code
 * (`user_info.salary_currency`, `job_postings.salary_currency`,
 * `all_jobs.salary_currency`); the DB's `iso_currency()` converts the old
 * symbols the same way `toIsoCurrency` does. A salary filter only compares
 * amounts in one currency.
 */

import { z } from "zod";

/** Shown first in pickers, in this order. */
export const POPULAR_CURRENCIES = ["INR", "USD", "EUR", "GBP", "CAD", "AUD", "SGD", "AED"] as const;

/** Used where the runtime has no `Intl.supportedValuesOf`. */
const FALLBACK_CODES = [
  "AED", "ARS", "AUD", "BDT", "BRL", "CAD", "CHF", "CLP", "CNY", "COP", "CZK", "DKK", "EGP", "EUR",
  "GBP", "HKD", "HUF", "IDR", "ILS", "INR", "JPY", "KES", "KRW", "LKR", "MXN", "MYR", "NGN", "NOK",
  "NPR", "NZD", "PHP", "PKR", "PLN", "QAR", "RON", "SAR", "SEK", "SGD", "THB", "TRY", "TWD", "UAH",
  "USD", "VND", "ZAR",
];

function supportedCodes(): string[] {
  try {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
    const codes = intl.supportedValuesOf?.("currency");
    if (codes?.length) return codes;
  } catch {
    // Older runtimes: the fallback list.
  }
  return FALLBACK_CODES;
}

/** Every ISO 4217 code the runtime knows, popular ones first, then A–Z. */
export const CURRENCY_CODES: readonly string[] = (() => {
  const popular: readonly string[] = POPULAR_CURRENCIES;
  const rest = supportedCodes()
    .filter((c) => !popular.includes(c))
    .sort();
  return [...popular, ...rest];
})();

const KNOWN = new Set(CURRENCY_CODES);

/** Symbols and spellings that were stored before codes, as ISO 4217. */
const ALIASES: Record<string, string> = {
  "₹": "INR",
  rs: "INR",
  "rs.": "INR",
  $: "USD",
  us$: "USD",
  "€": "EUR",
  "£": "GBP",
  c$: "CAD",
  ca$: "CAD",
  a$: "AUD",
  au$: "AUD",
  s$: "SGD",
  "¥": "JPY",
};

/** An ISO 4217 code, or null when the value isn't a currency we know. */
export function toIsoCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  if (!v) return null;
  if (ALIASES[v]) return ALIASES[v];
  const code = v.toUpperCase();
  return /^[A-Z]{3}$/.test(code) && KNOWN.has(code) ? code : null;
}

export function isCurrencyCode(value: unknown): value is string {
  return typeof value === "string" && KNOWN.has(value);
}

let names: Intl.DisplayNames | null | undefined;

/** "Indian Rupee", or the code when the runtime has no names. */
export function currencyName(code: string): string {
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames(["en"], { type: "currency" });
    } catch {
      names = null;
    }
  }
  try {
    return names?.of(code) ?? code;
  } catch {
    return code;
  }
}

/** The short symbol ("₹", "$", "€"), or the code when it has none. */
export function currencySymbol(code: string): string {
  try {
    const part = new Intl.NumberFormat("en", { style: "currency", currency: code, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((p) => p.type === "currency");
    return part?.value ?? code;
  } catch {
    return code;
  }
}

/** "INR · Indian Rupee", for pickers. */
export const currencyLabel = (code: string) => `${code} · ${currencyName(code)}`;

export const CURRENCY_ERROR = "Pick a currency from the list.";

/** A currency as sent by a form, a tool or an old client (a symbol), as a code. */
export const currencyCodeSchema = z.string().transform((value, ctx) => {
  const code = toIsoCurrency(value);
  if (!code) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: CURRENCY_ERROR });
    return z.NEVER;
  }
  return code;
});
