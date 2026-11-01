import type { TResumeRowContent } from "@/utils/types";

// The resume text that goes into an embedding, shared by applicants
// (helpers/user/update-user-embedding.ts) and company candidates
// (helpers/candidates/embedding-text.ts). Pure.

type ResumeContent = Pick<TResumeRowContent, "sections"> | null | undefined;

/** The sections' types embeddings read, in the order they're written. */
export const EMBEDDED_RESUME_SECTIONS = ["summary", "experience", "projects", "skills"] as const;

/**
 * A section type's bullets, joined with ". ". "N/A" when there's no resume
 * at all (as the applicant embedding has always written it); "" when the
 * resume has no such section.
 */
export function resumeSectionText(content: unknown, type: string): string {
  const resume = content as ResumeContent;
  if (!resume || !resume.sections) return "N/A";
  return resume.sections
    .filter((s) => s.type === type)
    .flatMap((s) => s.items ?? [])
    .flatMap((i) => i.bullets ?? [])
    .map((b) => b.text)
    .filter((text): text is string => !!text)
    .join(". ");
}

/**
 * The resume's summary, experience, projects and skills as labelled lines,
 * skipping empty sections (CP-REQ-041). "" when there's nothing to embed.
 */
export function resumeEmbeddingText(content: unknown): string {
  const resume = content as ResumeContent;
  if (!resume || !Array.isArray(resume.sections)) return "";
  return EMBEDDED_RESUME_SECTIONS.map((type) => [type, resumeSectionText(resume, type)] as const)
    .filter(([, text]) => text.trim())
    .map(([type, text]) => `${type.toUpperCase()}: ${text}`)
    .join("\n");
}
