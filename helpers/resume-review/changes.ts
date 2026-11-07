import { v4 as uuidv4 } from "uuid";
import { sameBulletText } from "@/helpers/resume/carry-bullet-ids";
import { RESUME_LIMITS, RESUME_SECTION_LABELS } from "@/helpers/resume/config";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { runResumeOperations, type PlannedOperation } from "@/helpers/resumes/resume-operations";
import { readSuggestions, reconcileSuggestions, resumeBullets, type ReviewSuggestion } from "./suggestions";

// RI-REQ-031: what a review can change on a resume, as stored and as operations.
// The card plans with this in the browser and the server applies with it, so
// the preview can't drift from the write. Pure and client-safe.

type ChangeBase = { id: string; reason: string; priority: string };

export type RewriteChange = ChangeBase & { kind: "rewrite"; bullet_id: string; original: string; suggested: string };

/**
 * `id` is also the new bullet's id, so the live diff can find it. `anchors` are
 * the bullets it can follow, nearest first, as the reviewed resume had them.
 */
export type AddChange = ChangeBase & { kind: "add"; item_id: string; anchors: string[]; suggested: string };

export type RemoveChange = ChangeBase & { kind: "remove"; bullet_id: string; original: string };

export type MoveChange = ChangeBase & { kind: "move"; target_id: string; index: number };

export type ReviewChange = RewriteChange | AddChange | RemoveChange | MoveChange;

export type ReviewGap = { requirement: string; question: string };

const isString = (value: unknown): value is string => typeof value === "string";

const isStoredChange = (value: unknown): value is Exclude<ReviewChange, RewriteChange> => {
  const change = value as Record<string, unknown> | null;
  if (!change || !isString(change.id)) return false;
  switch (change.kind) {
    case "add":
      return isString(change.item_id) && isString(change.suggested) && Array.isArray(change.anchors);
    case "remove":
      return isString(change.bullet_id) && isString(change.original);
    case "move":
      return isString(change.target_id) && typeof change.index === "number";
    default:
      return false;
  }
};

const toRewrite = ({ bullet_id, original, suggested, reason, priority }: ReviewSuggestion): RewriteChange => ({
  kind: "rewrite",
  id: bullet_id,
  bullet_id,
  original,
  suggested,
  reason,
  priority,
});

/** Every change in a stored `ai_response`. An older row has only rewrites (RI-REQ-041). */
export function readChanges(aiResponse: unknown): ReviewChange[] {
  const stored = (aiResponse as { changes?: unknown } | null)?.changes;
  return [...readSuggestions(aiResponse).map(toRewrite), ...(Array.isArray(stored) ? stored.filter(isStoredChange) : [])];
}

export function readGaps(aiResponse: unknown): ReviewGap[] {
  const gaps = (aiResponse as { gaps?: unknown } | null)?.gaps;
  if (!Array.isArray(gaps)) return [];
  return gaps.filter((gap): gap is ReviewGap => isString(gap?.requirement) && isString(gap?.question));
}

/** A resume's worth of questions. More reads as a form, not a conversation. */
export const REVIEW_MAX_GAPS = 6;

export type ChangeDraft = {
  overall_feedback: string;
  rewrites: { bullet_id: string; suggested: string; reason: string; priority: string }[];
  additions: {
    item_id: string;
    after_bullet_id?: string | null;
    suggested: string;
    reason: string;
    priority: string;
  }[];
  removals: { bullet_id: string; reason: string; priority: string }[];
  moves: { target_id: string; index: number; reason: string; priority: string }[];
  gaps: ReviewGap[];
};

const priorityOf = (priority: string) => (["high", "medium", "low"].includes(priority) ? priority : "medium");

const fitsABullet = (text: string) => text.trim().length > 0 && text.length <= RESUME_LIMITS.bulletChars;

/**
 * RI-REQ-017: the model's output as it should be saved. A lite model can misquote
 * or invent an id, so every id is checked against the resume and `original` comes
 * from there. A bullet takes one change: a rewrite wins, then a removal, then a
 * move. Each change gets its stable id here.
 */
export function reconcileChanges(draft: ChangeDraft, content: ResumeContent) {
  const sections = new Map(content.sections.map((section) => [section.id, section]));
  const items = new Map(content.sections.flatMap((section) => section.items.map((item) => [item.id, item])));
  const bullets = new Map(
    content.sections.flatMap((section) =>
      section.items.flatMap((item) =>
        item.bullets.map((bullet) => [bullet.id, { text: bullet.text, section }] as const),
      ),
    ),
  );

  const bullet_points = reconcileSuggestions(
    draft.rewrites
      .filter(({ bullet_id, suggested }) => fitsABullet(suggested) && suggested !== bullets.get(bullet_id)?.text)
      .map(({ bullet_id, suggested, reason, priority }) => {
        const section = bullets.get(bullet_id)?.section;
        return {
          bullet_id,
          section: section ? (section.title ?? RESUME_SECTION_LABELS[section.type]) : "",
          original: "",
          suggested: suggested.trim(),
          reason,
          priority: priorityOf(priority),
        };
      }),
    content,
  );
  const taken = new Set(bullet_points.map(({ bullet_id }) => bullet_id));

  const removals = draft.removals.flatMap(({ bullet_id, reason, priority }): RemoveChange[] => {
    const bullet = bullets.get(bullet_id);
    if (!bullet || taken.has(bullet_id)) return [];
    taken.add(bullet_id);
    return [
      { kind: "remove", id: uuidv4(), bullet_id, original: bullet.text, reason, priority: priorityOf(priority) },
    ];
  });

  const moves = draft.moves.flatMap(({ target_id, index, reason, priority }): MoveChange[] => {
    const exists = bullets.has(target_id) || items.has(target_id) || sections.has(target_id);
    if (!exists || taken.has(target_id) || !Number.isInteger(index) || index < 0) return [];
    taken.add(target_id);
    return [{ kind: "move", id: uuidv4(), target_id, index, reason, priority: priorityOf(priority) }];
  });

  const addedTo = new Map<string, number>();
  const additions = draft.additions.flatMap(
    ({ item_id, after_bullet_id, suggested, reason, priority }): AddChange[] => {
      const item = items.get(item_id);
      if (!item || !fitsABullet(suggested)) return [];

      const order = item.bullets.map((bullet) => bullet.id);
      const position = after_bullet_id ? order.indexOf(after_bullet_id) : order.length - 1;
      if (after_bullet_id && position === -1) return [];

      const count = addedTo.get(item_id) ?? 0;
      if (item.bullets.length + count >= RESUME_LIMITS.bulletsPerItem) return [];
      addedTo.set(item_id, count + 1);

      return [
        {
          kind: "add",
          id: uuidv4(),
          item_id,
          anchors: order.slice(0, position + 1).reverse(),
          suggested: suggested.trim(),
          reason,
          priority: priorityOf(priority),
        },
      ];
    },
  );

  return {
    overall_feedback: draft.overall_feedback,
    bullet_points,
    changes: [...additions, ...removals, ...moves],
    gaps: draft.gaps.slice(0, REVIEW_MAX_GAPS),
  };
}

/** The text a change would write, or null if it writes none. */
export const changeText = (change: ReviewChange, text?: string): string | null =>
  change.kind === "rewrite" || change.kind === "add" ? (text ?? change.suggested) : null;

export type ChosenChange = { change: ReviewChange; text?: string };

export type PlannedChange = {
  id: string;
  kind: ReviewChange["kind"];
  /** `changed`: the resume moved on since the review, so this one is left out (RI-REQ-031). */
  status: "applied" | "changed";
  previousText: string;
  appliedText: string;
};

const hasPart = (content: ResumeContent, id: string) =>
  content.sections.some(
    (section) =>
      section.id === id ||
      section.items.some((item) => item.id === id || item.bullets.some((bullet) => bullet.id === id)),
  );

/**
 * The chosen changes as operations, with what became of each. Moves run first,
 * because their positions are from the reviewed resume. Adds run last and are
 * placed by what's left, so no change depends on another being chosen
 * (RI-REQ-032).
 */
export function planChangeOperations(content: ResumeContent, choices: ChosenChange[]) {
  const chosen = [...new Map(choices.map((choice) => [choice.change.id, choice])).values()];
  const texts = new Map(resumeBullets(content).map((bullet) => [bullet.id, bullet.text]));
  const operations: PlannedOperation[] = [];
  const planned = new Map<string, PlannedChange>();

  const record = (change: ReviewChange, applied: boolean, previousText: string, appliedText: string) =>
    planned.set(change.id, {
      id: change.id,
      kind: change.kind,
      status: applied ? "applied" : "changed",
      previousText,
      appliedText,
    });

  const stillReads = (bulletId: string, original: string) => {
    const current = texts.get(bulletId);
    return current !== undefined && sameBulletText(current, original);
  };

  for (const { change } of chosen) {
    if (change.kind !== "move") continue;
    const exists = hasPart(content, change.target_id);
    if (exists) operations.push({ op: "move", id: change.target_id, index: change.index });
    record(change, exists, "", "");
  }

  for (const { change, text } of chosen) {
    if (change.kind !== "rewrite") continue;
    const applies = stillReads(change.bullet_id, change.original);
    const next = text ?? change.suggested;
    if (applies) operations.push({ op: "setBulletText", bulletId: change.bullet_id, text: next });
    record(change, applies, texts.get(change.bullet_id) ?? change.original, next);
  }

  for (const { change } of chosen) {
    if (change.kind !== "remove") continue;
    const applies = stillReads(change.bullet_id, change.original);
    if (applies) operations.push({ op: "removeBullet", bulletId: change.bullet_id });
    record(change, applies, change.original, "");
  }

  const settled = runResumeOperations({ content, contact: { fullName: "", links: [] } }, operations);
  if (!settled.ok) throw new Error(settled.error);

  const lists = new Map(
    settled.content.sections.flatMap((section) =>
      section.items.map((item) => [item.id, item.bullets.map((bullet) => bullet.id)] as const),
    ),
  );
  const added = new Set<string>();

  for (const { change, text } of chosen) {
    if (change.kind !== "add") continue;
    const list = lists.get(change.item_id);
    const next = text ?? change.suggested;
    record(change, !!list, "", next);
    if (!list) continue;

    const anchor = change.anchors.find((id) => list.includes(id));
    let index = anchor === undefined ? 0 : list.indexOf(anchor) + 1;
    // Two adds on one anchor keep their order.
    while (index < list.length && added.has(list[index])) index += 1;

    list.splice(index, 0, change.id);
    added.add(change.id);
    operations.push({ op: "addBullet", itemId: change.item_id, text: next, index, bulletId: change.id });
  }

  return { operations, planned: chosen.map(({ change }) => planned.get(change.id)!) };
}
