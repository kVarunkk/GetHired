// Column mapping for spreadsheet imports (BI-REQ-011, BI-SEC-005): guess each
// column's field from its header, keep protected characteristics out, hash
// the header row for the saved mapping, and turn rows into candidate fields.
// Client-safe.

import { z } from "zod";
import { screenFairnessText } from "@/helpers/ai/fairness";
import { CANDIDATE_FIELD_KEYS, type CandidateFieldKey } from "./candidate-schema";

/**
 * What a column can map to: a candidate field, half of a split name, the
 * row's stage (BI-REQ-015a), "keep as a tag" (the cell becomes a tag),
 * "keep as a note" ("Header: value" in the notes) or nothing.
 */
export const COLUMN_TARGETS = [...CANDIDATE_FIELD_KEYS, "first_name", "last_name", "stage", "tag", "note", "ignore"] as const;
export type ColumnTarget = (typeof COLUMN_TARGETS)[number];

/** Targets more than one column can have. Every other target is used once. */
const MULTI_TARGETS = new Set<ColumnTarget>(["tag", "note", "ignore"]);

export const TARGET_LABELS: Record<ColumnTarget, string> = {
  full_name: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  current_title: "Current title",
  current_company: "Current company",
  experience_years: "Years of experience",
  linkedin_url: "LinkedIn",
  github_url: "GitHub",
  portfolio_url: "Portfolio",
  skills: "Skills",
  tags: "Tags",
  notes: "Notes",
  resume_url: "Resume link",
  first_name: "First name",
  last_name: "Last name",
  stage: "Stage",
  tag: "Keep as a tag",
  note: "Keep as a note",
  ignore: "Ignore",
};

/** One target per header, in the header's order. */
export type ColumnMapping = ColumnTarget[];

/** What's saved per header set in `candidate_import_mappings` (BI-REQ-011/015a). */
export const savedMappingSchema = z
  .object({
    columns: z.array(z.enum(COLUMN_TARGETS)).max(500),
    /** Their stage value → one of the company's stage ids. */
    stageMap: z.record(z.string().max(120), z.string().uuid()).optional(),
  })
  .strict()
  .refine((m) => !m.stageMap || Object.keys(m.stageMap).length <= 200, "Too many stage values.");
export type SavedMapping = z.infer<typeof savedMappingSchema>;

/** Lower-cased, punctuation as spaces: "E-mail Address" → "e mail address". */
const normalise = (header: string) =>
  header
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const ALIASES: Record<Exclude<ColumnTarget, "tag" | "note" | "ignore">, string[]> = {
  full_name: ["name", "full name", "fullname", "candidate", "candidate name", "applicant", "applicant name", "contact name"],
  first_name: ["first name", "firstname", "first", "given name", "forename"],
  last_name: ["last name", "lastname", "last", "surname", "family name"],
  email: ["email", "e mail", "email address", "e mail address", "mail", "email id", "work email", "personal email"],
  phone: ["phone", "phone number", "phone no", "mobile", "mobile number", "mobile no", "contact number", "contact", "telephone", "tel", "cell", "whatsapp"],
  location: ["location", "city", "current location", "current city", "based in"],
  current_title: ["title", "job title", "current title", "designation", "current designation", "role", "current role", "position", "headline"],
  current_company: ["company", "current company", "employer", "current employer", "organization", "organisation"],
  experience_years: ["experience", "years of experience", "experience years", "experience in years", "total experience", "yoe", "exp", "years"],
  linkedin_url: ["linkedin", "linkedin url", "linkedin profile", "linkedin link"],
  github_url: ["github", "github url", "github profile"],
  portfolio_url: ["portfolio", "portfolio url", "website", "personal website", "site"],
  skills: ["skills", "key skills", "skill set", "skillset", "technologies", "tech stack"],
  tags: ["tags", "labels", "tag"],
  notes: ["notes", "note", "comments", "comment", "remarks"],
  resume_url: ["resume", "resume url", "resume link", "cv", "cv url", "cv link"],
  stage: ["stage", "status", "pipeline stage", "current stage"],
};

const ALIAS_INDEX = new Map<string, ColumnTarget>(
  Object.entries(ALIASES).flatMap(([target, aliases]) => aliases.map((a) => [a, target as ColumnTarget])),
);

/**
 * Headers that name a protected characteristic (BI-SEC-005). They're
 * ignored, never kept as tags or notes, and never sent anywhere.
 */
export const PROTECTED_HEADER_PATTERNS: { term: string; pattern: RegExp }[] = [
  { term: "age", pattern: /\bage\b|\bdob\b|\bdate of birth\b|\bbirth ?(?:date|day|year)\b|\bbirthday\b|\bborn\b/ },
  { term: "gender", pattern: /\bgender\b|\bsex\b|\bpronouns?\b/ },
  { term: "religion", pattern: /\breligion\b|\bfaith\b/ },
  { term: "marital status", pattern: /\bmarital\b|\bmarried\b|\bspouse\b/ },
  { term: "caste", pattern: /\bcastes?\b|\bjati\b/ },
  { term: "photo", pattern: /\bphoto\b|\bphotograph\b|\bpicture\b|\bimage\b|\bheadshot\b|\bselfie\b/ },
  { term: "nationality", pattern: /\bnationality\b|\bcitizenship\b|\bcountry of origin\b/ },
];

/** Why a header can't be imported ("Looks like gender…"), or null. */
export function protectedHeaderReason(header: string): string | null {
  const text = normalise(header);
  const term =
    PROTECTED_HEADER_PATTERNS.find((p) => p.pattern.test(text))?.term ??
    (() => {
      const screened = screenFairnessText(text, { context: "candidate_filter" });
      return screened.ok ? null : screened.term;
    })();
  return term ? `Looks like ${term}, which can't be used in hiring decisions, so it isn't imported.` : null;
}

export const isProtectedHeader = (header: string) => protectedHeaderReason(header) !== null;

/** The mapping guessed from the headers. Each field goes to its first matching column. */
export function guessMapping(headers: readonly string[]): ColumnMapping {
  const guessed = headers.map((header) =>
    isProtectedHeader(header) ? "ignore" : (ALIAS_INDEX.get(normalise(header)) ?? "ignore"),
  );
  return sanitizeMapping(headers, guessed);
}

/**
 * A mapping that fits the headers: one target per header (missing ones
 * ignored), protected headers ignored, and a single-use target only on its
 * first column. Used on saved mappings, which may be from older code.
 */
export function sanitizeMapping(headers: readonly string[], columns: readonly ColumnTarget[]): ColumnMapping {
  const used = new Set<ColumnTarget>();
  return headers.map((header, i) => {
    const target = columns[i] ?? "ignore";
    if (target === "ignore" || isProtectedHeader(header) || !COLUMN_TARGETS.includes(target)) return "ignore";
    if (MULTI_TARGETS.has(target)) return target;
    if (used.has(target)) return "ignore";
    used.add(target);
    return target;
  });
}

/**
 * Sets column `index` to `target`. A single-use target moves: the column that
 * had it is ignored. A protected header stays ignored.
 */
export function withTarget(
  headers: readonly string[],
  columns: readonly ColumnTarget[],
  index: number,
  target: ColumnTarget,
): ColumnMapping {
  if (isProtectedHeader(headers[index] ?? "")) return [...columns];
  return columns.map((current, i) => {
    if (i === index) return target;
    return !MULTI_TARGETS.has(target) && current === target ? "ignore" : current;
  });
}

/** What's missing before the rows can be previewed, or null. */
export function mappingProblem(columns: readonly ColumnTarget[]): string | null {
  const has = (t: ColumnTarget) => columns.includes(t);
  if (!has("full_name") && !has("first_name") && !has("last_name")) {
    return "Choose the column with each person's name.";
  }
  return null;
}

/**
 * sha256 of the normalised header row (trimmed, lower-cased, order kept), the
 * saved mapping's key: a repeat export from the same tool maps itself.
 */
export async function headerHash(headers: readonly string[]): Promise<string> {
  const normalised = JSON.stringify(headers.map((h) => h.trim().toLowerCase()));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(normalised));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A row as the candidate schema reads it: field → cell text. */
export type MappedRow = Partial<Record<CandidateFieldKey | "stage", string>>;

/**
 * Turns rows into candidate fields. Every mapped field is set, blank or not
 * (an "overwrite" import clears it). First and last name are joined when
 * there's no full name; "keep as a tag" cells are added to the tags and
 * "keep as a note" cells to the notes, as "Header: value".
 */
export function applyMapping(
  rows: readonly (readonly string[])[],
  headers: readonly string[],
  mapping: readonly ColumnTarget[],
): MappedRow[] {
  const columns = sanitizeMapping(headers, mapping);
  return rows.map((row) => {
    const out: MappedRow = {};
    const first: string[] = [];
    const last: string[] = [];
    const tags: string[] = [];
    const notes: string[] = [];
    columns.forEach((target, i) => {
      const cell = (row[i] ?? "").trim();
      switch (target) {
        case "ignore":
          return;
        case "first_name":
          if (cell) first.push(cell);
          return;
        case "last_name":
          if (cell) last.push(cell);
          return;
        case "tag":
          if (cell) tags.push(cell);
          return;
        case "note":
          if (cell) notes.push(`${headers[i]}: ${cell}`);
          return;
        default:
          out[target] = cell;
      }
    });
    if (!out.full_name && (first.length || last.length)) out.full_name = [...first, ...last].join(" ");
    if (tags.length) out.tags = [out.tags, ...tags].filter(Boolean).join(", ");
    if (notes.length) out.notes = [out.notes, ...notes].filter(Boolean).join("\n");
    return out;
  });
}
