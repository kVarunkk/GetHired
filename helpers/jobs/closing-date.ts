// Client-safe (JL-REQ-014): the rules for a job's closing date, shared by the
// job form, the save path and the agent's job tools.
import { z } from "zod";
import { todayIn } from "@/helpers/companies/time-zone";
import type { JobPostState } from "./job-states";

export const CLOSES_AT_PAST = "The closing date must be today or later.";
export const CLOSES_AT_FILLED = "A filled job's closing date can't change. Reopen the job first, or clear the date.";

/** A calendar date, `YYYY-MM-DD`, that exists. */
export const closingDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31.")
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "That date doesn't exist.");

/**
 * Why `next` can't be saved as the closing date, or null when it can. A date
 * the job already has is always fine (so an edit of a job past its date still
 * saves), clearing is always fine, and otherwise the date must be today or
 * later in the company's time zone and the job not filled.
 */
export function closingDateError({
  next,
  previous = null,
  state,
  timeZone,
  now = new Date(),
}: {
  /** The value to save; null clears, undefined leaves it unchanged. */
  next: string | null | undefined;
  previous?: string | null;
  /** The job's state; undefined for a new job. */
  state?: JobPostState;
  timeZone: string | null | undefined;
  now?: Date;
}): string | null {
  if (next === undefined || next === null || next === previous) return null;
  if (state === "filled") return CLOSES_AT_FILLED;
  // ISO dates compare as strings.
  if (next < todayIn(timeZone, now)) return CLOSES_AT_PAST;
  return null;
}

/** "2026-12-31" → "December 31, 2026", the same day wherever it's read. */
export function formatClosingDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "long", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
}
