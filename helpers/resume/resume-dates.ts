// Reading resume dates, which are stored as written. Client-safe.

export const RESUME_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The year and month in a date, as far as it can be read. Parsed resumes keep
 * dates as written ("Sept 2021", "03/2021", "Summer 2019"), so either can be missing.
 */
export function readResumeDate(value: string | undefined): { year?: number; month?: number } {
  if (!value) return {};
  const year = value.match(/\b(19[5-9]\d|20\d{2})\b/)?.[1];
  const named = value.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i)?.[1].toLowerCase();
  const numbered = value.match(/\b(\d{1,2})[/-]\d{4}\b/)?.[1] ?? value.match(/\b\d{4}[/-](\d{1,2})\b/)?.[1];

  const month = named ? RESUME_MONTHS.findIndex((name) => name.toLowerCase() === named) : Number(numbered) - 1;
  return {
    year: year ? Number(year) : undefined,
    month: month >= 0 && month < RESUME_MONTHS.length ? month : undefined,
  };
}

/**
 * Whether `a` is certainly earlier than `b`. Months count only when both dates
 * have one, so "2021" isn't before "Mar 2021". A date with no year, like
 * "Present", is never before or after anything.
 */
export function isResumeDateBefore(a: string | undefined, b: string | undefined): boolean {
  const first = readResumeDate(a);
  const second = readResumeDate(b);
  if (first.year === undefined || second.year === undefined) return false;
  if (first.year !== second.year) return first.year < second.year;
  if (first.month === undefined || second.month === undefined) return false;
  return first.month < second.month;
}
