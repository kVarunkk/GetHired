// The company candidate fields (plan/bulk-import/feature-bulk-import-spec.md,
// BI-REQ-012): one schema for the spreadsheet preview, the confirm actions,
// the resume grid and the edit form. Client-safe.
//
// Values are taken as entered (text from a spreadsheet cell or a form input)
// and always stored as text: a cell starting with `=` stays text, and is only
// escaped on export (csv-safety.ts, BI-SEC-004).

import { z } from "zod";

export const CANDIDATE_FIELD_KEYS = [
  "full_name",
  "email",
  "phone",
  "location",
  "current_title",
  "current_company",
  "experience_years",
  "linkedin_url",
  "github_url",
  "portfolio_url",
  "skills",
  "tags",
  "notes",
  "resume_url",
] as const;

export type CandidateFieldKey = (typeof CANDIDATE_FIELD_KEYS)[number];

export const SKILLS_LIMIT = { max: 50, maxLength: 60 } as const;
export const TAGS_LIMIT = { max: 20, maxLength: 40 } as const;

/**
 * Splits "Go; Rust, go" into ["Go", "Rust"]: on `,` and `;`, trimmed, empty
 * items dropped, deduplicated case-insensitively (the first spelling wins).
 */
export function splitList(
  value: string | readonly string[] | null | undefined,
  { max, maxLength }: { max: number; maxLength: number },
): { items: string[]; error: string | null } {
  const parts = (Array.isArray(value) ? value : [value ?? ""]).flatMap((v) => String(v).split(/[,;]/));
  const seen = new Set<string>();
  const items: string[] = [];
  for (const part of parts) {
    const item = part.trim();
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    items.push(item);
  }
  if (items.length > max) return { items, error: `Use at most ${max} items.` };
  if (items.some((i) => i.length > maxLength)) return { items, error: `Keep each item to ${maxLength} characters.` };
  return { items, error: null };
}

/** Sent but blank becomes null (clears the field); not sent stays undefined (leaves it). */
const blankToNull = (value: unknown) =>
  value === undefined ? undefined : value === null || String(value).trim() === "" ? null : String(value).trim();

const text = (max: number) =>
  z.preprocess(blankToNull, z.string().max(max, `Keep it to ${max} characters.`).nullish());

const httpUrl = z.preprocess(
  blankToNull,
  z
    .string()
    .max(2048, "Keep it to 2,048 characters.")
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }, "Use a link starting with http:// or https://.")
    .nullish(),
);

const list = (limit: { max: number; maxLength: number }) =>
  z
    .union([z.string(), z.array(z.string()), z.null()])
    .optional()
    .transform((value, ctx) => {
      if (value === undefined) return undefined;
      const { items, error } = splitList(value, limit);
      if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, message: error });
      return items;
    });

const fields = {
  full_name: z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.string({ required_error: "Add a name." }).min(1, "Add a name.").max(120, "Keep it to 120 characters."),
  ),
  email: z.preprocess(
    (v) => {
      const t = blankToNull(v);
      return typeof t === "string" ? t.toLowerCase() : t;
    },
    z.string().max(254, "Keep it to 254 characters.").email("Enter a valid email address.").nullish(),
  ),
  phone: z.preprocess(
    blankToNull,
    z
      .string()
      .max(30, "Keep it to 30 characters.")
      .regex(/^[0-9+\-() ]+$/, "Use digits, spaces and + - ( ) only.")
      .nullish(),
  ),
  location: text(120),
  current_title: text(120),
  current_company: text(120),
  experience_years: z.preprocess(
    (v) => {
      const t = typeof v === "number" ? v : blankToNull(v);
      if (typeof t !== "string") return t;
      const n = Number(t);
      return Number.isFinite(n) ? n : t;
    },
    z
      .number({ invalid_type_error: "Enter a number of years." })
      .min(0, "Use 0 to 60 years.")
      .max(60, "Use 0 to 60 years.")
      .nullish(),
  ),
  linkedin_url: httpUrl,
  github_url: httpUrl,
  portfolio_url: httpUrl,
  skills: list(SKILLS_LIMIT),
  tags: list(TAGS_LIMIT),
  notes: text(2000),
  resume_url: httpUrl,
};

/** BI-REQ-012's fields. Unknown keys are refused. */
export const candidateFieldsSchema = z.object(fields).strict();

/** With a job destination, a row may also name its stage (BI-REQ-015a). Not stored on the candidate. */
export const candidateRowSchema = z.object({ ...fields, stage: text(120) }).strict();

export type CandidateFields = z.output<typeof candidateFieldsSchema>;
export type CandidateRow = z.output<typeof candidateRowSchema>;
export type CandidateFieldsInput = z.input<typeof candidateFieldsSchema>;

/** Field errors keyed by field ("email": "Enter a valid email address."), the first one per field. */
export type CandidateFieldErrors = Partial<Record<CandidateFieldKey | "stage", string>> & Record<string, string>;

export function fieldErrorsOf(error: z.ZodError): CandidateFieldErrors {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      for (const key of issue.keys) out[key] ??= "Not a candidate field.";
      continue;
    }
    const key = String(issue.path[0] ?? "full_name");
    out[key] ??= issue.message;
  }
  return out;
}

/**
 * Validates one candidate (a spreadsheet row, a grid row or the form).
 * `withJob`: the destination is a job, so `stage` is allowed.
 */
export function parseCandidateFields(
  input: unknown,
  { withJob = false }: { withJob?: boolean } = {},
): { ok: true; data: CandidateRow } | { ok: false; errors: CandidateFieldErrors } {
  const result = (withJob ? candidateRowSchema : candidateFieldsSchema).safeParse(input);
  return result.success ? { ok: true, data: result.data } : { ok: false, errors: fieldErrorsOf(result.error) };
}
