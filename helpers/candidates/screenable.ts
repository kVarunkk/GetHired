// BI-REQ-036: whether a company candidate has enough detail to be scored.
// Shared by the import preview's counts and the screening worker, so the two
// always agree. Client-safe.

/** How many of title, company, experience and skills a candidate needs without a resume. */
export const SCREENABLE_MIN_FIELDS = 2;

export type ScreenableCandidate = {
  resume_content?: unknown;
  current_title?: string | null;
  current_company?: string | null;
  experience_years?: number | null;
  skills?: readonly string[] | null;
  /** Never counted: tags and notes don't reach the screening prompt (BI-SEC-005). */
  tags?: unknown;
  notes?: unknown;
};

function resumeSections(content: unknown): number {
  if (!content || typeof content !== "object") return 0;
  const sections = (content as { sections?: unknown }).sections;
  if (!Array.isArray(sections)) return 0;
  return sections.filter(
    (s) => s && typeof s === "object" && Array.isArray((s as { items?: unknown }).items) && (s as { items: unknown[] }).items.length > 0,
  ).length;
}

const filled = (value: string | null | undefined) => typeof value === "string" && value.trim().length > 0;

export function hasScreenableDetail(candidate: ScreenableCandidate): boolean {
  if (resumeSections(candidate.resume_content) > 0) return true;
  const count = [
    filled(candidate.current_title),
    filled(candidate.current_company),
    typeof candidate.experience_years === "number",
    (candidate.skills ?? []).some((s) => s.trim().length > 0),
  ].filter(Boolean).length;
  return count >= SCREENABLE_MIN_FIELDS;
}
