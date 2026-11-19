import { describe, expect, it } from "vitest";
import { CURRENCY_CODES, POPULAR_CURRENCIES, currencyCodeSchema, currencyLabel, currencySymbol, isCurrencyCode, parseCurrencyCode, toIsoCurrency } from "./currencies";

describe("toIsoCurrency", () => {
  it.each([
    ["₹", "INR"],
    ["Rs.", "INR"],
    ["$", "USD"],
    ["€", "EUR"],
    ["£", "GBP"],
    ["C$", "CAD"],
    ["A$", "AUD"],
    ["S$", "SGD"],
    ["inr", "INR"],
    [" aed ", "AED"],
    ["JPY", "JPY"],
  ])("%s is %s", (input, code) => expect(toIsoCurrency(input)).toBe(code));

  it.each([null, undefined, "", "  ", "¥¥", "LPA", "BTC", "rupees"])("%s is null", (input) =>
    expect(toIsoCurrency(input)).toBeNull(),
  );
});

describe("CURRENCY_CODES", () => {
  it("lists the popular ones first, then every other code once", () => {
    expect(CURRENCY_CODES.slice(0, POPULAR_CURRENCIES.length)).toEqual([...POPULAR_CURRENCIES]);
    expect(new Set(CURRENCY_CODES).size).toBe(CURRENCY_CODES.length);
    expect(CURRENCY_CODES.length).toBeGreaterThan(100);
    expect(CURRENCY_CODES).toContain("BRL");
  });

  it("knows codes, not symbols", () => {
    expect(isCurrencyCode("INR")).toBe(true);
    expect(isCurrencyCode("₹")).toBe(false);
  });
});

describe("labels", () => {
  it("names and symbols a currency", () => {
    expect(currencyLabel("INR")).toBe("INR · Indian Rupee");
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("EUR")).toBe("€");
  });
});

describe("input takes codes only", () => {
  it.each([
    ["INR", "INR"],
    [" usd ", "USD"],
    ["₹", null],
    ["$", null],
    ["BTC", null],
    [null, null],
  ])("parseCurrencyCode(%s) is %s", (input, code) => expect(parseCurrencyCode(input)).toBe(code));

  it("refuses a symbol with a message naming the format", () => {
    expect(currencyCodeSchema.safeParse("eur").data).toBe("EUR");
    const result = currencyCodeSchema.safeParse("€");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/ISO 4217/);
  });
});
