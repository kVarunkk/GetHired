// The candidate form's values (BI-REQ-004, BI-REQ-009): every field as the
// text the inputs hold, so the import's schema (candidate-schema.ts)
// validates them as it does a spreadsheet cell. Client-safe.

import type { Json } from "@/utils/types/database.types";
import { CANDIDATE_FIELD_KEYS, type CandidateFieldKey } from "./candidate-schema";

export type CandidateFormValues = Record<CandidateFieldKey, string>;

/** The `links` keys of each URL field (`import_links` in the migration). */
const LINK_KEYS = {
  linkedin_url: "linkedin",
  github_url: "github",
  portfolio_url: "portfolio",
  resume_url: "resume_url",
} as const;

export type CandidateFormSource = {
  full_name: string;
  email: string | null;
  phone: string | null;
  location: string | null;
  current_title: string | null;
  current_company: string | null;
  experience_years: number | null;
  links: Json;
  skills: string[];
  tags: string[];
  notes: string | null;
};

export const EMPTY_CANDIDATE_FORM = Object.fromEntries(
  CANDIDATE_FIELD_KEYS.map((key) => [key, ""]),
) as CandidateFormValues;

/** A stored candidate as form values. */
export function candidateFormValues(candidate: CandidateFormSource): CandidateFormValues {
  const links =
    candidate.links && typeof candidate.links === "object" && !Array.isArray(candidate.links) ? candidate.links : {};
  const link = (key: keyof typeof LINK_KEYS) => {
    const value = links[LINK_KEYS[key]];
    return typeof value === "string" ? value : "";
  };
  return {
    full_name: candidate.full_name,
    email: candidate.email ?? "",
    phone: candidate.phone ?? "",
    location: candidate.location ?? "",
    current_title: candidate.current_title ?? "",
    current_company: candidate.current_company ?? "",
    experience_years: candidate.experience_years === null ? "" : String(candidate.experience_years),
    linkedin_url: link("linkedin_url"),
    github_url: link("github_url"),
    portfolio_url: link("portfolio_url"),
    resume_url: link("resume_url"),
    skills: candidate.skills.join(", "),
    tags: candidate.tags.join(", "),
    notes: candidate.notes ?? "",
  };
}

/** The fields whose text changed (ignoring surrounding spaces), to send only those. */
export function changedFields(
  initial: CandidateFormValues,
  current: CandidateFormValues,
): Partial<CandidateFormValues> {
  return Object.fromEntries(
    CANDIDATE_FIELD_KEYS.filter((key) => initial[key].trim() !== current[key].trim()).map((key) => [
      key,
      current[key],
    ]),
  );
}
