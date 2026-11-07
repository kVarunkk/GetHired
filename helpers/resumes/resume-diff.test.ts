import { describe, expect, it } from "vitest";
import type { ResumeDocument, ResumeDocumentItem } from "@/helpers/resume/render/document";
import { compactDiffRows, diffResume } from "./resume-diff";

const item = (id: string, bullets: [string, string][] = [], title = `Entry ${id}`): ResumeDocumentItem => ({
  id,
  title,
  bullets: bullets.map(([bulletId, text]) => ({ id: bulletId, text })),
});

const resume = (sections: ResumeDocument["sections"], extra: Partial<ResumeDocument> = {}): ResumeDocument => ({
  template: "classic",
  name: "Ada Lovelace",
  contact: [{ text: "ada@example.com" }],
  sections,
  ...extra,
});

const section = (id: string, items: ResumeDocumentItem[], title = `Section ${id}`) => ({
  id,
  title,
  plain: false,
  items,
});

const bulletsOf = (before: ResumeDocumentItem, after: ResumeDocumentItem) =>
  diffResume(resume([section("s", [before])]), resume([section("s", [after])])).sections[0].items[0].bullets;

describe("diffResume (RI-REQ-001)", () => {
  it("marks nothing when the resumes match", () => {
    const document = resume([section("s", [item("i", [["b", "Built it"]])])]);

    const diff = diffResume(document, document);

    expect(diff.hasChanges).toBe(false);
    expect(diff.sections[0].mark).toBe("unchanged");
    expect(diff.sections[0].items[0].mark).toBe("unchanged");
    expect(diff.sections[0].items[0].bullets[0]).toEqual({ id: "b", text: "Built it", mark: "unchanged" });
  });

  it("marks a changed bullet and everything above it", () => {
    const diff = diffResume(
      resume([section("s", [item("i", [["b", "Built it"]])])]),
      resume([section("s", [item("i", [["b", "Built the API"]])])]),
    );

    expect(diff.hasChanges).toBe(true);
    expect(diff.sections[0].mark).toBe("changed");
    expect(diff.sections[0].items[0].mark).toBe("changed");
    expect(diff.sections[0].items[0].bullets[0]).toMatchObject({ text: "Built the API", mark: "changed" });
  });

  it("gives a changed bullet word-level segments", () => {
    const [bullet] = bulletsOf(item("i", [["b", "Built the old API"]]), item("i", [["b", "Built the new API"]]));

    expect(bullet.segments).toEqual([
      { text: "Built the ", kind: "same" },
      { text: "old", kind: "removed" },
      { text: "new", kind: "added" },
      { text: " API", kind: "same" },
    ]);
  });

  it("marks an added bullet", () => {
    const bullets = bulletsOf(item("i", [["a", "One"]]), item("i", [["a", "One"], ["b", "Two"]]));

    expect(bullets.map(({ id, mark }) => [id, mark])).toEqual([["a", "unchanged"], ["b", "added"]]);
  });

  it("keeps a removed bullet in its old position", () => {
    const bullets = bulletsOf(
      item("i", [["a", "One"], ["b", "Two"], ["c", "Three"]]),
      item("i", [["a", "One"], ["c", "Three"]]),
    );

    expect(bullets.map(({ id, mark }) => [id, mark])).toEqual([
      ["a", "unchanged"],
      ["b", "removed"],
      ["c", "unchanged"],
    ]);
  });

  it("keeps removed parts first, and in order, when they led the list", () => {
    const bullets = bulletsOf(item("i", [["a", "One"], ["b", "Two"], ["c", "Three"]]), item("i", [["c", "Three"]]));

    expect(bullets.map(({ id }) => id)).toEqual(["a", "b", "c"]);
  });

  it("marks only the moved part, not what it passed", () => {
    const bullets = bulletsOf(
      item("i", [["a", "One"], ["b", "Two"], ["c", "Three"], ["d", "Four"]]),
      item("i", [["d", "Four"], ["a", "One"], ["b", "Two"], ["c", "Three"]]),
    );

    expect(bullets.map(({ id, mark }) => [id, mark])).toEqual([
      ["d", "moved"],
      ["a", "unchanged"],
      ["b", "unchanged"],
      ["c", "unchanged"],
    ]);
  });

  it("keeps the new wording of a bullet that also moved", () => {
    const bullets = bulletsOf(
      item("i", [["a", "One"], ["b", "Two"], ["c", "Three"]]),
      item("i", [["c", "Three more"], ["a", "One"], ["b", "Two"]]),
    );

    expect(bullets[0]).toMatchObject({ id: "c", mark: "moved", text: "Three more" });
    expect(bullets[0].segments).toContainEqual({ text: " more", kind: "added" });
  });

  it("doesn't count a removal as a move of what follows", () => {
    const bullets = bulletsOf(item("i", [["a", "One"], ["b", "Two"]]), item("i", [["b", "Two"]]));

    expect(bullets.find(({ id }) => id === "b")!.mark).toBe("unchanged");
  });

  it("marks everything inside an added or removed entry", () => {
    const diff = diffResume(
      resume([section("s", [item("gone", [["g", "Old"]])])]),
      resume([section("s", [item("new", [["n", "New"]])])]),
    );

    const [gone, added] = diff.sections[0].items;
    expect([gone.id, gone.mark, gone.title?.mark, gone.bullets[0].mark]).toEqual(["gone", "removed", "removed", "removed"]);
    expect([added.id, added.mark, added.title?.mark, added.bullets[0].mark]).toEqual(["new", "added", "added", "added"]);
  });

  it("marks moved and removed sections", () => {
    const diff = diffResume(
      resume([section("a", [item("1")]), section("b", [item("2")]), section("c", [item("3")]), section("d", [item("4")])]),
      resume([section("d", [item("4")]), section("a", [item("1")]), section("c", [item("3")])]),
    );

    expect(diff.sections.map(({ id, mark }) => [id, mark])).toEqual([
      ["d", "moved"],
      ["a", "unchanged"],
      ["b", "removed"],
      ["c", "unchanged"],
    ]);
  });

  it("diffs an entry's fields and the section title", () => {
    const diff = diffResume(
      resume([section("s", [{ ...item("i"), meta: "Acme · 2020" }], "Work")]),
      resume([section("s", [{ ...item("i"), meta: "Acme · 2021" }], "Experience")]),
    );

    expect(diff.sections[0].title).toMatchObject({ text: "Experience", mark: "changed" });
    expect(diff.sections[0].items[0].meta).toMatchObject({ text: "Acme · 2021", mark: "changed" });
  });

  it("diffs the name, headline and contact line", () => {
    const diff = diffResume(
      resume([], { contact: [{ text: "ada@example.com" }, { text: "London" }] }),
      resume([], { name: "Ada King", headline: "Engineer", contact: [{ text: "ada@example.com" }, { text: "Paris" }] }),
    );

    expect(diff.name).toMatchObject({ text: "Ada King", mark: "changed" });
    expect(diff.headline).toEqual({ text: "Engineer", mark: "added" });
    expect(diff.contact).toMatchObject({ text: "ada@example.com · Paris", mark: "changed" });
    expect(diff.hasChanges).toBe(true);
  });
});

describe("compactDiffRows (RI-REQ-004)", () => {
  it("collapses unchanged entries, across unchanged sections too", () => {
    const before = resume([
      section("a", [item("1"), item("2")]),
      section("b", [item("3"), item("4", [["x", "Old"]]), item("5")]),
    ]);
    const after = resume([
      section("a", [item("1"), item("2")]),
      section("b", [item("3"), item("4", [["x", "New"]]), item("5")]),
    ]);

    const rows = compactDiffRows(diffResume(before, after));

    expect(rows.map((row) => (row.type === "unchanged" ? row.count : row.type))).toEqual([2, "section", 1, "item", 1]);
  });

  it("is one row when nothing changed", () => {
    const document = resume([section("a", [item("1"), item("2")])]);

    expect(compactDiffRows(diffResume(document, document))).toEqual([{ type: "unchanged", count: 2 }]);
  });
});
