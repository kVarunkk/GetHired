/**
 * Every date the app shows is in IST. Client components render on the server
 * (UTC on Cloud Run) and again in the browser, so formatting in the local
 * timezone or locale gives two different texts and a hydration error.
 */
export const APP_TIME_ZONE = "Asia/Kolkata";

/** "17 Oct 2026" */
export const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" };

/** Formats a date in `APP_TIME_ZONE`. Returns "" for a missing or invalid date. */
export function formatDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DATE_FORMAT,
  locale = "en-GB",
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: APP_TIME_ZONE }).format(date);
}

export function getCutOffDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString();
}

export function simpleTimeAgo(
  variant: "variant1" | "variant2",
  dateString?: string | null,
): string {
  if (!dateString) return variant === "variant2" ? "0" : "Unknown";
  const date = new Date(dateString);
  const now = new Date();

  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );

  // Calculate difference in milliseconds
  const diffMs = startOfToday.getTime() - startOfDate.getTime();

  // Convert to days (1000 ms * 60 s * 60 min * 24 hr)
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (variant === "variant2") {
    return diffDays.toString();
  }

  if (diffDays === 0) {
    return "today";
  }

  if (diffDays === 1) {
    return "1 day ago";
  }

  // For anything > 1 day
  return `${diffDays} days ago`;
}
