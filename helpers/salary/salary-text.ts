/**
 * A number written with Indian digit grouping (lakh/crore): the last three
 * digits, then pairs, e.g. 15,00,000 or 1,20,00,000, with optional decimals.
 * A number grouped in thousands (1,500,000) doesn't match: it has no
 * two-digit group.
 */
const INDIAN_GROUPED_NUMBER = /(?<![\d,.])\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d+)?(?![\d,])/g;

/**
 * Rewrites a scraped salary text so every amount uses thousands grouping:
 * "INR 15,00,000.00 - 20,00,000.00" becomes "INR 1,500,000 - 2,000,000".
 *
 * Stored job salaries are free text, and Indian postings group digits in
 * lakhs. The agent's model read "15,00,000" as fifteen million and showed the
 * user a salary ten times too high (an Arize groundedness failure). Other
 * text, symbols and currencies are left as they are.
 */
export function normalizeSalaryText(text: string): string {
  return text.replace(INDIAN_GROUPED_NUMBER, (match) => {
    const [whole, fraction] = match.split(".");
    const digits = whole.replace(/,/g, "");
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    // ".00" adds nothing to a salary; keep a real fraction.
    return fraction && /[1-9]/.test(fraction) ? `${grouped}.${fraction}` : grouped;
  });
}
