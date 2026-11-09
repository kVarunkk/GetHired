import { RESUME_BULLET_MATCH_THRESHOLD } from "./config";
import type { ResumeBullet, ResumeContent } from "./resume-schema";

// RE-REQ-094: a re-parse keeps the ids of the bullets it finds again, so
// existing reviews keep pointing at the right text with no change to their rows.

const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

const tokens = (text: string) => new Set(text.split(" ").filter(Boolean));

/** The same words, whatever the case, spacing or punctuation. */
export const sameBulletText = (a: string, b: string) => normalize(a) === normalize(b);

/** Dice similarity of two bullets' words, from 0 to 1. */
export function bulletSimilarity(a: string, b: string): number {
  const left = tokens(normalize(a));
  const right = tokens(normalize(b));
  if (left.size === 0 || right.size === 0) return 0;
  const shared = [...left].filter((word) => right.has(word)).length;
  return (2 * shared) / (left.size + right.size);
}

const bulletsOf = (content: ResumeContent) =>
  content.sections.flatMap((section) => section.items.flatMap((item) => item.bullets));

/**
 * `next` with each bullet taking the id of the old bullet it matches: the same
 * text after normalizing, or else the closest one above the threshold. One old
 * id is never used twice.
 */
export function carryBulletIds(previous: ResumeContent, next: ResumeContent): ResumeContent {
  const available = new Map(bulletsOf(previous).map((bullet) => [bullet.id, bullet]));
  const nextBullets = bulletsOf(next);
  const carried = new Map<ResumeBullet, string>();

  const assign = (bullet: ResumeBullet, oldId: string) => {
    carried.set(bullet, oldId);
    available.delete(oldId);
  };

  // Exact matches go first, so a close match can't take an id from one.
  for (const bullet of nextBullets) {
    const wanted = normalize(bullet.text);
    const exact = [...available.values()].find((old) => normalize(old.text) === wanted);
    if (exact) assign(bullet, exact.id);
  }

  // Then the closest pairs, best first, so each id goes to its best match.
  const pairs = nextBullets
    .filter((bullet) => !carried.has(bullet))
    .flatMap((bullet) =>
      [...available.values()].map((old) => ({ bullet, old, score: bulletSimilarity(bullet.text, old.text) })),
    )
    .filter(({ score }) => score >= RESUME_BULLET_MATCH_THRESHOLD)
    .sort((a, b) => b.score - a.score);

  for (const { bullet, old } of pairs) {
    if (!carried.has(bullet) && available.has(old.id)) assign(bullet, old.id);
  }

  return {
    ...next,
    sections: next.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({
        ...item,
        bullets: item.bullets.map((bullet) => ({ ...bullet, id: carried.get(bullet) ?? bullet.id })),
      })),
    })),
  };
}
