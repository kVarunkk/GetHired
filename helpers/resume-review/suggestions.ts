import { readResume } from "@/helpers/resume/read-resume";
import type { ResumeBullet, ResumeContent } from "@/helpers/resume/resume-schema";

// What a review's suggestions are, for the analysis, the apply step and the
// page. Client-safe.

export type ReviewSuggestion = {
  bullet_id: string;
  section: string;
  original: string;
  suggested: string;
  reason: string;
  priority: string;
};

/** RE-REQ-059: text that still has one of these can't reach a resume. */
const PLACEHOLDER = /\[[^\]]+\]/;
const PLACEHOLDERS = /\[[^\]]+\]/g;

export const hasPlaceholder = (text: string) => PLACEHOLDER.test(text);

/** The placeholders in `text`, in order, repeats included. */
export const placeholdersIn = (text: string) => text.match(PLACEHOLDERS) ?? [];

/** `text` in order, with each placeholder as its own part (RI-REQ-026). */
export const splitPlaceholders = (text: string) =>
  text
    .split(/(\[[^\]]+\])/)
    .map((part, index) => ({ text: part, placeholder: index % 2 === 1 }))
    .filter((part) => part.text);

/** `text` with each placeholder swapped for its value. An empty value leaves it in place. */
export function fillPlaceholders(text: string, values: readonly string[]) {
  let index = 0;
  return text.replace(PLACEHOLDERS, (placeholder) => values[index++]?.trim() || placeholder);
}

export const resumeBullets = (content: ResumeContent): ResumeBullet[] =>
  content.sections.flatMap((section) => section.items.flatMap((item) => item.bullets));

/**
 * RE-REQ-054a: the suggestions as they should be saved. A model can misquote a
 * bullet or invent an id, so `original` comes from the resume, and a suggestion
 * with no real bullet is dropped, along with any repeat of one bullet.
 */
export function reconcileSuggestions<T extends Pick<ReviewSuggestion, "bullet_id" | "original">>(
  suggestions: T[],
  resumeContent: unknown,
): T[] {
  const remaining = new Map(
    resumeBullets(readResume({ content: resumeContent }).content).map((bullet) => [bullet.id, bullet.text]),
  );

  return suggestions.flatMap((suggestion) => {
    const original = remaining.get(suggestion.bullet_id);
    if (original === undefined) return [];
    remaining.delete(suggestion.bullet_id);
    return [{ ...suggestion, original }];
  });
}

const isString = (value: unknown): value is string => typeof value === "string";

/** The suggestions in a stored `ai_response`, which is only ever JSON. */
export function readSuggestions(aiResponse: unknown): ReviewSuggestion[] {
  const points = (aiResponse as { bullet_points?: unknown } | null)?.bullet_points;
  if (!Array.isArray(points)) return [];
  return points.filter(
    (point): point is ReviewSuggestion =>
      isString(point?.bullet_id) && isString(point?.original) && isString(point?.suggested),
  );
}
