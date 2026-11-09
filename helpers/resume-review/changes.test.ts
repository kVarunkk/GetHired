import { describe, expect, it } from "vitest";
import { RESUME_LIMITS } from "@/helpers/resume/config";
import type { ResumeContent } from "@/helpers/resume/resume-schema";
import { runResumeOperations } from "@/helpers/resumes/resume-operations";
import {
  REVIEW_MAX_GAPS,
  changeText,
  planChangeOperations,
  readChanges,
  readGaps,
  reconcileChanges,
  type AddChange,
  type ChangeDraft,
  type MoveChange,
  type RemoveChange,
  type RewriteChange,
} from "./changes";

const content = (): ResumeContent => ({
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [
        {
          id: "i1",
          bullets: [
            { id: "b1", text: "One" },
            { id: "b2", text: "Two" },
            { id: "b3", text: "Three" },
          ],
        },
        { id: "i2", bullets: [] },
      ],
    },
  ],
});

const base = { reason: "Why", priority: "high" };

const rewrite = (bullet_id: string, original: string, suggested: string): RewriteChange => ({
  ...base,
  kind: "rewrite",
  id: bullet_id,
  bullet_id,
  original,
  suggested,
});

const add = (id: string, anchors: string[], suggested = `New ${id}`, item_id = "i1"): AddChange => ({
  ...base,
  kind: "add",
  id,
  item_id,
  anchors,
  suggested,
});

const remove = (bullet_id: string, original: string): RemoveChange => ({
  ...base,
  kind: "remove",
  id: `remove-${bullet_id}`,
  bullet_id,
  original,
});

const move = (target_id: string, index: number): MoveChange => ({
  ...base,
  kind: "move",
  id: `move-${target_id}`,
  target_id,
  index,
});

/** The bullets of the first entry after running the plan. */
function bulletsAfter(start: ResumeContent, plan: ReturnType<typeof planChangeOperations>) {
  const result = runResumeOperations({ content: start, contact: { fullName: "", links: [] } }, plan.operations);
  if (!result.ok) throw new Error(result.error);
  return result.content.sections[0].items[0].bullets.map((bullet) => bullet.text);
}

const run = (changes: Parameters<typeof planChangeOperations>[1], start = content()) => {
  const plan = planChangeOperations(start, changes);
  return { plan, bullets: bulletsAfter(start, plan), statuses: plan.planned.map(({ id, status }) => [id, status]) };
};

describe("readChanges (RI-REQ-041)", () => {
  const point = { bullet_id: "b1", section: "x", original: "One", suggested: "Uno", reason: "r", priority: "high" };

  it("reads an older row as rewrites, with the bullet id as the change id", () => {
    expect(readChanges({ bullet_points: [point] })).toEqual([
      { kind: "rewrite", id: "b1", bullet_id: "b1", original: "One", suggested: "Uno", reason: "r", priority: "high" },
    ]);
  });

  it("merges the other kinds after the rewrites", () => {
    const changes = readChanges({ bullet_points: [point], changes: [add("a", ["b1"]), remove("b2", "Two"), move("b3", 0)] });

    expect(changes.map(({ kind }) => kind)).toEqual(["rewrite", "add", "remove", "move"]);
  });

  it("skips what it can't read", () => {
    expect(readChanges(null)).toEqual([]);
    expect(readChanges({ changes: "nope" })).toEqual([]);
    expect(readChanges({ changes: [null, { kind: "add", id: "a" }, { kind: "explode", id: "x" }] })).toEqual([]);
  });
});

describe("readGaps", () => {
  it("reads the gaps, and is empty on an older row", () => {
    const gap = { requirement: "Kubernetes", question: "Have you run it?" };

    expect(readGaps({ gaps: [gap, { requirement: "No question" }] })).toEqual([gap]);
    expect(readGaps({ bullet_points: [] })).toEqual([]);
  });
});

describe("changeText", () => {
  it("is the user's text, then the suggestion, and null for a kind that writes none", () => {
    expect(changeText(add("a", []), "Mine")).toBe("Mine");
    expect(changeText(add("a", [], "Theirs"))).toBe("Theirs");
    expect(changeText(remove("b1", "One"))).toBeNull();
    expect(changeText(move("b1", 0))).toBeNull();
  });
});

describe("planChangeOperations (RI-REQ-031)", () => {
  it("rewrites a bullet, with the user's text when given", () => {
    const { bullets, plan } = run([
      { change: rewrite("b1", "One", "Uno") },
      { change: rewrite("b2", "Two", "Dos"), text: "Deux" },
    ]);

    expect(bullets).toEqual(["Uno", "Deux", "Three"]);
    expect(plan.planned[0]).toEqual({ id: "b1", kind: "rewrite", status: "applied", previousText: "One", appliedText: "Uno" });
  });

  it("removes a bullet", () => {
    const { bullets, plan } = run([{ change: remove("b2", "Two") }]);

    expect(bullets).toEqual(["One", "Three"]);
    expect(plan.planned[0]).toMatchObject({ previousText: "Two", appliedText: "" });
  });

  it("moves a part within its parent", () => {
    expect(run([{ change: move("b3", 0) }]).bullets).toEqual(["Three", "One", "Two"]);
  });

  it("adds a bullet after its anchor, under the change's own id", () => {
    const { plan, bullets } = run([{ change: add("new", ["b1"]) }]);

    expect(bullets).toEqual(["One", "New new", "Two", "Three"]);
    expect(plan.operations).toContainEqual(expect.objectContaining({ op: "addBullet", bulletId: "new" }));
    expect(plan.planned[0]).toMatchObject({ previousText: "", appliedText: "New new" });
  });

  it("adds to an empty entry", () => {
    const start = content();
    const plan = planChangeOperations(start, [{ change: add("new", [], "Only", "i2") }]);

    const result = runResumeOperations({ content: start, contact: { fullName: "", links: [] } }, plan.operations);

    expect(result.ok && result.content.sections[0].items[1].bullets).toEqual([{ id: "new", text: "Only" }]);
  });

  it("keeps two adds on one anchor in order", () => {
    const { bullets } = run([{ change: add("x", ["b1"]) }, { change: add("y", ["b1"]) }]);

    expect(bullets).toEqual(["One", "New x", "New y", "Two", "Three"]);
  });

  it("uses the new text of an add", () => {
    expect(run([{ change: add("x", ["b3"]), text: "Mine" }]).bullets).toEqual(["One", "Two", "Three", "Mine"]);
  });

  it("runs a move before the adds that follow it", () => {
    const { bullets } = run([{ change: add("x", ["b3", "b2", "b1"]) }, { change: move("b3", 0) }]);

    expect(bullets).toEqual(["Three", "New x", "One", "Two"]);
  });

  it("does all the kinds in one plan", () => {
    const { bullets, statuses } = run([
      { change: rewrite("b1", "One", "Uno") },
      { change: remove("b2", "Two") },
      { change: add("x", ["b2", "b1"]) },
    ]);

    expect(bullets).toEqual(["Uno", "New x", "Three"]);
    expect(statuses.every(([, status]) => status === "applied")).toBe(true);
  });

  it("ignores a repeated choice", () => {
    const { bullets, plan } = run([{ change: remove("b2", "Two") }, { change: remove("b2", "Two") }]);

    expect(bullets).toEqual(["One", "Three"]);
    expect(plan.planned).toHaveLength(1);
  });

  it("leaves the content it was given alone", () => {
    const start = content();

    planChangeOperations(start, [{ change: remove("b2", "Two") }, { change: add("x", ["b1"]) }]);

    expect(start).toEqual(content());
  });

  describe("a change the resume moved past is changed, not an error", () => {
    it("a rewrite whose bullet has new text", () => {
      const { bullets, statuses } = run([{ change: rewrite("b1", "Something else", "Uno") }]);

      expect(bullets).toEqual(["One", "Two", "Three"]);
      expect(statuses).toEqual([["b1", "changed"]]);
    });

    it("a rewrite whose bullet is gone", () => {
      expect(run([{ change: rewrite("gone", "One", "Uno") }]).statuses).toEqual([["gone", "changed"]]);
    });

    it("a removal whose bullet has new text", () => {
      const { bullets, statuses } = run([{ change: remove("b1", "Something else") }]);

      expect(bullets).toEqual(["One", "Two", "Three"]);
      expect(statuses).toEqual([["remove-b1", "changed"]]);
    });

    it("an add whose entry is gone", () => {
      expect(run([{ change: add("x", ["b1"], "New", "gone") }]).statuses).toEqual([["x", "changed"]]);
    });

    it("a move whose target is gone", () => {
      expect(run([{ change: move("gone", 0) }]).statuses).toEqual([["move-gone", "changed"]]);
    });

    it("and the rest still apply", () => {
      const { bullets } = run([{ change: rewrite("b1", "Something else", "Uno") }, { change: remove("b2", "Two") }]);

      expect(bullets).toEqual(["One", "Three"]);
    });

    it("treats punctuation and case as the same text", () => {
      expect(run([{ change: rewrite("b1", "one.", "Uno") }]).bullets[0]).toBe("Uno");
    });
  });

  describe("an add's anchor (RI-REQ-032)", () => {
    it("falls back to the nearest earlier bullet when its anchor is being removed", () => {
      const { bullets } = run([{ change: remove("b2", "Two") }, { change: add("x", ["b2", "b1"]) }]);

      expect(bullets).toEqual(["One", "New x", "Three"]);
    });

    it("falls back when its anchor is already gone", () => {
      const start = content();
      start.sections[0].items[0].bullets.splice(1, 1);

      expect(run([{ change: add("x", ["b2", "b1"]) }], start).bullets).toEqual(["One", "New x", "Three"]);
    });

    it("goes first when no earlier bullet remains", () => {
      const { bullets } = run([{ change: remove("b1", "One") }, { change: add("x", ["b1"]) }]);

      expect(bullets).toEqual(["New x", "Two", "Three"]);
    });

    it("doesn't need its anchor's removal to be chosen", () => {
      expect(run([{ change: add("x", ["b2", "b1"]) }]).bullets).toEqual(["One", "Two", "New x", "Three"]);
    });
  });
});

describe("reconcileChanges (RI-REQ-017)", () => {
  const draft = (overrides: Partial<ChangeDraft> = {}): ChangeDraft => ({
    overall_feedback: "Fine.",
    rewrites: [],
    additions: [],
    removals: [],
    moves: [],
    gaps: [],
    ...overrides,
  });
  const why = { reason: "r", priority: "high" };

  it("takes a rewrite's original from the resume, whatever the model quoted", () => {
    const { bullet_points } = reconcileChanges(draft({ rewrites: [{ ...why, bullet_id: "b1", suggested: "Uno" }] }), content());

    expect(bullet_points).toEqual([
      { bullet_id: "b1", section: "Experience", original: "One", suggested: "Uno", reason: "r", priority: "high" },
    ]);
  });

  it("drops anything pointing at an id the resume doesn't have", () => {
    const result = reconcileChanges(
      draft({
        rewrites: [{ ...why, bullet_id: "nope", suggested: "x" }],
        additions: [
          { ...why, item_id: "nope", suggested: "x" },
          { ...why, item_id: "i1", after_bullet_id: "nope", suggested: "x" },
        ],
        removals: [{ ...why, bullet_id: "nope" }],
        moves: [{ ...why, target_id: "nope", index: 0 }],
      }),
      content(),
    );

    expect(result.bullet_points).toEqual([]);
    expect(result.changes).toEqual([]);
  });

  it("drops an add whose anchor sits in another entry", () => {
    const { changes } = reconcileChanges(
      draft({ additions: [{ ...why, item_id: "i2", after_bullet_id: "b1", suggested: "x" }] }),
      content(),
    );

    expect(changes).toEqual([]);
  });

  it("keeps one rewrite per bullet", () => {
    const { bullet_points } = reconcileChanges(
      draft({
        rewrites: [
          { ...why, bullet_id: "b1", suggested: "First" },
          { ...why, bullet_id: "b1", suggested: "Second" },
        ],
      }),
      content(),
    );

    expect(bullet_points.map(({ suggested }) => suggested)).toEqual(["First"]);
  });

  it("drops a removal or move that clashes with a rewrite", () => {
    const { changes } = reconcileChanges(
      draft({
        rewrites: [{ ...why, bullet_id: "b1", suggested: "Uno" }],
        removals: [{ ...why, bullet_id: "b1" }],
        moves: [{ ...why, target_id: "b1", index: 2 }],
      }),
      content(),
    );

    expect(changes).toEqual([]);
  });

  it("drops a move that clashes with a removal", () => {
    const { changes } = reconcileChanges(
      draft({ removals: [{ ...why, bullet_id: "b1" }], moves: [{ ...why, target_id: "b1", index: 2 }] }),
      content(),
    );

    expect(changes.map(({ kind }) => kind)).toEqual(["remove"]);
  });

  it("drops a rewrite that changes nothing, and empty or oversized text", () => {
    const { bullet_points, changes } = reconcileChanges(
      draft({
        rewrites: [
          { ...why, bullet_id: "b1", suggested: "One" },
          { ...why, bullet_id: "b2", suggested: "   " },
        ],
        additions: [{ ...why, item_id: "i1", suggested: "x".repeat(RESUME_LIMITS.bulletChars + 1) }],
      }),
      content(),
    );

    expect(bullet_points).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("drops a move with no usable position", () => {
    const { changes } = reconcileChanges(
      draft({
        moves: [
          { ...why, target_id: "b1", index: -1 },
          { ...why, target_id: "b2", index: 1.5 },
        ],
      }),
      content(),
    );

    expect(changes).toEqual([]);
  });

  it("can move an entry or a section", () => {
    const { changes } = reconcileChanges(
      draft({
        moves: [
          { ...why, target_id: "i2", index: 0 },
          { ...why, target_id: "s1", index: 0 },
        ],
      }),
      content(),
    );

    expect(changes).toHaveLength(2);
  });

  it("gives an add its anchors, nearest first", () => {
    const { changes } = reconcileChanges(
      draft({ additions: [{ ...why, item_id: "i1", after_bullet_id: "b2", suggested: "New" }] }),
      content(),
    );

    expect(changes[0]).toMatchObject({ kind: "add", anchors: ["b2", "b1"] });
  });

  it("puts an add with no anchor at the end of the entry", () => {
    const start = content();
    const { changes } = reconcileChanges(draft({ additions: [{ ...why, item_id: "i1", suggested: "New" }] }), start);

    const { bullets } = run([{ change: changes[0] }], start);

    expect(bullets).toEqual(["One", "Two", "Three", "New"]);
  });

  it("stops adding at the entry's bullet limit", () => {
    const start = content();
    start.sections[0].items[0].bullets = Array.from({ length: RESUME_LIMITS.bulletsPerItem - 1 }, (_, index) => ({
      id: `b${index}`,
      text: `Bullet ${index}`,
    }));

    const { changes } = reconcileChanges(
      draft({
        additions: [
          { ...why, item_id: "i1", suggested: "Fits" },
          { ...why, item_id: "i1", suggested: "Too many" },
        ],
      }),
      start,
    );

    expect(changes).toHaveLength(1);
  });

  it("gives each change its own id, and reads a priority it doesn't know as medium", () => {
    const { changes } = reconcileChanges(
      draft({
        removals: [{ bullet_id: "b1", reason: "r", priority: "urgent!!" }],
        additions: [{ ...why, item_id: "i1", suggested: "New" }],
      }),
      content(),
    );

    expect(new Set(changes.map(({ id }) => id)).size).toBe(2);
    expect(changes.find(({ kind }) => kind === "remove")?.priority).toBe("medium");
  });

  it("caps the gaps", () => {
    const gaps = Array.from({ length: REVIEW_MAX_GAPS + 3 }, (_, index) => ({ requirement: `R${index}`, question: "Q?" }));

    expect(reconcileChanges(draft({ gaps }), content()).gaps).toHaveLength(REVIEW_MAX_GAPS);
  });

  it("reads back through readChanges", () => {
    const saved = reconcileChanges(
      draft({
        rewrites: [{ ...why, bullet_id: "b1", suggested: "Uno" }],
        additions: [{ ...why, item_id: "i1", suggested: "New" }],
        removals: [{ ...why, bullet_id: "b2" }],
        moves: [{ ...why, target_id: "b3", index: 0 }],
      }),
      content(),
    );

    expect(readChanges(JSON.parse(JSON.stringify(saved))).map(({ kind }) => kind)).toEqual([
      "rewrite",
      "add",
      "remove",
      "move",
    ]);
  });
});
