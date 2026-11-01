import type { Database } from "@/utils/types/database.types";
import { resumeEmbeddingText } from "@/helpers/embeddings/resume-text";

// What a company candidate's embedding is made of (CP-REQ-041). Pure, so the
// worker, the candidate page and the tests agree. Never the name, contact
// details, links, tags or notes (CP-SEC-001): a name or a protected
// characteristic in a tag mustn't steer who matches a job.

type CandidateRow = Database["public"]["Tables"]["company_candidates"]["Row"];

/** The columns the text reads: the trigger re-embeds when one of these changes. */
export const EMBEDDED_CANDIDATE_COLUMNS = [
  "current_title",
  "current_company",
  "experience_years",
  "location",
  "skills",
  "resume_content",
] as const satisfies readonly (keyof CandidateRow)[];

export type EmbeddedCandidate = Pick<CandidateRow, (typeof EMBEDDED_CANDIDATE_COLUMNS)[number]>;

/** Gemini embeddings read about 2,000 tokens; the rest would be cut anyway. */
export const CANDIDATE_EMBEDDING_MAX_CHARS = 8000;

const clean = (value: string | null | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";

/**
 * The text to embed for `candidate`, or null when there's too little to
 * match on: no title, no skills and no resume.
 */
export function candidateEmbeddingText(candidate: EmbeddedCandidate): string | null {
  const title = clean(candidate.current_title);
  const skills = (candidate.skills ?? []).map(clean).filter(Boolean);
  const resume = resumeEmbeddingText(candidate.resume_content);
  if (!title && skills.length === 0 && !resume) return null;

  const company = clean(candidate.current_company);
  const location = clean(candidate.location);
  const years = candidate.experience_years;
  const text = [
    title && `TITLE: ${title}${company ? ` at ${company}` : ""}`,
    !title && company && `COMPANY: ${company}`,
    years !== null && years !== undefined && `EXPERIENCE YEARS: ${years}`,
    location && `LOCATION: ${location}`,
    skills.length > 0 && `SKILLS: ${skills.join(", ")}`,
    resume,
  ]
    .filter(Boolean)
    .join("\n");
  return text.slice(0, CANDIDATE_EMBEDDING_MAX_CHARS);
}
