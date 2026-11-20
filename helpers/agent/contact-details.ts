const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
// International (+91 …), US-style ((555) 123-4567) and bare 10-digit numbers.
// Dates, UUIDs and salaries don't match: no "+", and no run of 10 digits.
const PHONE_PATTERN = /\+\d[\d\s().-]{7,16}\d|\(\d{3}\)\s?\d{3}[\s.-]\d{4}|(?<![\w-])\d{10}(?![\w-])/g;

/**
 * Masks emails and phone numbers. Tool results (a profile, a resume) carry
 * the user's contact details, and the trace-level summaries are read by
 * Arize's evaluators, which don't need them.
 *
 * Kept apart from `telemetry.ts` (which re-exports it) so the offline Arize
 * scripts can use it without loading the OpenTelemetry packages.
 */
export function redactContactDetails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]").replace(PHONE_PATTERN, "[phone]");
}
