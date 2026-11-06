import { describe, expect, it } from "vitest";
import { RESUME_BULLET_MATCH_THRESHOLD } from "./config";
import { bulletSimilarity, carryBulletIds } from "./carry-bullet-ids";
import { ResumeContentSchema, type ResumeContent } from "./resume-schema";

const resume = (bullets: [id: string, text: string][]): ResumeContent => ({
  version: 2,
  sections: [
    {
      id: "s1",
      type: "experience",
      items: [{ id: "i1", bullets: bullets.map(([id, text]) => ({ id, text })) }],
    },
  ],
});

const ids = (content: ResumeContent) => content.sections[0].items[0].bullets.map((bullet) => bullet.id);

describe("carryBulletIds (RE-REQ-094)", () => {
  it("keeps the id of the same text after normalizing", () => {
    const next = carryBulletIds(
      resume([["old", "Built the billing API."]]),
      resume([["new", "  built the BILLING api "]]),
    );
    expect(ids(next)).toEqual(["old"]);
  });

  it("keeps the id of a close match above the threshold", () => {
    const next = carryBulletIds(
      resume([["old", "Built the billing API for three large enterprise customers"]]),
      resume([["new", "Built the billing API for three enterprise customers"]]),
    );
    expect(ids(next)).toEqual(["old"]);
  });

  it("gives no id to a bullet below the threshold", () => {
    const next = carryBulletIds(resume([["old", "Managed the mobile release train"]]), resume([["new", "Designed a billing API"]]));
    expect(ids(next)).toEqual(["new"]);
  });

  it("never uses one old id twice", () => {
    const next = carryBulletIds(
      resume([["old", "Built the billing API"]]),
      resume([
        ["a", "Built the billing API"],
        ["b", "Built the billing API"],
      ]),
    );
    expect(ids(next)).toEqual(["old", "b"]);
  });

  it("gives an exact match priority over an earlier close match", () => {
    const next = carryBulletIds(
      resume([["old", "Built the billing API for customers"]]),
      resume([
        ["close", "Built the billing API for all customers"],
        ["exact", "Built the billing API for customers"],
      ]),
    );
    expect(ids(next)).toEqual(["close", "old"]);
  });

  it("gives each old id to its best match", () => {
    const next = carryBulletIds(
      resume([
        ["one", "Built the billing API for customers in India"],
        ["two", "Built the billing API for customers in Europe and Asia"],
      ]),
      resume([
        ["a", "Built the billing API for customers in Europe"],
        ["b", "Built the billing API for customers in the India region"],
      ]),
    );
    expect(ids(next)).toEqual(["two", "one"]);
  });

  it("keeps ids across a bullet that moved to another item", () => {
    const previous = resume([["old", "Built the billing API"]]);
    const next: ResumeContent = {
      version: 2,
      sections: [
        { id: "x", type: "projects", items: [{ id: "y", bullets: [{ id: "new", text: "Built the billing API" }] }] },
      ],
    };
    expect(carryBulletIds(previous, next).sections[0].items[0].bullets[0].id).toBe("old");
  });

  it("handles a resume with no old content", () => {
    expect(ids(carryBulletIds({ version: 2, sections: [] }, resume([["new", "Text"]])))).toEqual(["new"]);
  });

  it("leaves a valid resume, with no repeated id", () => {
    const next = carryBulletIds(
      resume([
        ["a", "One thing here"],
        ["b", "Two things here"],
      ]),
      resume([
        ["c", "Two things here"],
        ["d", "One thing here"],
        ["e", "A new thing entirely different"],
      ]),
    );
    expect(ResumeContentSchema.safeParse(next).success).toBe(true);
  });
});

describe("bulletSimilarity", () => {
  it("runs from 0 to 1", () => {
    expect(bulletSimilarity("a b c", "a b c")).toBe(1);
    expect(bulletSimilarity("a b c", "x y z")).toBe(0);
    expect(bulletSimilarity("", "a")).toBe(0);
    expect(bulletSimilarity("a b c d", "a b c e")).toBeGreaterThanOrEqual(RESUME_BULLET_MATCH_THRESHOLD);
  });
});
