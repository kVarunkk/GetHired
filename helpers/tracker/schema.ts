// Client-safe. What every way into the tracker accepts (AT-REQ-030,
// AT-REQ-038). Objects are stripped, never passthrough: nothing from input is
// spread into a row.

import { z } from "zod";
import { currencyCodeSchema } from "@/helpers/currency/currencies";
import { APPLIED_STATUSES, TRACKED_STATUSES } from "./status";

export const TRACKER_LIMITS = {
  title: 200,
  company: 200,
  url: 2048,
  location: 200,
  contact: 200,
  notes: 5000,
  description: 10_000,
} as const;

// C0 controls except tab and newline, DEL, and C1 controls.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

export const stripControlChars = (value: string) => value.replace(CONTROL_CHARS, "");

/** Trimmed one-line text, 1..max characters. */
const requiredText = (max: number, name: string) =>
  z
    .string()
    .transform((value) => stripControlChars(value).replace(/\s+/g, " ").trim())
    .pipe(z.string().min(1, `${name} is required.`).max(max, `${name} is at most ${max} characters.`));

/** Optional one-line text: blank reads as null. */
const optionalText = (max: number, name: string) =>
  z
    .string()
    .nullish()
    .transform((value) => (value == null ? null : stripControlChars(value).replace(/\s+/g, " ").trim() || null))
    .pipe(z.string().max(max, `${name} is at most ${max} characters.`).nullable());

/** Optional multi-line text (notes): blank reads as null. */
const optionalNotes = z
  .string()
  .nullish()
  .transform((value) => (value == null ? null : stripControlChars(value).trim() || null))
  .pipe(z.string().max(TRACKER_LIMITS.notes, `Notes are at most ${TRACKER_LIMITS.notes} characters.`).nullable());

/** Optional multi-line job description: blank reads as null. */
const optionalDescription = z
  .string()
  .nullish()
  .transform((value) => (value == null ? null : stripControlChars(value).trim() || null))
  .pipe(z.string().max(TRACKER_LIMITS.description, `The description is at most ${TRACKER_LIMITS.description} characters.`).nullable());

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-24.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Use a real date.");

export const optionalDate = isoDate.nullish().transform((value) => value ?? null);

/** An https link, or null. */
export const jobUrlSchema = z
  .string()
  .nullish()
  .transform((value) => (value == null ? null : value.trim() || null))
  .pipe(
    z
      .string()
      .max(TRACKER_LIMITS.url, "That link is too long.")
      .url("Enter a full link, starting with https://")
      .refine((value) => value.startsWith("https://"), "Only https links can be tracked.")
      .nullable(),
  );

export const trackedStatusSchema = z.enum(TRACKED_STATUSES);
export const appliedStatusSchema = z.enum(APPLIED_STATUSES);

const commonFields = {
  status: trackedStatusSchema.default("applied"),
  appliedAt: optionalDate,
  nextFollowUpAt: optionalDate,
  notes: optionalNotes,
  resumeId: z.string().uuid().nullish().transform((value) => value ?? null),
};

/** A board job, by its `all_jobs` id. */
export const boardJobInputSchema = z.object({ allJobsId: z.string().uuid(), ...commonFields });

/** Anything else: typed in, read from a link, or sent by the extension. */
export const freeFormInputSchema = z.object({
  jobTitle: requiredText(TRACKER_LIMITS.title, "Job title"),
  companyName: requiredText(TRACKER_LIMITS.company, "Company"),
  jobUrl: jobUrlSchema,
  location: optionalText(TRACKER_LIMITS.location, "Location"),
  jobDescription: optionalDescription,
  ...commonFields,
});

export const trackedInputSchema = z.union([boardJobInputSchema, freeFormInputSchema]);
export type TrackedInput = z.output<typeof trackedInputSchema>;
export type TrackedInputRaw = z.input<typeof trackedInputSchema>;
export type BoardJobInput = z.output<typeof boardJobInputSchema>;
export type FreeFormInput = z.output<typeof freeFormInputSchema>;

export const isBoardJobInput = (input: TrackedInput): input is BoardJobInput => "allJobsId" in input;

/** An edit of a tracked card. Status changes go through `setTrackedStatus`. */
export const trackedUpdateSchema = z
  .object({
    jobTitle: requiredText(TRACKER_LIMITS.title, "Job title"),
    companyName: requiredText(TRACKER_LIMITS.company, "Company"),
    jobUrl: jobUrlSchema,
    location: optionalText(TRACKER_LIMITS.location, "Location"),
    jobDescription: optionalDescription,
    appliedAt: optionalDate,
    nextFollowUpAt: optionalDate,
    notes: optionalNotes,
    contactName: optionalText(TRACKER_LIMITS.contact, "Contact"),
    resumeId: z.string().uuid().nullish().transform((value) => value ?? null),
    salaryAmount: z.number().int().min(0).max(1_000_000_000).nullish().transform((value) => value ?? null),
    salaryCurrency: currencyCodeSchema.nullish().transform((value) => value ?? null),
  })
  .partial();
export type TrackedUpdate = z.output<typeof trackedUpdateSchema>;

/** The private note on a GetHired application (AT-REQ-007). */
export const noteSchema = z.object({
  applicationId: z.string().uuid(),
  notes: optionalNotes,
  nextFollowUpAt: optionalDate,
});
export type NoteInput = z.output<typeof noteSchema>;

/** The first error message of a failed parse, for the UI. */
export const firstIssue = (error: z.ZodError) => error.issues[0]?.message ?? "Check the details and try again.";
